import { mikrotikRequest } from './mikrotikClient.js';

function asList(data) {
  if (!data) return [];
  return Array.isArray(data) ? data : [data];
}

// ─── IP Pools ───────────────────────────────────────────────
export async function listIpPools(router) {
  return asList(await mikrotikRequest(router, 'GET', '/ip/pool'));
}

export async function createIpPool(router, { name, ranges, comment = '' }) {
  return mikrotikRequest(router, 'PUT', '/ip/pool', { name, ranges, comment });
}

// ─── DHCP Server ────────────────────────────────────────────
export async function listDhcpServers(router) {
  return asList(await mikrotikRequest(router, 'GET', '/ip/dhcp-server'));
}

export async function listDhcpNetworks(router) {
  return asList(await mikrotikRequest(router, 'GET', '/ip/dhcp-server/network'));
}

export async function listDhcpLeases(router) {
  return asList(await mikrotikRequest(router, 'GET', '/ip/dhcp-server/lease'));
}

export async function createDhcpNetwork(router, { address, gateway, 'dns-server': dnsServer, comment = '' }) {
  const body = { address, gateway, comment };
  if (dnsServer) body['dns-server'] = dnsServer;
  return mikrotikRequest(router, 'PUT', '/ip/dhcp-server/network', body);
}

export async function createDhcpServer(router, { name, interface: iface, 'address-pool': addressPool, disabled = false }) {
  return mikrotikRequest(router, 'PUT', '/ip/dhcp-server', {
    name,
    interface: iface,
    'address-pool': addressPool,
    disabled: disabled ? 'true' : 'false',
  });
}

export async function findDhcpLeaseByAddress(router, address) {
  const ip = String(address).split('/')[0];
  const leases = await listDhcpLeases(router);
  return leases.find((l) => String(l.address).split('/')[0] === ip) || null;
}

export async function upsertDhcpStaticLease(router, { address, macAddress, comment = '', server = null }) {
  const ip = String(address).split('/')[0];
  const existing = await findDhcpLeaseByAddress(router, ip);
  const body = {
    address: ip,
    comment,
    disabled: 'false',
  };
  if (macAddress) body['mac-address'] = macAddress;
  if (server) body.server = server;

  if (existing?.['.id']) {
    await mikrotikRequest(router, 'PATCH', `/ip/dhcp-server/lease/${existing['.id']}`, body);
    return { action: 'updated', lease: existing };
  }
  await mikrotikRequest(router, 'PUT', '/ip/dhcp-server/lease', body);
  return { action: 'created' };
}

export async function removeDhcpLease(router, address) {
  const found = await findDhcpLeaseByAddress(router, address);
  if (!found?.['.id']) return null;
  return mikrotikRequest(router, 'DELETE', `/ip/dhcp-server/lease/${found['.id']}`);
}

// ─── PPP Profiles ─────────────────────────────────────────────
export async function listPppProfiles(router) {
  return asList(await mikrotikRequest(router, 'GET', '/ppp/profile'));
}

export async function createPppProfile(router, { name, 'local-address': localAddress, 'remote-address': remoteAddress, 'rate-limit': rateLimit, comment = '' }) {
  const body = { name, comment };
  if (localAddress) body['local-address'] = localAddress;
  if (remoteAddress) body['remote-address'] = remoteAddress;
  if (rateLimit) body['rate-limit'] = rateLimit;
  return mikrotikRequest(router, 'PUT', '/ppp/profile', body);
}

// ─── PPPoE Server ─────────────────────────────────────────────
export async function listPppoeServers(router) {
  return asList(await mikrotikRequest(router, 'GET', '/interface/pppoe-server/server'));
}

export async function findPppoeServerByInterface(router, iface) {
  const servers = await listPppoeServers(router);
  return servers.find((s) => s.interface === iface) || null;
}

export async function createPppoeServer(router, {
  serviceName,
  interface: iface,
  defaultProfile,
  authentication = 'pap,chap,mschap2,mschap1',
  oneSessionPerHost = true,
  comment = '',
}) {
  return mikrotikRequest(router, 'PUT', '/interface/pppoe-server/server', {
    'service-name': serviceName,
    interface: iface,
    'default-profile': defaultProfile,
    authentication,
    'one-session-per-host': oneSessionPerHost ? 'yes' : 'no',
    disabled: 'false',
    comment,
  });
}

export async function upsertPppoeServer(router, opts) {
  const existing = await findPppoeServerByInterface(router, opts.interface);
  const body = {
    'service-name': opts.serviceName,
    'default-profile': opts.defaultProfile,
    authentication: opts.authentication || 'pap,chap,mschap2,mschap1',
    'one-session-per-host': opts.oneSessionPerHost !== false ? 'yes' : 'no',
    disabled: 'false',
    comment: opts.comment || '',
  };
  if (existing?.['.id']) {
    await mikrotikRequest(router, 'PATCH', `/interface/pppoe-server/server/${existing['.id']}`, body);
    return { action: 'updated', server: existing };
  }
  await createPppoeServer(router, opts);
  return { action: 'created' };
}

// ─── Interfaces (para elegir en DHCP) ───────────────────────
export async function listInterfaces(router) {
  return asList(await mikrotikRequest(router, 'GET', '/interface'));
}

export async function getRouterNetworkSnapshot(router) {
  const [pools, dhcpServers, dhcpNetworks, dhcpLeases, pppProfiles, pppoeServers, interfaces] = await Promise.all([
    listIpPools(router).catch(() => []),
    listDhcpServers(router).catch(() => []),
    listDhcpNetworks(router).catch(() => []),
    listDhcpLeases(router).catch(() => []),
    listPppProfiles(router).catch(() => []),
    listPppoeServers(router).catch(() => []),
    listInterfaces(router).catch(() => []),
  ]);
  return {
    ipPools: pools,
    dhcpServers,
    dhcpNetworks,
    dhcpLeases,
    pppProfiles,
    pppoeServers,
    interfaces: interfaces.filter((i) => !i.disabled || i.disabled === 'false').map((i) => ({
      name: i.name,
      type: i.type,
      running: i.running,
    })),
  };
}

// ─── SNMP vía router (para CPE en LAN privada) ──────────────
const SNMP_BRIDGE_TIMEOUT_MS = 3000;
const SYSTEM_SUBTREE = '1.3.6.1.2.1.1';

/**
 * RouterOS atiende /tool/snmp-* de forma bloqueante: un CPE que no responde
 * retiene el comando varios segundos y dejaba sin turno a los equipos vivos del
 * mismo router. Se serializa por router y cada llamada lleva su propio tope.
 */
const routerSnmpChain = new Map();

function queueRouterSnmp(router, fn) {
  const key = router?.id ?? router?.ipAddress ?? 'default';
  const prev = routerSnmpChain.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  routerSnmpChain.set(key, next.then(() => {}, () => {}));
  return next;
}

export async function mikrotikSnmpGet(router, { address, community, oid, timeoutMs = SNMP_BRIDGE_TIMEOUT_MS }) {
  return queueRouterSnmp(router, async () => {
    const res = await mikrotikRequest(router, 'POST', '/tool/snmp-get', {
      address,
      community,
      oid,
      'as-value': '',
    }, { timeoutMs });
    if (Array.isArray(res)) {
      const row = res[0] || {};
      return row.value ?? row['value'] ?? null;
    }
    if (res && typeof res === 'object') {
      return res.value ?? res['value'] ?? null;
    }
    return res ?? null;
  });
}

export async function mikrotikSnmpWalk(router, { address, community, oid, timeoutMs = SNMP_BRIDGE_TIMEOUT_MS }) {
  return queueRouterSnmp(router, async () => {
    try {
      const res = await mikrotikRequest(router, 'POST', '/tool/snmp-walk', {
        address,
        community,
        oid,
      }, { timeoutMs });
      return asList(res);
    } catch {
      return [];
    }
  });
}

export async function snmpGetViaRouter(router, host, community, oids) {
  // Un walk del subárbol system cuesta ~250ms y trae todos los OIDs básicos;
  // los snmp-get individuales costaban ~800ms cada uno y saturaban el router.
  const walk = await snmpWalkViaRouter(router, host, community, SYSTEM_SUBTREE);
  const fromWalk = {};
  for (const oid of oids) {
    if (walk[oid] != null) fromWalk[oid] = walk[oid];
  }
  if (Object.keys(fromWalk).length) return fromWalk;

  const entries = await Promise.all(
    oids.map(async (oid) => {
      try {
        const val = await mikrotikSnmpGet(router, { address: host, community, oid });
        if (val != null) return [oid, String(val)];
      } catch { /* OID no disponible o timeout */ }
      return null;
    }),
  );
  return Object.fromEntries(entries.filter(Boolean));
}

export async function snmpWalkViaRouter(router, host, community, baseOid) {
  const rows = await mikrotikSnmpWalk(router, { address: host, community, oid: baseOid });
  const out = {};
  for (const row of rows) {
    const oid = row.oid ?? row['.oid'] ?? row.name;
    const val = row.value ?? row['value'];
    if (oid && val != null) out[String(oid).replace(/^\./, '')] = String(val);
  }
  return out;
}
