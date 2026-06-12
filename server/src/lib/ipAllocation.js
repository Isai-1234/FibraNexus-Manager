import { db } from '../db/index.js';
import { equipment, clientServices, clients } from '../db/schema.js';
import { and, eq, or } from 'drizzle-orm';
import { orgFilter } from './tenant.js';
import {
  listIpPools,
  listDhcpLeases,
  listDhcpNetworks,
  listDhcpServers,
} from './mikrotikNetwork.js';
import { mikrotikRequest } from './mikrotikClient.js';
import { loadRouter } from './networkProvision.js';

async function listIpAddresses(router) {
  const data = await mikrotikRequest(router, 'GET', '/ip/address');
  return Array.isArray(data) ? data : data ? [data] : [];
}

function ipToLong(ip) {
  return ip.split('.').reduce((acc, oct) => ((acc << 8) + parseInt(oct, 10)), 0) >>> 0;
}

function expandPoolRange(ranges) {
  const result = [];
  for (const chunk of String(ranges).split(',')) {
    const s = chunk.trim();
    if (!s) continue;

    const full = s.match(/^(\d+\.\d+\.\d+\.\d+)-(\d+\.\d+\.\d+\.\d+)$/);
    if (full) {
      let cur = ipToLong(full[1]);
      const end = ipToLong(full[2]);
      while (cur <= end) {
        result.push(
          [(cur >>> 24) & 255, (cur >>> 16) & 255, (cur >>> 8) & 255, cur & 255].join('.'),
        );
        cur += 1;
      }
      continue;
    }

    const short = s.match(/^(\d+\.\d+\.\d+)\.(\d+)-(\d+)$/);
    if (short) {
      const base = short[1];
      const start = parseInt(short[2], 10);
      const end = parseInt(short[3], 10);
      for (let i = start; i <= end; i += 1) {
        result.push(`${base}.${i}`);
      }
    }
  }
  return result;
}

async function collectUsedIps(router, orgId, siteId, routerId) {
  const used = new Set();

  const [networks, leases, addresses] = await Promise.all([
    listDhcpNetworks(router).catch(() => []),
    listDhcpLeases(router).catch(() => []),
    listIpAddresses(router).catch(() => []),
  ]);

  for (const n of networks) {
    if (n.gateway) used.add(String(n.gateway).split('/')[0]);
    if (n.address) {
      const base = String(n.address).split('/')[0];
      const parts = base.split('.');
      if (parts.length === 4) used.add(`${parts[0]}.${parts[1]}.${parts[2]}.1`);
    }
  }

  for (const l of leases) {
    if (l.address) used.add(String(l.address).split('/')[0]);
  }

  for (const a of addresses) {
    if (a.address) used.add(String(a.address).split('/')[0]);
  }

  const siteFilter = siteId
    ? and(eq(equipment.siteId, siteId), orgFilter(equipment, orgId))
    : orgFilter(equipment, orgId);

  const siteEquipment = await db.select({ ipAddress: equipment.ipAddress })
    .from(equipment)
    .where(siteFilter);
  for (const e of siteEquipment) {
    if (e.ipAddress) used.add(String(e.ipAddress).split('/')[0]);
  }

  const serviceRows = await db.select({ ipAddress: clientServices.ipAddress })
    .from(clientServices)
    .innerJoin(clients, eq(clientServices.clientId, clients.id))
    .where(and(
      orgFilter(clients, orgId),
      or(
        eq(clientServices.siteId, parseInt(siteId, 10)),
        eq(clientServices.routerId, routerId),
      ),
    ));
  for (const row of serviceRows) {
    if (row.ipAddress) used.add(String(row.ipAddress).split('/')[0]);
  }

  return used;
}

async function resolvePool(router, poolName) {
  const pools = await listIpPools(router);
  if (poolName) {
    const named = pools.find((p) => p.name === poolName);
    if (named) return named;
  }
  if (pools.length === 1) return pools[0];

  const dhcpServers = await listDhcpServers(router).catch(() => []);
  if (dhcpServers[0]?.['address-pool']) {
    const linked = pools.find((p) => p.name === dhcpServers[0]['address-pool']);
    if (linked) return linked;
  }

  return pools[0] || null;
}

export async function findNextFreeIpForSite(orgId, siteId, { routerId, poolName } = {}) {
  let router = null;
  if (routerId) {
    router = await loadRouter(parseInt(routerId, 10), orgId);
  } else if (siteId) {
    const [siteRouter] = await db.select().from(equipment)
      .where(and(
        eq(equipment.siteId, parseInt(siteId, 10)),
        eq(equipment.type, 'router'),
        orgFilter(equipment, orgId),
      ))
      .limit(1);
    router = siteRouter || null;
  }

  if (!router) {
    throw new Error('No hay router MikroTik en este nodo. Vincula uno primero.');
  }

  const pool = await resolvePool(router, poolName);
  if (!pool?.ranges) {
    throw new Error('No hay pool IP en el router. Créalo en Infra → DHCP (paso 1).');
  }

  const candidates = expandPoolRange(pool.ranges);
  if (!candidates.length) {
    throw new Error(`Rango de pool inválido: ${pool.ranges}`);
  }

  const used = await collectUsedIps(router, orgId, parseInt(siteId, 10), router.id);

  for (const ip of candidates) {
    if (!used.has(ip)) {
      return {
        ip,
        pool: pool.name,
        ranges: pool.ranges,
        routerId: router.id,
        routerName: router.name,
        usedCount: used.size,
        availableInPool: candidates.length - used.size,
      };
    }
  }

  throw new Error(`No quedan IPs libres en pool "${pool.name}" (${pool.ranges})`);
}
