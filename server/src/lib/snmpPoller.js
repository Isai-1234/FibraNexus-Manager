import snmp from 'net-snmp';
import { snmpGetViaRouter } from './mikrotikNetwork.js';

const SYS_DESCR = '1.3.6.1.2.1.1.1.0';
const SYS_NAME = '1.3.6.1.2.1.1.5.0';
const SYS_UPTIME = '1.3.6.1.2.1.1.3.0';
const SNMP_OIDS = [SYS_DESCR, SYS_NAME, SYS_UPTIME];

const UBNT_WL_STAT = '1.3.6.1.4.1.41112.1.4.5.1';
const UBNT_COLS = {
  signal: '.5',
  rssi: '.6',
  ccq: '.7',
  txRate: '.9',
  rxRate: '.10',
  noiseFloor: '.8',
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

export function snmpWalk(host, community, baseOid, { port = 161, timeout = 8000, maxRows = 32 } = {}) {
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

async function walkUbntWireless(host, community, router = null) {
  const cols = Object.entries(UBNT_COLS);
  const merged = {};

  for (const [key, suffix] of cols) {
    const base = `${UBNT_WL_STAT}${suffix}`;
    try {
      let data = {};
      try {
        data = await snmpWalk(host, community, base);
      } catch {
        if (router) data = await snmpGetViaRouter(router, host, community, [base]);
      }
      const first = Object.values(data)[0];
      if (first != null) merged[key] = first;
    } catch { /* column unavailable on this firmware */ }
  }

  if (!Object.keys(merged).length) return null;

  const signal = normalizeDbm(merged.signal ?? merged.rssi);
  const rssi = normalizeDbm(merged.rssi ?? merged.signal);
  const ccq = normalizeCcq(merged.ccq);
  const noiseFloor = normalizeDbm(merged.noiseFloor);
  const snr = signal != null && noiseFloor != null ? signal - noiseFloor : null;

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
    signalDbm: signal,
    rssiDbm: rssi,
    ccqPercent: ccq,
    noiseFloorDbm: noiseFloor,
    snrDb: snr,
    txRateMbps: merged.txRate ? Number(merged.txRate) : null,
    rxRateMbps: merged.rxRate ? Number(merged.rxRate) : null,
    warnings,
    linkQuality: ccq ?? (signal != null ? Math.min(100, Math.max(0, 100 + signal)) : null),
  };
}

export async function pollDeviceSnmp(equipment, router = null) {
  const host = equipment.ipAddress?.trim();
  const community = equipment.snmpCommunity?.trim() || 'public';
  if (!host) throw new Error('Equipo sin IP para SNMP');

  let data = {};
  let pollMethod = 'direct';

  try {
    data = await snmpGet(host, community, SNMP_OIDS);
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
  const isUbiquiti = /ubiquiti|litebeam|nanostation|powerbeam|airmax/i.test(
    `${equipment.brand || ''} ${equipment.model || ''} ${equipment.name || ''} ${data[SYS_DESCR] || ''}`,
  );
  if (online && isUbiquiti) {
    try {
      wireless = await walkUbntWireless(host, community, pollMethod === 'router' ? router : null);
    } catch { /* wireless stats optional */ }
  }

  return {
    online,
    sysName: data[SYS_NAME] || equipment.name,
    sysDescr: data[SYS_DESCR] || null,
    uptime: uptimeRaw != null ? formatUptime(uptimeRaw) : null,
    uptimeTicks: uptimeRaw,
    wireless,
    polledAt: new Date().toISOString(),
    host,
    pollMethod,
    community: community === 'public' ? 'public' : '***',
  };
}

export async function pollEquipmentList(items, routerBySiteId = new Map()) {
  const results = [];
  for (const eq of items) {
    if (!eq.ipAddress || !eq.snmpCommunity) {
      results.push({ id: eq.id, name: eq.name, skipped: true, reason: 'Sin IP o community SNMP' });
      continue;
    }
    const router = eq.siteId ? routerBySiteId.get(eq.siteId) : null;
    try {
      const snmpData = await pollDeviceSnmp(eq, router);
      results.push({ id: eq.id, name: eq.name, ...snmpData });
    } catch (err) {
      results.push({ id: eq.id, name: eq.name, online: false, error: err.message });
    }
  }
  return results;
}
