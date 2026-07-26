import { db } from '../db/index.js';
import { clientServices, clients, equipment, ipAddresses, detectedDevices, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { orgFilter } from './tenant.js';
import { parseCidr } from './edgeosCommands.js';

export function ipToLong(ip) {
  const parts = String(ip || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function longToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function subnetMeta(cidrInput) {
  const raw = String(cidrInput || '').trim();
  const cidr = raw.includes('/') ? raw : `${raw}/24`;
  const net = parseCidr(cidr);
  const hostBits = 32 - net.maskBits;
  const totalAddresses = hostBits >= 31 ? (hostBits === 32 ? 1 : 2) : (2 ** hostBits);
  const usable = hostBits >= 31 ? totalAddresses : Math.max(0, totalAddresses - 2);
  return {
    subnet: net.subnet,
    networkAddress: net.networkAddress,
    broadcastAddress: net.broadcastAddress,
    maskBits: net.maskBits,
    netNum: ipToLong(net.networkAddress),
    bcastNum: ipToLong(net.broadcastAddress),
    totalUsable: usable,
    defaultGateway: longToIp((ipToLong(net.networkAddress) + 1) >>> 0),
  };
}

export function ipInSubnet(ip, meta) {
  const n = ipToLong(String(ip || '').split('/')[0]);
  if (n == null || meta.netNum == null || meta.bcastNum == null) return false;
  return n >= meta.netNum && n <= meta.bcastNum;
}

export function guessPoolType(name = '', subnet = '') {
  const s = `${name} ${subnet}`.toLowerCase();
  if (/gesti[oó]n|mgmt|management|loopback/.test(s)) return 'management';
  if (/empres|business|corp|oficina/.test(s)) return 'business';
  if (/inal[aá]m|wisp|wifi|wireless|radio|airmax/.test(s)) return 'wireless';
  return 'residential';
}

/** Recolecta IPs vistas en la org (servicios, equipos, inventario IP, detectados). */
export async function collectOrgIpUsage(orgId) {
  const [services, eqs, inventory, detected] = await Promise.all([
    db.select({
      ip: clientServices.ipAddress,
      clientId: clientServices.clientId,
      serviceId: clientServices.id,
      clientName: users.fullName,
    })
      .from(clientServices)
      .innerJoin(clients, eq(clientServices.clientId, clients.id))
      .leftJoin(users, eq(clients.userId, users.id))
      .where(orgFilter(clients, orgId)),
    db.select({
      ip: equipment.ipAddress,
      equipmentId: equipment.id,
      name: equipment.name,
      type: equipment.type,
    })
      .from(equipment)
      .where(orgFilter(equipment, orgId)),
    db.select({
      ip: ipAddresses.address,
      status: ipAddresses.status,
    })
      .from(ipAddresses)
      .where(orgFilter(ipAddresses, orgId)),
    db.select({
      ip: detectedDevices.ipAddress,
      mac: detectedDevices.macAddress,
      hostname: detectedDevices.hostname,
    })
      .from(detectedDevices)
      .where(orgFilter(detectedDevices, orgId)),
  ]);

  const map = new Map();

  function add(ipRaw, source, extra = {}) {
    const ip = String(ipRaw || '').split('/')[0].trim();
    if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return;
    const prev = map.get(ip) || { ip, sources: [], clientName: null, label: null };
    if (!prev.sources.includes(source)) prev.sources.push(source);
    if (extra.clientName) prev.clientName = extra.clientName;
    if (extra.label) prev.label = extra.label;
    map.set(ip, prev);
  }

  for (const s of services) {
    if (s.ip) add(s.ip, 'service', { clientName: s.clientName, label: s.clientName || `Servicio #${s.serviceId}` });
  }
  for (const e of eqs) {
    if (e.ip) add(e.ip, 'equipment', { label: e.name });
  }
  for (const i of inventory) {
    if (i.ip) add(i.ip, 'inventory');
  }
  for (const d of detected) {
    if (d.ip) add(d.ip, 'detected', { label: d.hostname || d.mac });
  }

  return [...map.values()];
}

export function attachUsageToPool(pool, allUsed, code) {
  let meta;
  try {
    meta = subnetMeta(pool.subnet);
  } catch (e) {
    return {
      ...pool,
      code,
      totalUsable: 0,
      usedCount: 0,
      freeCount: 0,
      usagePercent: 0,
      usedIps: [],
      parseError: e.message,
    };
  }
  const usedIps = allUsed.filter((u) => ipInSubnet(u.ip, meta));
  const usedCount = usedIps.length;
  const freeCount = Math.max(0, meta.totalUsable - usedCount);
  const usagePercent = meta.totalUsable > 0
    ? Math.min(100, Math.round((usedCount / meta.totalUsable) * 100))
    : 0;
  return {
    ...pool,
    code,
    subnet: meta.subnet,
    totalUsable: meta.totalUsable,
    usedCount,
    freeCount,
    usagePercent,
    usedIps: usedIps.slice(0, 200),
  };
}

/** Sugiere pools /24 a partir de IPs ya vistas (cuando aún no hay pools). */
export function suggestPoolsFromUsage(allUsed) {
  const buckets = new Map();
  for (const u of allUsed) {
    const parts = u.ip.split('.');
    if (parts.length !== 4) continue;
    const key = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(u);
  }
  return [...buckets.entries()]
    .map(([subnet, ips], idx) => {
      const gw = subnet.replace('.0/24', '.1');
      const name = `Red ${subnet.split('/')[0]}`;
      return {
        suggested: true,
        code: `S-${String(idx + 1).padStart(2, '0')}`,
        name,
        subnet,
        gateway: gw,
        dns: '8.8.8.8, 1.1.1.1',
        vlan: null,
        poolType: guessPoolType(name, subnet),
        status: 'active',
        usedCount: ips.length,
        totalUsable: 254,
        freeCount: Math.max(0, 254 - ips.length),
        usagePercent: Math.min(100, Math.round((ips.length / 254) * 100)),
      };
    })
    .sort((a, b) => b.usedCount - a.usedCount);
}
