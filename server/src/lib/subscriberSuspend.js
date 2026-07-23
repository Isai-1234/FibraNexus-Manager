import dns from 'dns/promises';
import { db } from '../db/index.js';
import { clientServices, equipment, clients } from '../db/schema.js';
import { and, eq, inArray } from 'drizzle-orm';
import { orgFilter } from './tenant.js';
import { config } from './config.js';
import { isEdgeRouterType } from './routerClient.js';
import { loadServiceContext, loadRouter } from './networkProvision.js';
import { getOrgSettings } from './billingScheduler.js';
import {
  buildSuspendClientScript,
  buildReactivateClientScript,
  makePendingCmd,
} from './edgeosCommands.js';
import { appendPendingCmd } from './edgeosPending.js';
import {
  applyMikrotikSubscriberSuspend,
  removeMikrotikSubscriberSuspend,
} from './mikrotikSuspend.js';
import { listPppoeActive } from './mikrotikClient.js';

const CPE_TYPES = ['cpe', 'ap', 'ont', 'other'];

function normalizeIp(value) {
  if (!value) return null;
  return String(value).split('/')[0].trim() || null;
}

export async function resolveSubscriberIp(service, clientId, orgId, router = null) {
  const fromService = normalizeIp(service.ipAddress);
  if (fromService) return fromService;

  const cpeRows = await db.select({ ipAddress: equipment.ipAddress })
    .from(equipment)
    .where(and(
      eq(equipment.clientId, clientId),
      inArray(equipment.type, CPE_TYPES),
      orgFilter(equipment, orgId),
    ))
    .limit(10);

  for (const row of cpeRows) {
    const ip = normalizeIp(row.ipAddress);
    if (ip) return ip;
  }

  if (router && service.pppoeUsername) {
    try {
      const active = await listPppoeActive(router);
      const list = Array.isArray(active) ? active : [active];
      const session = list.find((s) => s.name === service.pppoeUsername);
      const ip = normalizeIp(session?.address);
      if (ip) return ip;
    } catch { /* sin sesión activa */ }
  }

  return null;
}

export function buildDefaultPortalUrl() {
  const base = (config.publicUrl || 'https://app.fibranexus.cl').replace(/\/$/, '');
  return `${base}/suspended`;
}

export async function getSuspendPortalUrl(orgId) {
  const settings = await getOrgSettings(orgId);
  const url = settings.suspendPortalUrl?.trim() || buildDefaultPortalUrl();
  try {
    return new URL(url).toString();
  } catch {
    return buildDefaultPortalUrl();
  }
}

export async function resolvePortalHostIps(portalUrl) {
  try {
    const host = new URL(portalUrl).hostname;
    const records = await dns.lookup(host, { all: true });
    return [...new Set(records.map((r) => r.address))];
  } catch {
    return [];
  }
}

async function queueEdgeosSuspend(router, { serviceId, clientIp, portalUrl, orgId }) {
  const portalHostIps = await resolvePortalHostIps(portalUrl);
  const iface = router.credentials?.lanInterface || 'eth2';
  const script = buildSuspendClientScript({ serviceId, clientIp, portalHostIps });
  const cmd = makePendingCmd('suspend_client', script, { serviceId, clientIp, portalUrl, iface });
  await appendPendingCmd(router.id, cmd);

  const [svc] = await db.select().from(clientServices).where(eq(clientServices.id, serviceId)).limit(1);
  const meta = {
    ...(svc?.networkMeta || {}),
    suspendState: {
      mode: 'walled-garden',
      clientIp,
      portalUrl,
      routerId: router.id,
      cmdId: cmd.id,
      status: 'pending',
      queuedAt: new Date().toISOString(),
    },
  };
  await db.update(clientServices).set({ networkMeta: meta, updatedAt: new Date() }).where(eq(clientServices.id, serviceId));

  return { queued: true, cmdId: cmd.id, clientIp, portalUrl, routerId: router.id, routerType: 'edgeos' };
}

async function queueEdgeosReactivate(router, { serviceId }) {
  const script = buildReactivateClientScript({ serviceId });
  const cmd = makePendingCmd('reactivate_client', script, { serviceId });
  await appendPendingCmd(router.id, cmd);

  const [svc] = await db.select().from(clientServices).where(eq(clientServices.id, serviceId)).limit(1);
  if (svc) {
    const meta = { ...(svc.networkMeta || {}) };
    if (meta.suspendState) {
      meta.suspendState = { ...meta.suspendState, status: 'removing', cmdId: cmd.id, removedAt: new Date().toISOString() };
    }
    await db.update(clientServices).set({ networkMeta: meta, updatedAt: new Date() }).where(eq(clientServices.id, serviceId));
  }

  return { queued: true, cmdId: cmd.id, routerId: router.id, routerType: 'edgeos' };
}

export async function suspendSubscriberNetwork(serviceId, orgId) {
  const ctx = await loadServiceContext(serviceId, orgId);
  if (!ctx?.service.routerId) {
    return { skipped: true, reason: 'Sin router vinculado al servicio' };
  }

  const router = await loadRouter(ctx.service.routerId, orgId);
  if (!router) return { skipped: true, reason: 'Router no encontrado' };

  const clientIp = await resolveSubscriberIp(ctx.service, ctx.client.id, orgId, router);
  if (!clientIp) {
    return { skipped: true, reason: 'Sin IP del abonado — asigna IP en el servicio o vincula el CPE' };
  }

  const portalUrl = await getSuspendPortalUrl(orgId);
  const routerType = router.credentials?.routerType || '';

  if (isEdgeRouterType(routerType)) {
    return queueEdgeosSuspend(router, { serviceId, clientIp, portalUrl, orgId });
  }

  const portalHostIps = await resolvePortalHostIps(portalUrl);
  const result = await applyMikrotikSubscriberSuspend(router, { serviceId, clientIp, portalIps: portalHostIps });

  await db.update(clientServices).set({
    networkMeta: {
      ...(ctx.service.networkMeta || {}),
      suspendState: {
        mode: 'walled-garden',
        clientIp,
        portalUrl,
        routerId: router.id,
        status: 'active',
        appliedAt: new Date().toISOString(),
      },
    },
    updatedAt: new Date(),
  }).where(eq(clientServices.id, serviceId));

  return { ...result, clientIp, portalUrl, routerId: router.id, routerType: 'mikrotik' };
}

export async function reactivateSubscriberNetwork(serviceId, orgId) {
  const ctx = await loadServiceContext(serviceId, orgId);
  if (!ctx?.service.routerId) {
    return { skipped: true, reason: 'Sin router vinculado al servicio' };
  }

  const router = await loadRouter(ctx.service.routerId, orgId);
  if (!router) return { skipped: true, reason: 'Router no encontrado' };

  const routerType = router.credentials?.routerType || '';

  if (isEdgeRouterType(routerType)) {
    return queueEdgeosReactivate(router, { serviceId });
  }

  const result = await removeMikrotikSubscriberSuspend(router, { serviceId });

  const meta = { ...(ctx.service.networkMeta || {}) };
  delete meta.suspendState;
  await db.update(clientServices).set({ networkMeta: meta, updatedAt: new Date() }).where(eq(clientServices.id, serviceId));

  return { ...result, routerType: 'mikrotik' };
}

export async function serviceHasOverdueInvoices(serviceId, orgId) {
  const { invoices } = await import('../db/schema.js');
  const rows = await db.select({ id: invoices.id })
    .from(invoices)
    .where(and(
      eq(invoices.clientServiceId, serviceId),
      eq(invoices.status, 'overdue'),
      orgFilter(invoices, orgId),
    ))
    .limit(1);
  return rows.length > 0;
}

export async function tryAutoReactivateAfterPayment(invoice, orgId) {
  const settings = await getOrgSettings(orgId);
  if (!settings.autoReactivateOnPayment) {
    return { skipped: true, reason: 'autoReactivateOnPayment desactivado' };
  }
  if (!invoice.clientServiceId) {
    return { skipped: true, reason: 'Factura sin servicio vinculado' };
  }

  const serviceId = invoice.clientServiceId;
  if (await serviceHasOverdueInvoices(serviceId, orgId)) {
    return { skipped: true, reason: 'Aún hay facturas vencidas del servicio' };
  }

  const ctx = await loadServiceContext(serviceId, orgId);
  if (!ctx) return { skipped: true, reason: 'Servicio no encontrado' };
  if (ctx.service.status !== 'suspended') {
    await db.update(clients)
      .set({ lifecycleStatus: 'active', updatedAt: new Date() })
      .where(eq(clients.id, ctx.service.clientId));
    return {
      reactivated: false,
      lifecycleStatus: 'active',
      reason: 'Servicio ya activo; estado CRM reactivado',
    };
  }

  await db.update(clientServices)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(clientServices.id, serviceId));

  await db.update(clients)
    .set({ lifecycleStatus: 'active', updatedAt: new Date() })
    .where(eq(clients.id, ctx.service.clientId));

  let networkResult = null;
  try {
    networkResult = await reactivateSubscriberNetwork(serviceId, orgId);
  } catch (err) {
    networkResult = { error: err.message };
  }

  return { reactivated: true, serviceId, network: networkResult, lifecycleStatus: 'active' };
}
