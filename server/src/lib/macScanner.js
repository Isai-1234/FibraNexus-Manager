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

async function scanMikrotikForMac(router, targetMac) {
  // 1. DHCP leases
  try {
    const leases = await listDhcpLeases(router);
    const hit = leases.find(l => macMatches(l['mac-address'], targetMac));
    if (hit?.address) {
      return { found: true, ip: String(hit.address).split('/')[0], source: 'dhcp' };
    }
  } catch (e) {
    console.log(`[MacScan] MikroTik DHCP ${router.name}: ${e.message.slice(0, 50)}`);
  }

  // 2. ARP table
  try {
    const arp = await mikrotikRequest(router, 'GET', '/ip/arp');
    const entries = Array.isArray(arp) ? arp : [];
    const hit = entries.find(e => e.address && macMatches(e['mac-address'], targetMac));
    if (hit) {
      return { found: true, ip: String(hit.address).split('/')[0], source: 'arp' };
    }
  } catch (e) {
    console.log(`[MacScan] MikroTik ARP ${router.name}: ${e.message.slice(0, 50)}`);
  }

  return { found: false };
}

async function scanEdgeOSForMac(router, targetMac) {
  const host = resolveHost(router);
  const port = resolvePort(router);
  if (!host) return { found: false };

  let cookie, csrfToken;
  try {
    const { user, pass } = getRouterCredentials(router);
    ({ cookie, csrfToken } = await edgeosLogin({ host, port, user, pass, timeout: 5000 }));
  } catch (e) {
    console.log(`[MacScan] EdgeOS login ${router.name}: ${e.message.slice(0, 60)}`);
    return { found: false };
  }

  // 1. DHCP leases
  try {
    const data = await edgeosDataGet({ host, port, cookie, csrfToken, dataPath: 'dhcp_leases', timeout: 3000 });
    const pools = data?.data?.leases?.['dhcp-leases'] || data?.data?.['dhcp-leases'] || {};
    for (const poolLeases of Object.values(pools)) {
      const arr = Array.isArray(poolLeases) ? poolLeases : [];
      const hit = arr.find(l => macMatches(l['mac-addr'] || l['mac-address'], targetMac));
      if (hit) {
        const ip = hit['ip-addr'] || hit.ip;
        if (ip) return { found: true, ip, source: 'dhcp' };
      }
    }
  } catch (e) {
    console.log(`[MacScan] EdgeOS DHCP ${router.name}: ${e.message.slice(0, 50)}`);
  }

  // 2. ARP table
  try {
    const arpData = await edgeosDataGet({ host, port, cookie, csrfToken, dataPath: 'arp_table', timeout: 3000 });
    const table = arpData?.data?.arp_table || arpData?.data?.arp || arpData?.arp_table || {};
    // formato: { "192.168.x.y": { "mac-address": "...", ... } }
    for (const [ip, entry] of Object.entries(table)) {
      const mac = typeof entry === 'object'
        ? (entry['mac-address'] || entry['mac-addr'] || entry.mac)
        : entry;
      if (macMatches(mac, targetMac)) return { found: true, ip, source: 'arp' };
    }
    // formato alternativo: array de entradas
    if (Array.isArray(table)) {
      const hit = table.find(e => macMatches(e['mac-address'] || e['mac-addr'], targetMac));
      if (hit) return { found: true, ip: hit.ip || hit['ip-addr'], source: 'arp' };
    }
  } catch (e) {
    console.log(`[MacScan] EdgeOS ARP ${router.name}: ${e.message.slice(0, 50)}`);
  }

  return { found: false };
}

export async function scanRouterForMac(router, targetMac) {
  const creds = router.credentials || {};
  const routerType = creds.routerType || '';
  const isMikrotik = routerType.startsWith('mikrotik') || (router.brand || '').toLowerCase().includes('mikrotik');
  const isEdgeRouter = isEdgeRouterType(routerType) || (router.brand || '').toLowerCase().includes('ubiquiti');

  try {
    if (isMikrotik && creds.routerUser && creds.routerPass) return await scanMikrotikForMac(router, targetMac);
    if (isEdgeRouter && creds.routerUser && creds.routerPass) return await scanEdgeOSForMac(router, targetMac);
  } catch (e) {
    console.log(`[MacScan] ${router.name}: ${e.message.slice(0, 60)}`);
  }
  return { found: false };
}
