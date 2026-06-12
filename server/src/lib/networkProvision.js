import crypto from 'crypto';
import { db } from '../db/index.js';
import { clientServices, clients, plans, users, equipment } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { orgFilter } from './tenant.js';
import {
  createPppoeSecret,
  createSimpleQueue,
  setPppoeSecretDisabled,
  disableSimpleQueue,
  buildQueueLimits,
  testRouterConnection,
} from './mikrotikClient.js';

function generatePppCredentials(clientId, serviceId) {
  const username = `fn${clientId}s${serviceId}`;
  const password = crypto.randomBytes(6).toString('hex');
  return { username, password };
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

export async function provisionServiceNetwork(serviceId, orgId, routerId, provisionMode = 'both') {
  const ctx = await loadServiceContext(serviceId, orgId);
  if (!ctx) throw new Error('Servicio no encontrado');

  const router = await loadRouter(routerId, orgId);
  if (!router) throw new Error('Router no encontrado');

  await testRouterConnection(router);

  const mode = ['pppoe', 'queue', 'both'].includes(provisionMode) ? provisionMode : 'both';
  const doPppoe = mode === 'pppoe' || mode === 'both';
  const doQueue = mode === 'queue' || mode === 'both';

  let username = ctx.service.pppoeUsername;
  let password = ctx.service.pppoePassword;
  if (doPppoe && (!username || !password)) {
    ({ username, password } = generatePppCredentials(ctx.client.id, serviceId));
  }

  const profile = ctx.service.pppProfile || 'default';
  const queueName = ctx.service.queueName || (username ? `q-${username}` : `q-s${serviceId}`);
  const maxLimit = buildQueueLimits(ctx.plan.uploadSpeed, ctx.plan.downloadSpeed);

  if (doPppoe) {
    if (!username || !password) throw new Error('PPPoE requiere usuario — crea primero el secret o usa modo cola con IP');
    await createPppoeSecret(router, {
      username,
      password,
      profile,
      comment: `FibraNexus: ${ctx.client.fullName}`,
    });
  }

  if (doQueue) {
    const target = username || ctx.service.ipAddress;
    if (!target) throw new Error('Simple Queue requiere usuario PPPoE o una IP estática en el servicio');
    await createSimpleQueue(router, {
      name: queueName,
      target,
      maxLimit,
      comment: ctx.plan.name,
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
