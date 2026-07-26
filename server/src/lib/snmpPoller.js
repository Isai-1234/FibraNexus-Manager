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

/** Presupuestos: el estado básico nunca debe perderse por una MIB lenta. */
const POLL_BUDGET_MS = 8000;
const MIN_DEVICE_BUDGET_MS = 2500;
const ROUTER_BUDGET_MS = 12000;
const WIRELESS_MIN_MS = 800;

const PRIVATE_HOST_RE = /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;

function isPrivateHost(host) {
  return PRIVATE_HOST_RE.test(String(host || ''));
}

const UBNT_WL_STAT = '1.3.6.1.4.1.41112.1.4.5.1';
const UBNT_COLS = {
  signal: 5,
  rssi: 6,
  ccq: 7,
  noiseFloor: 8,
  txRate: 9,
  rxRate: 10,
};

/** Tabla de estaciones del AP airMAX — señal del CPE aunque su IP de gestión no responda SNMP. */
const UBNT_STA = '1.3.6.1.4.1.41112.1.4.7.1';
const UBNT_STA_COLS = {
  name: 2,
  signal: 3,
  noiseFloor: 4,
  remoteIp: 10,
  txRate: 11,
  rxRate: 12,
  ccq: 16,
};

function normalizeMac(mac) {
  return String(mac || '').toLowerCase().replace(/[^0-9a-f]/g, '');
}

function isUbiquitiEquipment(eq, sysDescr = '') {
  return /ubiquiti|litebeam|nanostation|powerbeam|airmax|airos|loco/i.test(
    `${eq?.brand || ''} ${eq?.model || ''} ${eq?.name || ''} ${sysDescr}`,
  );
}

function wirelessFromRaw(merged, attempts) {
  const rawNums = ['signal', 'rssi', 'ccq', 'noiseFloor', 'txRate', 'rxRate']
    .map((k) => Number(merged[k]))
    .filter((n) => !Number.isNaN(n));
  if (rawNums.length > 0 && rawNums.every((n) => n === 0)) {
    return {
      wireless: null,
      wirelessDebug: {
        attempts,
        raw: merged,
        hint: 'SNMP OK; sin enlace airMAX (valores wireless en 0). Normal si la antena está solo cableada al router.',
      },
    };
  }

  const signal = normalizeDbm(merged.signal ?? merged.rssi);
  const rssi = normalizeDbm(merged.rssi ?? merged.signal);
  const ccq = normalizeCcq(merged.ccq);
  const noiseFloor = normalizeDbm(merged.noiseFloor);
  const snr = signal != null && noiseFloor != null ? Math.round(signal - noiseFloor) : null;

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

/** Parsea ubntStaTable indexada por MAC (últimos 6 octetos del OID). */
export function parseUbntStationTable(walkData) {
  const byMac = new Map();
  for (const [oid, raw] of Object.entries(walkData || {})) {
    if (!oid.startsWith(`${UBNT_STA}.`)) continue;
    const parts = oid.slice(UBNT_STA.length + 1).split('.');
    if (parts.length < 8) continue;
    const col = Number(parts[0]);
    const macBytes = parts.slice(-6).map((n) => Number(n));
    if (macBytes.some((n) => Number.isNaN(n) || n < 0 || n > 255)) continue;
    const mac = macBytes.map((n) => n.toString(16).padStart(2, '0')).join('');
    if (!byMac.has(mac)) byMac.set(mac, {});
    const row = byMac.get(mac);
    for (const [key, colNum] of Object.entries(UBNT_STA_COLS)) {
      if (col === colNum) row[key] = raw;
    }
  }
  return byMac;
}

async function fetchUbntStationMap(host, community, router) {
  let walkData = {};
  if (router) {
    walkData = await snmpWalkViaRouter(router, host, community, UBNT_STA);
  }
  if (!Object.keys(walkData).length) {
    try {
      walkData = await snmpWalk(host, community, UBNT_STA);
    } catch {
      walkData = {};
    }
  }
  return parseUbntStationTable(walkData);
}

async function resolveCommunity(eq) {
  const { decryptSecret } = await import('./secrets.js');
  let community = eq.snmpCommunity?.trim() || 'public';
  try {
    community = decryptSecret(community) || community;
  } catch {
    /* legacy plaintext */
  }
  return community;
}

/**
 * Si el CPE no responde SNMP pero está enlazado a un AP Ubiquiti del mismo sitio,
 * usa la fila de estación (MAC) del AP: señal, ruido, tasas e IP remota.
 */
export async function enrichFromApStations(results, devices, router) {
  const byId = new Map(results.map((r) => [r.id, { ...r }]));
  const needMac = devices.filter((d) => {
    const r = byId.get(d.id);
    const needs = !r || !r.online || !r.wireless;
    return d.macAddress && needs;
  });
  if (!needMac.length || !router) return results;

  const apCandidates = devices.filter((d) => {
    if (!isUbiquitiEquipment(d) || !d.snmpCommunity || !d.ipAddress) return false;
    const r = byId.get(d.id);
    return Boolean(r?.online) || d.status === 'online';
  });

  const stationByMac = new Map();
  // Al menos un AP respondió con su tabla de estaciones → la ausencia de una MAC es evidencia de enlace caído.
  let apTableConfirmed = false;
  for (const ap of apCandidates) {
    try {
      const community = await resolveCommunity(ap);
      const host = ap.ipAddress?.trim().split('/')[0];
      if (!host) continue;
      let map = await fetchUbntStationMap(host, community, router);
      if (map.size) {
        apTableConfirmed = true;
      } else {
        // Tabla vacía puede ser walk fallido: verificar que el AP responde y reintentar una vez.
        const sys = await snmpWalkViaRouter(router, host, community, '1.3.6.1.2.1.1');
        if (Object.keys(sys).length) {
          map = await fetchUbntStationMap(host, community, router);
          apTableConfirmed = true;
        }
      }
      for (const [mac, row] of map) {
        if (!stationByMac.has(mac)) stationByMac.set(mac, { ...row, apHost: host, apName: ap.name });
      }
    } catch {
      /* AP sin tabla de estaciones */
    }
  }

  // CPEs que se monitorean vía AP y ya no figuran en la tabla: enlace caído confirmado.
  if (apTableConfirmed) {
    for (const device of needMac) {
      const r = byId.get(device.id);
      if (r?.online) continue;
      if (device.credentials?.lastSnmp?.pollMethod !== 'ap-station') continue;
      const mac = normalizeMac(device.macAddress);
      if (stationByMac.has(mac)) continue;
      byId.set(device.id, {
        ...(r || { id: device.id, name: device.name, polledAt: new Date().toISOString() }),
        online: false,
        apConfirmedDown: true,
        error: 'El AP ya no reporta esta estación: enlace caído o CPE apagado',
      });
    }
  }

  if (!stationByMac.size && !apTableConfirmed) {
    return [...byId.values()].length ? results.map((r) => byId.get(r.id) || r) : results;
  }

  for (const device of needMac) {
    const mac = normalizeMac(device.macAddress);
    const sta = stationByMac.get(mac);
    if (!sta?.signal) continue;
    const built = wirelessFromRaw({
      signal: sta.signal,
      noiseFloor: sta.noiseFloor,
      ccq: sta.ccq,
      txRate: sta.txRate,
      rxRate: sta.rxRate,
    }, ['ap-station']);
    if (!built.wireless) continue;
    byId.set(device.id, {
      id: device.id,
      name: device.name,
      online: true,
      sysName: sta.name || device.name,
      wireless: built.wireless,
      wirelessDebug: {
        ...built.wirelessDebug,
        apHost: sta.apHost,
        apName: sta.apName,
        hint: `Señal leída desde el AP ${sta.apName || sta.apHost} (el CPE no responde SNMP directo).`,
      },
      polledAt: new Date().toISOString(),
      host: sta.remoteIp || device.ipAddress,
      stationRemoteIp: sta.remoteIp || null,
      pollMethod: 'ap-station',
      community: '***',
    });
  }

  // Incluir equipos enriquecidos que no estaban en results (p.ej. solo se polleó el AP).
  const out = results.map((r) => byId.get(r.id) || r);
  for (const [id, row] of byId) {
    if (!out.some((r) => r.id === id) && (row.pollMethod === 'ap-station' || row.apConfirmedDown)) out.push(row);
  }
  return out;
}

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
  // Respaldo del walk: las llamadas van en cola por router, así que se prueban
  // pocos índices y el tope de tiempo lo pone el presupuesto wireless del poll.
  const entries = await Promise.all(
    Object.entries(UBNT_COLS).map(async ([key, col]) => {
      for (const idx of [1, 0]) {
        const oid = `${UBNT_WL_STAT}.${col}.${idx}`;
        try {
          const val = await mikrotikSnmpGet(router, { address: host, community, oid });
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
  const built = wirelessFromRaw(merged, attempts);
  if (built.wireless) {
    console.log(`[SNMP-DEBUG] computed signal=${built.wireless.signalDbm} ccq=${built.wireless.ccqPercent} snr=${built.wireless.snrDb}`);
  }
  return built;
}

export async function pollDeviceSnmp(equipment, router = null, {
  deadlineAt = Date.now() + POLL_BUDGET_MS,
  sitePeers = [],
} = {}) {
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

  // Una IP privada nunca responde al servidor público: el intento directo solo
  // gasta 2s del presupuesto de poll. Con puente MikroTik se va directo al router.
  if (router && isPrivateHost(host)) {
    pollMethod = 'router';
    data = await snmpGetViaRouter(router, host, community, SNMP_OIDS);
    if (!Object.keys(data).length) {
      throw new Error('SNMP falló vía router: sin respuesta del equipo');
    }
  } else {
    try {
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
  }

  const uptimeRaw = data[SYS_UPTIME];
  // Vía router un OID puede perderse con el MikroTik ocupado; con cualquiera que
  // responda el equipo está vivo (antes un uptime perdido lo marcaba offline).
  const online = uptimeRaw != null || data[SYS_NAME] != null || data[SYS_DESCR] != null;

  let wireless = null;
  let wirelessDebug = null;
  const isUbiquiti = /ubiquiti|litebeam|nanostation|powerbeam|airmax|airos/i.test(
    `${equipment.brand || ''} ${equipment.model || ''} ${equipment.name || ''} ${data[SYS_DESCR] || ''}`,
  );

  if (online && isUbiquiti) {
    // Margen para devolver el resultado antes de que el batch corte el equipo.
    const wirelessBudget = deadlineAt - Date.now() - 300;
    if (wirelessBudget < WIRELESS_MIN_MS) {
      wirelessDebug = {
        attempts: ['wireless-budget-exceeded'],
        hint: 'Equipo online; sin tiempo para la MIB wireless en este ciclo.',
      };
    } else {
      try {
        const wl = await withHardTimeout(
          fetchUbntWireless(host, community, router, pollMethod),
          wirelessBudget,
          'wireless',
        );
        wireless = wl.wireless;
        wirelessDebug = wl.wirelessDebug;
      } catch (err) {
        wirelessDebug = {
          attempts: ['wireless-budget-exceeded'],
          hint: `Equipo online, MIB wireless sin responder a tiempo (${err.message}).`,
        };
      }
    }
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

async function pollOneDevice(eq, router, budgetMs) {
  if (!eq.ipAddress || !eq.snmpCommunity) {
    return { id: eq.id, name: eq.name, skipped: true, reason: 'Sin IP o community SNMP' };
  }
  const deadlineAt = Date.now() + budgetMs;
  try {
    // El techo externo va algo después del plazo interno para que el poll
    // alcance a devolver el resultado parcial (online sin wireless).
    const snmpData = await withHardTimeout(
      pollDeviceSnmp(eq, router, { deadlineAt }),
      budgetMs + 500,
      eq.name,
    );
    return { id: eq.id, name: eq.name, ...snmpData };
  } catch (err) {
    return { id: eq.id, name: eq.name, online: false, error: err.message };
  }
}

/** Menos fallos acumulados primero: un CPE caído no debe gastarse el ciclo.
 *  Los AP/sectoriales primero ayudan a enriquecer estaciones airMAX. */
function healthiestFirst(a, b) {
  const apScore = (eq) => (/sector|ap\b|base|tower|torre/i.test(eq.name || '') ? 0 : 1);
  const failA = a.credentials?.consecutiveFailures || 0;
  const failB = b.credentials?.consecutiveFailures || 0;
  return (apScore(a) - apScore(b)) || (failA - failB);
}

export async function pollEquipmentList(items, routerBySiteId = new Map(), {
  routerBudgetMs = ROUTER_BUDGET_MS,
  siteDevices = null,
} = {}) {
  const groups = new Map();
  const direct = [];
  for (const eq of items) {
    const router = eq.siteId ? routerBySiteId.get(eq.siteId) : null;
    if (!router) {
      direct.push(eq);
      continue;
    }
    if (!groups.has(router.id)) groups.set(router.id, { router, list: [] });
    groups.get(router.id).list.push(eq);
  }

  const settled = await Promise.all([
    ...direct.map((eq) => pollOneDevice(eq, null, POLL_BUDGET_MS)),
    // RouterOS atiende un comando SNMP a la vez y uno fallido deja fuera de
    // servicio a los siguientes: los CPE de un mismo router van en serie, y lo
    // que no alcanza en el ciclo conserva su último estado conocido.
    ...[...groups.values()].map(async ({ router, list }) => {
      const groupDeadline = Date.now() + routerBudgetMs;
      const out = [];
      for (const eq of [...list].sort(healthiestFirst)) {
        const remaining = groupDeadline - Date.now();
        if (out.length && remaining < MIN_DEVICE_BUDGET_MS) {
          out.push({ id: eq.id, name: eq.name, skipped: true, reason: 'Sin presupuesto de poll en este ciclo' });
          continue;
        }
        out.push(await pollOneDevice(eq, router, Math.min(POLL_BUDGET_MS, Math.max(remaining, MIN_DEVICE_BUDGET_MS))));
      }
      const peers = (siteDevices || items).filter((d) => d.siteId && list.some((x) => x.siteId === d.siteId));
      return enrichFromApStations(out, peers.length ? peers : list, router);
    }),
  ]);

  return settled.flat();
}
