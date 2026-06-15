import { mikrotikRequest } from './mikrotikClient.js';
import { listDhcpLeases } from './mikrotikNetwork.js';
import { edgeosLogin, edgeosDataGet, resolveHost, resolvePort, getRouterCredentials, isEdgeRouterType } from './edgeosClient.js';

function normalizeMac(mac) {
  if (!mac) return null;
  const clean = String(mac).toLowerCase().replace(/[^0-9a-f]/g, '');
  if (clean.length !== 12) return null;
  return clean.replace(/(.{2})(?=.)/g, '$1:');
}

function macMatches(a, b) {
  const na = normalizeMac(a);
  const nb = normalizeMac(b);
  return !!(na && nb && na === nb);
}

// Búsqueda recursiva: recorre cualquier estructura JSON buscando la MAC
// y devuelve la IP asociada si la encuentra junto a campos ip/ip-addr/ip-address
function deepSearchMac(obj, targetMac, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== 'object') return null;

  const MAC_FIELDS = ['mac', 'mac-addr', 'mac-address'];
  const IP_FIELDS  = ['ip', 'ip-addr', 'ip-address'];

  if (!Array.isArray(obj)) {
    for (const mf of MAC_FIELDS) {
      if (obj[mf] && macMatches(obj[mf], targetMac)) {
        for (const ipf of IP_FIELDS) {
          if (obj[ipf]) return String(obj[ipf]).split('/')[0];
        }
      }
    }
  }

  for (const val of (Array.isArray(obj) ? obj : Object.values(obj))) {
    const res = deepSearchMac(val, targetMac, depth + 1);
    if (res) return res;
  }
  return null;
}

// ─── MikroTik ────────────────────────────────────────────────
async function scanMikrotikForMac(router, targetMac) {
  // 1. DHCP leases
  try {
    const leases = await listDhcpLeases(router);
    const hit = leases.find(l => macMatches(l['mac-address'], targetMac));
    if (hit?.address) {
      return { found: true, ip: String(hit.address).split('/')[0], source: 'dhcp' };
    }
  } catch (e) {
    console.log(`[MacScan] MikroTik DHCP ${router.name}: ${e.message.slice(0, 60)}`);
  }

  // 2. ARP table
  try {
    const arp = await mikrotikRequest(router, 'GET', '/ip/arp');
    const entries = Array.isArray(arp) ? arp : [];
    const hit = entries.find(e => e.address && macMatches(e['mac-address'], targetMac));
    if (hit) return { found: true, ip: String(hit.address).split('/')[0], source: 'arp' };
  } catch (e) {
    console.log(`[MacScan] MikroTik ARP ${router.name}: ${e.message.slice(0, 60)}`);
  }

  return { found: false };
}

// ─── EdgeOS ──────────────────────────────────────────────────
async function scanEdgeOSForMac(router, targetMac) {
  const host = resolveHost(router);
  const port = resolvePort(router);
  if (!host) return { found: false };

  let cookie, csrfToken;
  try {
    const { user, pass } = getRouterCredentials(router);
    ({ cookie, csrfToken } = await edgeosLogin({ host, port, user, pass, timeout: 6000 }));
  } catch (e) {
    console.log(`[MacScan] EdgeOS login ${router.name}: ${e.message.slice(0, 80)}`);
    return { found: false };
  }

  // 1. DHCP leases
  try {
    const data = await edgeosDataGet({ host, port, cookie, csrfToken, dataPath: 'dhcp_leases', timeout: 5000 });
    const raw = JSON.stringify(data);
    console.log(`[MacScan] EdgeOS dhcp_leases raw (${raw.length}b): ${raw.slice(0, 600)}`);

    const leaseRoot = data?.data?.leases ?? data?.data ?? data;

    // Formato A: { "dhcp-leases": { poolName: [ {ip-addr, mac-addr} ] } }
    const poolsA = leaseRoot?.['dhcp-leases'] ?? {};
    for (const poolLeases of Object.values(poolsA)) {
      const arr = Array.isArray(poolLeases) ? poolLeases : [];
      const hit = arr.find(l => macMatches(l['mac-addr'] ?? l['mac-address'] ?? l.mac, targetMac));
      if (hit) {
        const ip = hit['ip-addr'] ?? hit['ip-address'] ?? hit.ip;
        if (ip) return { found: true, ip, source: 'dhcp' };
      }
    }

    // Formato B: { "dhcp-lease": { poolName: { "lease": [ {mac, ip} ] } } }
    const poolsB = leaseRoot?.['dhcp-lease'] ?? {};
    for (const poolData of Object.values(poolsB)) {
      const raw2 = poolData?.lease ?? poolData?.leases ?? poolData ?? [];
      const arr = Array.isArray(raw2) ? raw2 : [raw2];
      const hit = arr.find(l => macMatches(l.mac ?? l['mac-addr'] ?? l['mac-address'], targetMac));
      if (hit) {
        const ip = hit.ip ?? hit['ip-addr'];
        if (ip) return { found: true, ip, source: 'dhcp' };
      }
    }

    // Fallback genérico: búsqueda profunda en toda la respuesta
    const deepIp = deepSearchMac(data, targetMac);
    if (deepIp) return { found: true, ip: deepIp, source: 'dhcp' };
  } catch (e) {
    console.log(`[MacScan] EdgeOS DHCP ${router.name}: ${e.message.slice(0, 80)}`);
  }

  // 2. ARP table (intenta ambas rutas: arp_table y arp)
  for (const dataPath of ['arp_table', 'arp']) {
    try {
      const arpData = await edgeosDataGet({ host, port, cookie, csrfToken, dataPath, timeout: 4000 });
      const raw = JSON.stringify(arpData);
      console.log(`[MacScan] EdgeOS ${dataPath} raw (${raw.length}b): ${raw.slice(0, 600)}`);

      const arpRoot = arpData?.data?.arp_table ?? arpData?.data?.neighbors ?? arpData?.data?.arp ?? arpData?.data ?? {};

      // Formato: { entry: [ {ip, mac} ] } o array directo
      const entries = arpRoot?.entry ?? (Array.isArray(arpRoot) ? arpRoot : []);
      const arr = Array.isArray(entries) ? entries : [entries];
      const hit = arr.find(e => macMatches(e.mac ?? e['mac-address'] ?? e['mac-addr'], targetMac));
      if (hit) {
        const ip = hit.ip ?? hit['ip-addr'];
        if (ip) return { found: true, ip, source: 'arp' };
      }

      // Formato plano: { "ip": { mac, ... } }
      if (!Array.isArray(arpRoot) && typeof arpRoot === 'object') {
        for (const [ip, entry] of Object.entries(arpRoot)) {
          if (typeof entry === 'object') {
            const mac = entry.mac ?? entry['mac-address'] ?? entry['mac-addr'];
            if (macMatches(mac, targetMac)) return { found: true, ip, source: 'arp' };
          }
        }
      }

      // Fallback profundo
      const deepIp = deepSearchMac(arpData, targetMac);
      if (deepIp) return { found: true, ip: deepIp, source: 'arp' };
    } catch (e) {
      console.log(`[MacScan] EdgeOS ${dataPath} ${router.name}: ${e.message.slice(0, 60)}`);
    }
  }

  return { found: false };
}

// ─── Dispatcher ──────────────────────────────────────────────
export async function scanRouterForMac(router, targetMac) {
  const creds = router.credentials || {};
  const routerType = creds.routerType || '';
  const isMikrotik   = routerType.startsWith('mikrotik')  || (router.brand || '').toLowerCase().includes('mikrotik');
  const isEdgeRouter = isEdgeRouterType(routerType)       || (router.brand || '').toLowerCase().includes('ubiquiti');

  try {
    if (isMikrotik   && creds.routerUser && creds.routerPass) return await scanMikrotikForMac(router, targetMac);
    if (isEdgeRouter && creds.routerUser && creds.routerPass) return await scanEdgeOSForMac(router, targetMac);
  } catch (e) {
    console.log(`[MacScan] ${router.name}: ${e.message.slice(0, 80)}`);
  }
  return { found: false };
}
