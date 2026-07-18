import snmp from 'net-snmp';
import { snmpGetViaRouter, snmpWalkViaRouter, mikrotikSnmpGet } from './mikrotikNetwork.js';

function withHardTimeout(promise, ms, label = '') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Hard timeout ${label} (${ms}ms)`)), ms),
    ),
  ]);
}

const SYS_DESCR = '1.3.6.1.2.1.1.1.0';
const SYS_NAME = '1.3.6.1.2.1.1.5.0';
const SYS_UPTIME = '1.3.6.1.2.1.1.3.0';
const SNMP_OIDS = [SYS_DESCR, SYS_NAME, SYS_UPTIME];

const UBNT_WL_STAT = '1.3.6.1.4.1.41112.1.4.5.1';
const UBNT_COLS = {
  signal: 5,
  rssi: 6,
  ccq: 7,
  noiseFloor: 8,
  txRate: 9,
  rxRate: 10,
};

function formatUptime(timeticks) {
  const ms = Math.floor(Number(timeticks) / 100);
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function normalizeDbm(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  if (n > 0 && n < 256) return -n;
  return n;
}

function normalizeCcq(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  if (n > 100) return Math.round(n / 10);
  return n;
}

function parseWalkByColumn(walkData) {
  const byCol = {};
  for (const [oid, raw] of Object.entries(walkData)) {
    for (const [key, col] of Object.entries(UBNT_COLS)) {
      // Anclar al OID base exacto — evita falsos positivos por '.5.' y '.6.'
      // que aparecen en el prefijo estándar 1.3.6.1.4.1.41112.1.4.5.1
      if (oid.startsWith(`${UBNT_WL_STAT}.${col}.`) || oid === `${UBNT_WL_STAT}.${col}`) {
        if (byCol[key] == null) byCol[key] = raw;
      }
    }
  }
  return byCol;
}

export function snmpGet(host, community, oids, { port = 161, timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(host, community, {
      port,
      retries: 1,
      timeout,
      version: snmp.Version2c,
    });

    session.get(oids, (err, varbinds) => {
      session.close();
      if (err) return reject(err);
      const out = {};
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) continue;
        out[vb.oid] = vb.value?.toString?.() ?? vb.value;
      }
      resolve(out);
    });
  });
}

export function snmpWalk(host, community, baseOid, { port = 161, timeout = 8000, maxRows = 48 } = {}) {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(host, community, {
      port,
      retries: 1,
      timeout,
      version: snmp.Version2c,
    });
    const out = {};
    let count = 0;

    session.subtree(baseOid, (vb) => {
      if (snmp.isVarbindError(vb)) return;
      out[vb.oid] = vb.value?.toString?.() ?? vb.value;
      count += 1;
      if (count >= maxRows) session.cancel();
    }, (err) => {
      session.close();
      if (err && count === 0) return reject(err);
      resolve(out);
    });
  });
}

async function getIndexedViaRouter(router, host, community) {
  // 6 columnas en paralelo; cada índice tiene 1s hard timeout (CPE offline falla rápido)
  const entries = await Promise.all(
    Object.entries(UBNT_COLS).map(async ([key, col]) => {
      for (const idx of [1, 2, 3, 0]) {
        const oid = `${UBNT_WL_STAT}.${col}.${idx}`;
        try {
          const val = await withHardTimeout(
            mikrotikSnmpGet(router, { address: host, community, oid }),
            1000,
          );
          if (val != null && val !== '') return [key, val];
        } catch { /* siguiente índice */ }
      }
      return null;
    }),
  );
  return Object.fromEntries(entries.filter(Boolean));
}

async function getIndexedDirect(host, community) {
  // P0: 6 columnas en paralelo — de 24 awaits seriales a 6 cadenas independientes
  const entries = await Promise.all(
    Object.entries(UBNT_COLS).map(async ([key, col]) => {
      for (const idx of [1, 2, 3, 0]) {
        const oid = `${UBNT_WL_STAT}.${col}.${idx}`;
        try {
          const data = await snmpGet(host, community, [oid], { timeout: 3000 });
          const val = data[oid];
          if (val != null && val !== '') return [key, val];
        } catch { /* siguiente índice */ }
      }
      return null;
    }),
  );
  return Object.fromEntries(entries.filter(Boolean));
}

async function fetchUbntWireless(host, community, router, pollMethod) {
  const attempts = [];
  let merged = {};

  if (pollMethod === 'router' && router) {
    try {
      const walkData = await snmpWalkViaRouter(router, host, community, UBNT_WL_STAT);
      merged = parseWalkByColumn(walkData);
      if (Object.keys(merged).length) attempts.push('router-walk');
    } catch (e) {
      attempts.push(`router-walk-fail:${e.message}`);
    }

    if (!Object.keys(merged).length) {
      merged = await getIndexedViaRouter(router, host, community);
      if (Object.keys(merged).length) attempts.push('router-index');
    }
  }

  if (!Object.keys(merged).length) {
    try {
      const walkData = await snmpWalk(host, community, UBNT_WL_STAT);
      merged = parseWalkByColumn(walkData);
      if (Object.keys(merged).length) attempts.push('direct-walk');
    } catch (e) {
      attempts.push(`direct-walk-fail:${e.message}`);
    }
  }

  if (!Object.keys(merged).length) {
    merged = await getIndexedDirect(host, community);
    if (Object.keys(merged).length) attempts.push('direct-index');
  }

  // Si el poll básico fue directo pero wireless falló, reintentar vía router (IP privada)
  if (!Object.keys(merged).length && router && pollMethod !== 'router') {
    try {
      const walkData = await snmpWalkViaRouter(router, host, community, UBNT_WL_STAT);
      merged = parseWalkByColumn(walkData);
      if (Object.keys(merged).length) attempts.push('router-walk-fallback');
    } catch { /* ignore */ }
    if (!Object.keys(merged).length) {
      merged = await getIndexedViaRouter(router, host, community);
      if (Object.keys(merged).length) attempts.push('router-index-fallback');
    }
  }

  if (!Object.keys(merged).length) {
    return {
      wireless: null,
      wirelessDebug: {
        attempts,
        hint: pollMethod === 'router'
          ? 'SNMP básico OK vía MikroTik; MIB wireless Ubiquiti no respondió. Verifica que la LiteBeam esté enlazada al AP y SNMP activo en airOS.'
          : 'MIB wireless Ubiquiti no respondió en la antena.',
      },
    };
  }

  console.log(`[SNMP-DEBUG] host=${host} raw_merged=${JSON.stringify(merged)} attempts=${JSON.stringify(attempts)}`);

  const signal = normalizeDbm(merged.signal ?? merged.rssi);
  const rssi = normalizeDbm(merged.rssi ?? merged.signal);
  const ccq = normalizeCcq(merged.ccq);
  const noiseFloor = normalizeDbm(merged.noiseFloor);
  const snr = signal != null && noiseFloor != null ? Math.round(signal - noiseFloor) : null;

  console.log(`[SNMP-DEBUG] computed signal=${signal} rssi=${rssi} ccq=${ccq} noiseFloor=${noiseFloor} snr=${snr}`);

  const warnings = [];
  if (signal != null && signal < -72) {
    warnings.push({ type: 'alignment', label: 'Señal débil — posible desalineación', severity: 'high' });
  } else if (signal != null && signal < -65) {
    warnings.push({ type: 'alignment', label: 'Señal moderada — revisar apuntamiento', severity: 'medium' });
  }
  if (ccq != null && ccq < 50) {
    warnings.push({ type: 'ccq', label: `CCQ bajo (${ccq}%) — interferencia o mala alineación`, severity: 'high' });
  }
  if (snr != null && snr < 15) {
    warnings.push({ type: 'noise', label: `SNR bajo (${snr} dB) — ruido elevado`, severity: 'medium' });
  }

  return {
    wireless: {
      signalDbm: signal,
      rssiDbm: rssi,
      ccqPercent: ccq,
      noiseFloorDbm: noiseFloor,
      snrDb: snr,
      txRateMbps: merged.txRate ? Number(merged.txRate) : null,
      rxRateMbps: merged.rxRate ? Number(merged.rxRate) : null,
      warnings,
      linkQuality: ccq ?? (signal != null ? Math.min(100, Math.max(0, 100 + signal)) : null),
    },
    wirelessDebug: { attempts, raw: merged },
  };
}

export async function pollDeviceSnmp(equipment, router = null) {
  const { getEffectiveHost } = await import('./ipResolver.js');
  const { decryptSecret } = await import('./secrets.js');
  const host = getEffectiveHost(equipment);
  let community = equipment.snmpCommunity?.trim() || 'public';
  try {
    community = decryptSecret(community) || community;
  } catch {
    /* legacy plaintext */
  }
  if (!host) throw new Error('Equipo sin IP para SNMP');

  let data = {};
  let pollMethod = 'direct';

  try {
    // P0: si hay router como fallback, el intento directo usa timeout corto (2s, sin retry)
    // para no bloquear 10s en CPEs en LAN privada que nunca son accesibles directamente.
    const directOpts = router
      ? { timeout: 2000, retries: 0 }
      : { timeout: 5000, retries: 1 };
    data = await snmpGet(host, community, SNMP_OIDS, directOpts);
  } catch (directErr) {
    if (!router) throw directErr;
    pollMethod = 'router';
    data = await snmpGetViaRouter(router, host, community, SNMP_OIDS);
    if (!Object.keys(data).length) {
      throw new Error(`SNMP falló (directo y vía router): ${directErr.message}`);
    }
  }

  const uptimeRaw = data[SYS_UPTIME];
  const online = uptimeRaw != null;

  let wireless = null;
  let wirelessDebug = null;
  const isUbiquiti = /ubiquiti|litebeam|nanostation|powerbeam|airmax|airos/i.test(
    `${equipment.brand || ''} ${equipment.model || ''} ${equipment.name || ''} ${data[SYS_DESCR] || ''}`,
  );

  if (online && isUbiquiti) {
    const wl = await fetchUbntWireless(host, community, router, pollMethod);
    wireless = wl.wireless;
    wirelessDebug = wl.wirelessDebug;
  }

  return {
    online,
    sysName: data[SYS_NAME] || equipment.name,
    sysDescr: data[SYS_DESCR] || null,
    uptime: uptimeRaw != null ? formatUptime(uptimeRaw) : null,
    uptimeTicks: uptimeRaw,
    wireless,
    wirelessDebug,
    polledAt: new Date().toISOString(),
    host,
    pollMethod,
    community: community === 'public' ? 'public' : '***',
  };
}

export async function pollEquipmentList(items, routerBySiteId = new Map()) {
  // Todos los dispositivos en paralelo; 6s hard ceiling por dispositivo
  return Promise.all(
    items.map(async (eq) => {
      if (!eq.ipAddress || !eq.snmpCommunity) {
        return { id: eq.id, name: eq.name, skipped: true, reason: 'Sin IP o community SNMP' };
      }
      const router = eq.siteId ? routerBySiteId.get(eq.siteId) : null;
      try {
        const snmpData = await withHardTimeout(pollDeviceSnmp(eq, router), 6000, eq.name);
        return { id: eq.id, name: eq.name, ...snmpData };
      } catch (err) {
        return { id: eq.id, name: eq.name, online: false, error: err.message };
      }
    }),
  );
}
