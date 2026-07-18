/**
 * Alertas operativas por organización (Fase 4).
 * Upsert por dedupe_key; sin Redis ni push externo.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { orgAlerts, equipment, invoices, organizations } from '../db/schema.js';
import { orgFilter } from './tenant.js';

/**
 * Abre o refresca una alerta.
 */
export async function upsertOrgAlert({
  organizationId,
  kind,
  title,
  message = null,
  severity = 'warning',
  entityType = null,
  entityId = null,
  dedupeKey,
  metadata = {},
}) {
  if (!organizationId || !kind || !dedupeKey || !title) return null;

  const existing = await db.select().from(orgAlerts)
    .where(and(
      eq(orgAlerts.organizationId, organizationId),
      eq(orgAlerts.dedupeKey, dedupeKey),
    ))
    .limit(1);

  const now = new Date();
  if (existing[0]) {
    const [updated] = await db.update(orgAlerts).set({
      severity,
      title,
      message,
      entityType,
      entityId,
      metadata,
      lastSeenAt: now,
      status: existing[0].status === 'resolved' ? 'open' : existing[0].status,
      resolvedAt: existing[0].status === 'resolved' ? null : existing[0].resolvedAt,
      updatedAt: now,
    }).where(eq(orgAlerts.id, existing[0].id)).returning();
    return updated;
  }

  const [created] = await db.insert(orgAlerts).values({
    organizationId,
    kind,
    title,
    message,
    severity,
    entityType,
    entityId,
    dedupeKey,
    metadata,
    status: 'open',
    firstSeenAt: now,
    lastSeenAt: now,
  }).returning();
  return created;
}

export async function resolveOrgAlert(organizationId, dedupeKey) {
  const now = new Date();
  await db.update(orgAlerts).set({
    status: 'resolved',
    resolvedAt: now,
    updatedAt: now,
  }).where(and(
    eq(orgAlerts.organizationId, organizationId),
    eq(orgAlerts.dedupeKey, dedupeKey),
    inArray(orgAlerts.status, ['open', 'acked']),
  ));
}

export async function ackOrgAlert(organizationId, alertId, userId) {
  const now = new Date();
  const [row] = await db.update(orgAlerts).set({
    status: 'acked',
    ackedAt: now,
    ackedBy: userId || null,
    updatedAt: now,
  }).where(and(
    eq(orgAlerts.id, alertId),
    eq(orgAlerts.organizationId, organizationId),
    eq(orgAlerts.status, 'open'),
  )).returning();
  return row;
}

export async function listOrgAlerts(organizationId, { status = 'open', limit = 50 } = {}) {
  const conditions = [eq(orgAlerts.organizationId, organizationId)];
  if (status) conditions.push(eq(orgAlerts.status, status));
  return db.select().from(orgAlerts)
    .where(and(...conditions))
    .orderBy(desc(orgAlerts.lastSeenAt))
    .limit(limit);
}

export async function countOpenAlerts(organizationId) {
  const rows = await db.select({
    severity: orgAlerts.severity,
    n: sql`count(*)::int`,
  })
    .from(orgAlerts)
    .where(and(
      eq(orgAlerts.organizationId, organizationId),
      inArray(orgAlerts.status, ['open', 'acked']),
    ))
    .groupBy(orgAlerts.severity);
  const out = { info: 0, warning: 0, critical: 0, total: 0 };
  for (const r of rows) {
    out[r.severity] = r.n;
    out.total += r.n;
  }
  return out;
}

/**
 * Escaneo periódico: routers/CPE offline, mora, agente caído.
 */
export async function refreshOperationalAlerts(organizationId) {
  const results = { routerOffline: 0, cpeOffline: 0, agentDown: 0, mora: 0 };

  const routers = await db.select({
    id: equipment.id,
    name: equipment.name,
    status: equipment.status,
    credentials: equipment.credentials,
  }).from(equipment)
    .where(and(orgFilter(equipment, organizationId), eq(equipment.type, 'router')));

  for (const r of routers) {
    const key = `router_offline:${r.id}`;
    const hasAgent = Boolean(r.credentials?.agentToken);
    if (r.status === 'offline') {
      await upsertOrgAlert({
        organizationId,
        kind: hasAgent ? 'agent_down' : 'router_offline',
        severity: 'critical',
        title: hasAgent ? `Agente caído: ${r.name}` : `Router offline: ${r.name}`,
        message: hasAgent
          ? 'Sin heartbeat reciente del agente EdgeOS/MikroTik.'
          : 'El router figura offline en inventario.',
        entityType: 'equipment',
        entityId: r.id,
        dedupeKey: key,
      });
      if (hasAgent) results.agentDown += 1;
      else results.routerOffline += 1;
    } else {
      await resolveOrgAlert(organizationId, key);
    }
  }

  const cpes = await db.select({
    id: equipment.id,
    name: equipment.name,
    status: equipment.status,
  }).from(equipment)
    .where(and(orgFilter(equipment, organizationId), eq(equipment.type, 'cpe')));

  for (const c of cpes) {
    const key = `cpe_offline:${c.id}`;
    if (c.status === 'offline') {
      await upsertOrgAlert({
        organizationId,
        kind: 'cpe_offline',
        severity: 'warning',
        title: `CPE offline: ${c.name}`,
        message: 'Antena/CPE sin respuesta reciente.',
        entityType: 'equipment',
        entityId: c.id,
        dedupeKey: key,
      });
      results.cpeOffline += 1;
    } else {
      await resolveOrgAlert(organizationId, key);
    }
  }

  const overdue = await db.select({
    id: invoices.id,
    clientId: invoices.clientId,
    total: invoices.total,
    dueDate: invoices.dueDate,
  }).from(invoices)
    .where(and(orgFilter(invoices, organizationId), eq(invoices.status, 'overdue')))
    .limit(100);

  const seenClients = new Set();
  for (const inv of overdue) {
    if (seenClients.has(inv.clientId)) continue;
    seenClients.add(inv.clientId);
    await upsertOrgAlert({
      organizationId,
      kind: 'mora',
      severity: 'warning',
      title: `Mora: factura #${inv.id}`,
      message: `Saldo vencido ${inv.total} (vence ${inv.dueDate}).`,
      entityType: 'invoice',
      entityId: inv.id,
      dedupeKey: `mora_client:${inv.clientId}`,
      metadata: { clientId: inv.clientId },
    });
    results.mora += 1;
  }

  // Resolver mora de clientes que ya no tienen overdue
  const openMora = await db.select({ id: orgAlerts.id, dedupeKey: orgAlerts.dedupeKey })
    .from(orgAlerts)
    .where(and(
      eq(orgAlerts.organizationId, organizationId),
      eq(orgAlerts.kind, 'mora'),
      inArray(orgAlerts.status, ['open', 'acked']),
    ));
  for (const a of openMora) {
    const clientId = Number(String(a.dedupeKey).replace('mora_client:', ''));
    if (!seenClients.has(clientId)) {
      await resolveOrgAlert(organizationId, a.dedupeKey);
    }
  }

  return results;
}

export async function refreshAlertsAllOrgs() {
  const orgs = await db.select({ id: organizations.id }).from(organizations)
    .where(eq(organizations.isActive, true));
  const out = [];
  for (const org of orgs) {
    try {
      out.push({ orgId: org.id, ...(await refreshOperationalAlerts(org.id)) });
    } catch (err) {
      out.push({ orgId: org.id, error: err.message });
    }
  }
  return out;
}

export async function raisePaymentFailAlert(organizationId, invoiceId, detail) {
  return upsertOrgAlert({
    organizationId,
    kind: 'payment_fail',
    severity: 'critical',
    title: `Fallo de cobro — factura #${invoiceId}`,
    message: detail || 'Webhook de pago falló o fue rechazado.',
    entityType: 'invoice',
    entityId: invoiceId,
    dedupeKey: `payment_fail:${invoiceId}`,
  });
}
