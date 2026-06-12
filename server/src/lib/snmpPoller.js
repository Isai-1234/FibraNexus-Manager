import snmp from 'net-snmp';
import { snmpGetViaRouter } from './mikrotikNetwork.js';

const SYS_DESCR = '1.3.6.1.2.1.1.1.0';
const SYS_NAME = '1.3.6.1.2.1.1.5.0';
const SYS_UPTIME = '1.3.6.1.2.1.1.3.0';
const SNMP_OIDS = [SYS_DESCR, SYS_NAME, SYS_UPTIME];

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

  return {
    online,
    sysName: data[SYS_NAME] || equipment.name,
    sysDescr: data[SYS_DESCR] || null,
    uptime: uptimeRaw != null ? formatUptime(uptimeRaw) : null,
    uptimeTicks: uptimeRaw,
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
