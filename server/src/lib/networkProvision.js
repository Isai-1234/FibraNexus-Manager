import crypto from 'crypto';
import { db } from '../db/index.js';
import { clientServices, clients, plans, users, equipment } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { orgFilter } from './tenant.js';
import {
  upsertPppoeSecret,
  upsertSimpleQueue,
  setPppoeSecretDisabled,
  disableSimpleQueue,
  removeSimpleQueue,
  findSimpleQueueByTarget,
  buildQueueLimits,
  testRouterConnection,
} from './mikrotikClient.js';
import { upsertDhcpStaticLease, removeDhcpLease } from './mikrotikNetwork.js';

function generatePppCredentials(clientId, serviceId) {
  const username = `fn${clientId}s${serviceId}`;
  const password = crypto.randomBytes(6).toString('hex');
  return { username, password };
}

/** Nombre legible en MikroTik Simple Queue (nombre del abonado) */
export function buildQueueName(fullName, serviceId) {
  const cleaned = String(fullName || '')
    .trim()
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ');
  if (!cleaned) return `Abonado-${serviceId}`;
  return cleaned.length > 63 ? `${cleaned.slice(0, 60).trim()}…` : cleaned;
}

function isLegacyQueueName(name) {
  return /^q-s\d+$/i.test(name) || /^q-fn\d+s\d+$/i.test(name);
}

export async function loadServiceContext(serviceId, orgId) {
  const rows = await db.select({
    service: clientServices,
    clientId: clients.id,
    clientOrg: clients.organizationId,
    fullName: users.fullName,
    plan: plans,
  })
    .from(clientServices)
    .innerJoin(clients, eq(clientServices.clientId, clients.id))
    .innerJoin(users, eq(clients.userId, users.id))
    .innerJoin(plans, eq(clientServices.planId, plans.id))
    .where(and(eq(clientServices.id, serviceId), orgFilter(clients, orgId)))
    .limit(1);

  if (!rows.length) return null;
  const row = rows[0];
  return {
    service: row.service,
    client: { id: row.clientId, fullName: row.fullName },
    plan: row.plan,
  };
}

export async function loadRouter(routerId, orgId) {
  const [router] = await db.select().from(equipment)
    .where(and(eq(equipment.id, routerId), eq(equipment.type, 'router'), orgFilter(equipment, orgId)))
    .limit(1);
  return router || null;
}

export async function provisionServiceNetwork(serviceId, orgId, routerId, provisionMode = 'both', options = {}) {
  const ctx = await loadServiceContext(serviceId, orgId);
  if (!ctx) throw new Error('Servicio no encontrado');

  const router = await loadRouter(routerId, orgId);
  if (!router) throw new Error('Router no encontrado');

  await testRouterConnection(router);

  const mode = ['pppoe', 'queue', 'both', 'static'].includes(provisionMode) ? provisionMode : 'both';
  const doPppoe = mode === 'pppoe' || mode === 'both';
  const doQueue = mode === 'queue' || mode === 'both' || mode === 'static';
  const doStaticLease = mode === 'static' || (mode === 'both' && ctx.service.macAddress);

  let username = ctx.service.pppoeUsername;
  let password = ctx.service.pppoePassword;
  if (doPppoe && (!username || !password)) {
    ({ username, password } = generatePppCredentials(ctx.client.id, serviceId));
  }

  const profile = options.pppProfile || ctx.service.pppProfile || 'default';
  const queueName = (!ctx.service.queueName || isLegacyQueueName(ctx.service.queueName))
    ? buildQueueName(ctx.client.fullName, serviceId)
    : ctx.service.queueName;
  const maxLimit = buildQueueLimits(ctx.plan.uploadSpeed, ctx.plan.downloadSpeed);
  const queueComment = `${ctx.client.fullName} — ${ctx.plan.name}`;
  const actions = { pppoe: null, queue: null, dhcpLease: null };

  if (doStaticLease && ctx.service.ipAddress) {
    actions.dhcpLease = await upsertDhcpStaticLease(router, {
      address: ctx.service.ipAddress,
      macAddress: ctx.service.macAddress || undefined,
      comment: ctx.client.fullName,
    });
  }

  if (doPppoe) {
    if (!username || !password) throw new Error('PPPoE requiere usuario — crea primero el secret o usa modo cola con IP');
    actions.pppoe = await upsertPppoeSecret(router, {
      username,
      password,
      profile,
      comment: `FibraNexus: ${ctx.client.fullName}`,
    });
  }

  if (doQueue) {
    const target = username || ctx.service.ipAddress;
    if (!target) throw new Error('Simple Queue requiere usuario PPPoE o una IP estática en el servicio');

    const oldQueueName = ctx.service.queueName;
    const existingOnRouter = await findSimpleQueueByTarget(router, target);

    if (oldQueueName && oldQueueName !== queueName && oldQueueName !== existingOnRouter?.name) {
      try { await removeSimpleQueue(router, oldQueueName); } catch { /* cola anterior ya no existe */ }
    }

    actions.queue = await upsertSimpleQueue(router, {
      name: queueName,
      target,
      maxLimit,
      comment: queueComment,
    });
  }

  const [updated] = await db.update(clientServices).set({
    routerId: router.id,
    ...(doPppoe && { pppoeUsername: username, pppoePassword: password, pppProfile: profile }),
    ...(doQueue && { queueName }),
    networkMeta: {
      provisionedAt: new Date().toISOString(),
      routerName: router.name,
      provisionMode: mode,
      maxLimit: doQueue ? maxLimit : null,
    },
    updatedAt: new Date(),
  }).where(eq(clientServices.id, serviceId)).returning();

  return {
    service: updated,
    router,
    username: doPppoe ? username : null,
    password: doPppoe ? password : null,
    queueName: doQueue ? queueName : null,
    maxLimit: doQueue ? maxLimit : null,
    provisionMode: mode,
    actions,
  };
}

export async function suspendServiceNetwork(serviceId, orgId) {
  const ctx = await loadServiceContext(serviceId, orgId);
  if (!ctx?.service.routerId) {
    return { skipped: true, reason: 'Sin provisión de red' };
  }

  const router = await loadRouter(ctx.service.routerId, orgId);
  if (!router) return { skipped: true, reason: 'Router no encontrado' };

  if (ctx.service.pppoeUsername) {
    await setPppoeSecretDisabled(router, ctx.service.pppoeUsername, true);
  }
  if (ctx.service.queueName) {
    await disableSimpleQueue(router, ctx.service.queueName, true);
  }

  return { success: true };
}

export async function reactivateServiceNetwork(serviceId, orgId) {
  const ctx = await loadServiceContext(serviceId, orgId);
  if (!ctx?.service.routerId) {
    return { skipped: true, reason: 'Sin provisión de red' };
  }

  const router = await loadRouter(ctx.service.routerId, orgId);
  if (!router) return { skipped: true, reason: 'Router no encontrado' };

  if (ctx.service.pppoeUsername) {
    await setPppoeSecretDisabled(router, ctx.service.pppoeUsername, false);
  }
  if (ctx.service.queueName) {
    await disableSimpleQueue(router, ctx.service.queueName, false);
  }

  return { success: true };
}
