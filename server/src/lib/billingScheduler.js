import { db } from '../db/index.js';
import { organizations, invoices, clientServices, clients, equipment } from '../db/schema.js';
import { eq, and, inArray, lte, or, isNull } from 'drizzle-orm';
import { mergeOrgSettings, daysOverdue } from './orgSettings.js';
import { createInvoiceForService } from './invoiceService.js';
import { suspendServiceNetwork } from './networkProvision.js';
import { listPppoeActive } from './mikrotikClient.js';
import { orgFilter } from './tenant.js';

const pppoeCache = new Map();

export async function getOrgSettings(orgId) {
  const [org] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return mergeOrgSettings(org?.settings);
}

export async function markOverdueInvoices(orgId) {
  const today = new Date().toISOString().split('T')[0];
  const pending = await db.select({ id: invoices.id })
    .from(invoices)
    .where(and(
      orgFilter(invoices, orgId),
      eq(invoices.status, 'pending'),
      lte(invoices.dueDate, today),
    ));

  if (!pending.length) return 0;

  await db.update(invoices)
    .set({ status: 'overdue', updatedAt: new Date() })
    .where(and(
      orgFilter(invoices, orgId),
      eq(invoices.status, 'pending'),
      lte(invoices.dueDate, today),
    ));

  return pending.length;
}

export async function runAutoBillingForOrg(orgId) {
  const settings = await getOrgSettings(orgId);
  if (!settings.billingAutoEnabled) return { generated: 0, skipped: true };

  const today = new Date().toISOString().split('T')[0];
  const activeServices = await db.select({ id: clientServices.id, status: clientServices.status })
    .from(clientServices)
    .innerJoin(clients, eq(clientServices.clientId, clients.id))
    .where(and(
      eq(clientServices.status, 'active'),
      orgFilter(clients, orgId),
      or(isNull(clientServices.nextBillingDate), lte(clientServices.nextBillingDate, today)),
    ));

  let generated = 0;
  for (const svc of activeServices) {
    if (settings.stopBillingWhenSuspended && svc.status !== 'active') continue;
    try {
      const result = await createInvoiceForService(orgId, svc.id);
      if (!result.skipped) generated += 1;
    } catch { /* skip */ }
  }
  return { generated };
}

export async function runAutoSuspendForOrg(orgId) {
  const settings = await getOrgSettings(orgId);
  if (!settings.autoSuspendEnabled) return { suspended: 0, skipped: true };

  const grace = settings.graceDaysBeforeSuspend;
  const overdueInvoices = await db.select({
    id: invoices.id,
    clientId: invoices.clientId,
    clientServiceId: invoices.clientServiceId,
    dueDate: invoices.dueDate,
  })
    .from(invoices)
    .where(and(
      orgFilter(invoices, orgId),
      eq(invoices.status, 'overdue'),
    ));

  const toSuspend = new Set();
  for (const inv of overdueInvoices) {
    if (daysOverdue(inv.dueDate) >= grace && inv.clientServiceId) {
      toSuspend.add(inv.clientServiceId);
    }
  }

  let suspended = 0;
  for (const serviceId of toSuspend) {
    const rows = await db.select({ id: clientServices.id, status: clientServices.status })
      .from(clientServices)
      .innerJoin(clients, eq(clientServices.clientId, clients.id))
      .where(and(eq(clientServices.id, serviceId), eq(clientServices.status, 'active'), orgFilter(clients, orgId)))
      .limit(1);

    if (!rows.length) continue;

    await db.update(clientServices)
      .set({ status: 'suspended', updatedAt: new Date() })
      .where(eq(clientServices.id, serviceId));

    try {
      await suspendServiceNetwork(serviceId, orgId);
    } catch { /* DB suspend still applied */ }

    suspended += 1;
  }

  return { suspended, graceDays: grace };
}

export async function runBillingJobsForOrg(orgId) {
  const settings = await getOrgSettings(orgId);
  const results = { orgId };

  if (settings.autoMarkOverdue) {
    results.overdueMarked = await markOverdueInvoices(orgId);
  }
  results.billing = await runAutoBillingForOrg(orgId);
  results.suspend = await runAutoSuspendForOrg(orgId);

  if (settings.debtNoticesEnabled) {
    try {
      const { sendOverdueDebtNotices } = await import('./debtNotices.js');
      const { invoices, clients, users } = await import('../db/schema.js');
      const { eq, and } = await import('drizzle-orm');
      const { daysOverdue } = await import('./orgSettings.js');
      results.debtNotices = await sendOverdueDebtNotices(orgId, {
        db, invoices, clients, users, orgFilter, eq, and, daysOverdue,
      });
    } catch (err) {
      results.debtNotices = { error: err.message };
    }
  }

  return results;
}

export async function runBillingJobsAllOrgs() {
  const orgs = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isActive, true));
  const results = [];
  for (const org of orgs) {
    try {
      results.push(await runBillingJobsForOrg(org.id));
    } catch (err) {
      results.push({ orgId: org.id, error: err.message });
    }
  }
  return results;
}

/** Cache PPPoE activos por org (~60s) para badge online/offline */
export async function getOnlinePppoeUsernames(orgId) {
  const cached = pppoeCache.get(orgId);
  if (cached && Date.now() - cached.at < 60000) return cached.users;

  const routers = await db.select().from(equipment)
    .where(and(orgFilter(equipment, orgId), eq(equipment.type, 'router')));

  const users = new Set();
  for (const router of routers) {
    try {
      const active = await listPppoeActive(router);
      const list = Array.isArray(active) ? active : [active];
      for (const s of list) {
        if (s?.name) users.add(s.name);
      }
    } catch { /* router offline */ }
  }

  pppoeCache.set(orgId, { at: Date.now(), users });
  return users;
}

export function clearPppoeCache(orgId) {
  if (orgId) pppoeCache.delete(orgId);
  else pppoeCache.clear();
}
