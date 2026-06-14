import { db } from '../db/index.js';
import { equipment } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { orgFilter, inferConnectionMethod } from './tenant.js';
import { testRouterConnection } from './routerClient.js';
import { isEdgeRouterType } from './edgeosClient.js';

const STALE_MS = 2 * 60 * 1000;

export function isApiPollableRouter(router) {
  if (router.type !== 'router') return false;
  const creds = router.credentials || {};
  if (!creds.routerUser || !creds.routerPass) return false;
  const type = creds.routerType || '';
  if (isEdgeRouterType(type)) {
    // Sin tunnel configurado → modo heartbeat únicamente, no pollear por API
    const method = inferConnectionMethod(router);
    if (method === 'cloudflare_tunnel') return !!creds.tunnelHostname;
    if (method === 'direct') return !!router.ipAddress;
    return false;
  }
  const method = inferConnectionMethod(router);
  if (method === 'cloudflare_tunnel' && creds.tunnelHostname) return true;
  if (method === 'direct' && router.ipAddress) return true;
  if (method === 'vpn' && router.ipAddress) return true;
  return false;
}

export function isRouterPollStale(router, staleMs = STALE_MS) {
  const creds = router.credentials || {};
  const type = creds.routerType || '';
  if (String(type).startsWith('mikrotik') && router.lastSeen && router.status === 'online') {
    const age = Date.now() - new Date(router.lastSeen).getTime();
    if (age < 90_000) return false;
  }
  if (!router.lastSeen) return true;
  return Date.now() - new Date(router.lastSeen).getTime() > staleMs;
}

export async function pollRouterApi(router) {
  try {
    const info = await testRouterConnection(router);
    return { online: true, routerInfo: info, error: null };
  } catch (err) {
    return { online: false, routerInfo: null, error: err.message };
  }
}

export async function persistRouterPollResult(router, result) {
  const creds = { ...(router.credentials || {}), lastRouterInfo: result.routerInfo || null, lastPollError: result.error || null };
  const [updated] = await db.update(equipment).set({
    status: result.online ? 'online' : 'offline',
    lastSeen: new Date(),
    credentials: creds,
    firmware: result.routerInfo?.version ? String(result.routerInfo.version).slice(0, 50) : router.firmware,
    updatedAt: new Date(),
  }).where(eq(equipment.id, router.id)).returning();
  return updated;
}

export async function pollAllRoutersForOrg(orgId, { maxPoll = 20 } = {}) {
  const routers = await db.select().from(equipment)
    .where(and(eq(equipment.type, 'router'), orgFilter(equipment, orgId)));

  const candidates = routers.filter((r) => isApiPollableRouter(r) && isRouterPollStale(r));
  const toPoll = candidates.slice(0, maxPoll);

  // Paralelo: N routers offline ya no suman sus timeouts de 6s c/u
  const results = await Promise.all(
    toPoll.map(async (router) => {
      const result = await pollRouterApi(router);
      await persistRouterPollResult(router, result);
      return result;
    }),
  );

  const online = results.filter((r) => r.online).length;
  const offline = results.filter((r) => !r.online).length;
  return { polled: toPoll.length, online, offline, skipped: routers.length - toPoll.length };
}

export async function refreshStaleRouters(routers, orgId, { maxPoll = 10 } = {}) {
  const stale = routers.filter((r) => isApiPollableRouter(r) && isRouterPollStale(r));
  if (!stale.length) return routers;

  const toPoll = stale.slice(0, maxPoll);
  const byId = new Map(routers.map((r) => [r.id, { ...r }]));

  for (const router of toPoll) {
    const result = await pollRouterApi(router);
    const updated = await persistRouterPollResult(router, result);
    byId.set(router.id, {
      ...byId.get(router.id),
      ...updated,
      routerInfo: result.routerInfo || updated.credentials?.lastRouterInfo || null,
    });
  }

  return routers.map((r) => byId.get(r.id) || r);
}
