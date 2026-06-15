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
// en CUALQUIER campo (no solo los nombrados estándar) y devuelve la IP
function deepSearchMac(obj, targetMac, depth = 0) {
  if (depth > 8 || !obj || typeof obj !== 'object') return null;

  const IP_FIELDS = ['ip', 'ip-addr', 'ip-address', 'address', 'fixed-address'];

  if (!Array.isArray(obj)) {
    // Buscar MAC en cualquier campo de string del objeto
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'string' && macMatches(val, targetMac)) {
        // Encontró la MAC — buscar IP en el mismo objeto
        for (const ipf of IP_FIELDS) {
          if (obj[ipf]) return String(obj[ipf]).split('/')[0];
        }
        // Si la clave padre es una IP, devolverla
        break;
      }
    }
  }

  for (const [key, val] of (Array.isArray(obj)
    ? obj.map((v, i) => [i, v])
    : Object.entries(obj))) {
    const res = deepSearchMac(val, targetMac, depth + 1);
    if (res) return res;
    // Caso especial: la clave ES la IP y el valor contiene la MAC
    if (!Array.isArray(obj) && typeof val === 'object' && val !== null) {
      const macInVal = Object.values(val).some(v => typeof v === 'string' && macMatches(v, targetMac));
      if (macInVal && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(key))) return String(key);
    }
  }
  return null;
}

// Búsqueda bruta por string: si la MAC aparece en cualquier lugar del JSON
// (con cualquier formato: colons, guiones, sin separador, mayúsculas),
// extrae la IP más cercana del contexto.
function bruteForceMacSearch(jsonStr, targetMac) {
  const norm = normalizeMac(targetMac);
  if (!norm) return null;
  const hex = norm.replace(/:/g, '');

  // Generar todas las variantes posibles del MAC
  const variants = [
    norm,                            // 44:d9:e7:b8:a1:36
    norm.toUpperCase(),              // 44:D9:E7:B8:A1:36
    hex,                             // 44d9e7b8a136
    hex.toUpperCase(),               // 44D9E7B8A136
    norm.replace(/:/g, '-'),         // 44-d9-e7-b8-a1-36
    norm.replace(/:/g, '-').toUpperCase(), // 44-D9-E7-B8-A1-36
  ];

  for (const v of variants) {
    const idx = jsonStr.indexOf(v);
    if (idx === -1) continue;
    // Tomar contexto alrededor del match y buscar una IP
    const ctx = jsonStr.slice(Math.max(0, idx - 150), idx + 200);
    const ipMatch = ctx.match(/"?(?:ip|ip-addr|ip-address|address|fixed-address)"?\s*[":]\s*"?((?:\d{1,3}\.){3}\d{1,3})"?/i);
    if (ipMatch) return ipMatch[1];
    // También chequear si la clave inmediatamente anterior es una IP
    const keyMatch = jsonStr.slice(Math.max(0, idx - 60), idx).match(/"((?:\d{1,3}\.){3}\d{1,3})"\s*:/);
    if (keyMatch) return keyMatch[1];
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

    // Fallback profundo (campo con cualquier nombre)
    const deepIp = deepSearchMac(data, targetMac);
    if (deepIp) return { found: true, ip: deepIp, source: 'dhcp' };

    // Fallback bruto (busca MAC como string en el JSON completo)
    const jsonStr = JSON.stringify(data);
    const norm = normalizeMac(targetMac);
    const inJson = norm && jsonStr.toLowerCase().includes(norm.replace(/:/g, '').slice(0, 8));
    console.log(`[MacScan] EdgeOS DHCP MAC en JSON: ${inJson ? 'SÍ (parser falló)' : 'NO'}`);
    const bruteIp = bruteForceMacSearch(jsonStr, targetMac);
    if (bruteIp) return { found: true, ip: bruteIp, source: 'dhcp' };
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

      // Fallback profundo + bruto
      const deepIp = deepSearchMac(arpData, targetMac);
      if (deepIp) return { found: true, ip: deepIp, source: 'arp' };
      const bruteIp = bruteForceMacSearch(JSON.stringify(arpData), targetMac);
      if (bruteIp) return { found: true, ip: bruteIp, source: 'arp' };
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
