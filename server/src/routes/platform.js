import { Router } from 'express';
import { db } from '../db/index.js';
import {
  organizations, users, plans, tickets, invoices,
  activityLog, saasInvoices,
} from '../db/schema.js';
import { eq, sql, and, inArray, desc } from 'drizzle-orm';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { trialDaysLeft } from '../lib/tenant.js';
import { getOrgUsage } from '../lib/orgLimits.js';
import { applySaasPlanToOrg, listActiveSaasPlans, limitsFromSaasPlan, getSaasPlanBySlug } from '../lib/saasPlans.js';
import { writeAuditLog, clientIp } from '../lib/auditLog.js';

export const platformRouter = Router();

platformRouter.use(authenticateToken, requireRole('superadmin'));

async function enrichOrganization(org) {
  const usage = await getOrgUsage(org.id);
  const [{ count: planCount }] = await db.select({ count: sql`count(*)` })
    .from(plans).where(eq(plans.organizationId, org.id));
  const [{ count: openTickets }] = await db.select({ count: sql`count(*)` })
    .from(tickets).where(and(eq(tickets.organizationId, org.id), eq(tickets.status, 'open')));
  const [{ total: pendingAmount }] = await db.select({ total: sql`coalesce(sum(total::decimal), 0)` })
    .from(invoices).where(and(
      eq(invoices.organizationId, org.id),
      inArray(invoices.status, ['pending', 'partial', 'overdue']),
    ));

  const days = trialDaysLeft(org);
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    email: org.email,
    plan: org.plan,
    saasPlanId: org.saasPlanId,
    subscriptionStatus: org.subscriptionStatus || 'trial',
    subscriptionEndsAt: org.subscriptionEndsAt,
    isActive: org.isActive,
    suspendedAt: org.suspendedAt,
    suspendedReason: org.suspendedReason,
    lastActivityAt: org.lastActivityAt,
    trialDaysLeft: days,
    trialEndsAt: org.trialEndsAt,
    maxRouters: org.maxRouters,
    maxClients: org.maxClients,
    maxUsers: org.maxUsers,
    maxEquipment: org.maxEquipment,
    metricsRetentionDays: org.metricsRetentionDays,
    ...usage,
    staffCount: usage.staffCount,
    planCount: Number(planCount),
    openTickets: Number(openTickets),
    pendingAmount: Number(pendingAmount || 0),
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
    trialExpiringSoon: (org.subscriptionStatus === 'trial' || org.plan === 'trial') && days != null && days <= 7,
  };
}

platformRouter.get('/saas-plans', async (req, res) => {
  try {
    res.json(await listActiveSaasPlans());
  } catch (error) {
    res.status(500).json({ error: 'Error al listar planes SaaS' });
  }
});

platformRouter.get('/dashboard', async (req, res) => {
  try {
    const orgs = await db.select().from(organizations).orderBy(desc(organizations.createdAt));
    const enriched = await Promise.all(orgs.map(enrichOrganization));

    res.json({
      stats: {
        totalOrganizations: enriched.length,
        activeOrganizations: enriched.filter((o) => o.isActive && o.subscriptionStatus !== 'suspended').length,
        activeTrials: enriched.filter((o) => o.subscriptionStatus === 'trial' && o.isActive).length,
        suspended: enriched.filter((o) => o.subscriptionStatus === 'suspended' || !o.isActive).length,
        trialsExpiringSoon: enriched.filter((o) => o.trialExpiringSoon).length,
        totalClients: enriched.reduce((s, o) => s + o.clientCount, 0),
        totalRouters: enriched.reduce((s, o) => s + o.routerCount, 0),
      },
      organizations: enriched,
      expiringSoon: enriched.filter((o) => o.trialExpiringSoon),
      recent: enriched.slice(0, 5),
    });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

platformRouter.get('/organizations', async (req, res) => {
  try {
    const orgs = await db.select().from(organizations).orderBy(desc(organizations.createdAt));
    res.json(await Promise.all(orgs.map(enrichOrganization)));
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

platformRouter.get('/organizations/:id', async (req, res) => {
  try {
    const orgId = parseInt(req.params.id);
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    if (!org) return res.status(404).json({ error: 'ISP no encontrado' });

    const staff = await db.select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      lastLogin: users.lastLogin,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
      .from(users)
      .where(and(eq(users.organizationId, orgId), inArray(users.role, ['admin', 'office', 'technician'])))
      .orderBy(users.createdAt);

    const activity = await db.select()
      .from(activityLog)
      .where(eq(activityLog.organizationId, orgId))
      .orderBy(desc(activityLog.createdAt))
      .limit(30);

    const saasInv = await db.select()
      .from(saasInvoices)
      .where(eq(saasInvoices.organizationId, orgId))
      .orderBy(desc(saasInvoices.createdAt))
      .limit(20);

    res.json({
      ...(await enrichOrganization(org)),
      staff,
      activity,
      saasInvoices: saasInv,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

platformRouter.patch('/organizations/:id', async (req, res) => {
  try {
    const orgId = parseInt(req.params.id);
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    if (!org) return res.status(404).json({ error: 'ISP no encontrado' });

    const {
      name, email, plan, trialEndsAt, isActive, maxRouters, maxClients,
      maxUsers, maxEquipment, metricsRetentionDays, subscriptionStatus, subscriptionEndsAt,
    } = req.body;
    const updates = { updatedAt: new Date() };
    if (name != null) updates.name = name;
    if (email != null) updates.email = email;
    if (trialEndsAt != null) updates.trialEndsAt = new Date(trialEndsAt);
    if (isActive != null) updates.isActive = Boolean(isActive);
    if (maxRouters != null) updates.maxRouters = parseInt(maxRouters, 10);
    if (maxClients != null) updates.maxClients = parseInt(maxClients, 10);
    if (maxUsers != null) updates.maxUsers = parseInt(maxUsers, 10);
    if (maxEquipment != null) updates.maxEquipment = parseInt(maxEquipment, 10);
    if (metricsRetentionDays != null) updates.metricsRetentionDays = parseInt(metricsRetentionDays, 10);
    if (subscriptionStatus != null) updates.subscriptionStatus = subscriptionStatus;
    if (subscriptionEndsAt != null) updates.subscriptionEndsAt = new Date(subscriptionEndsAt);

    if (plan != null && plan !== org.plan) {
      const saasPlan = await getSaasPlanBySlug(plan);
      if (saasPlan) {
        Object.assign(updates, limitsFromSaasPlan(saasPlan));
        if (plan !== 'trial' && !subscriptionStatus) {
          updates.subscriptionStatus = 'active';
        }
      } else {
        updates.plan = plan;
      }
    }

    const [updated] = await db.update(organizations).set(updates)
      .where(eq(organizations.id, orgId)).returning();

    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'platform.org_update',
      entity: 'organization',
      entityId: orgId,
      details: { fields: Object.keys(updates) },
      ipAddress: clientIp(req),
    });

    res.json(await enrichOrganization(updated));
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

platformRouter.post('/organizations/:id/extend-trial', async (req, res) => {
  try {
    const orgId = parseInt(req.params.id);
    const days = parseInt(req.body.days, 10) || 14;
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    if (!org) return res.status(404).json({ error: 'ISP no encontrado' });

    const base = org.trialEndsAt && new Date(org.trialEndsAt) > new Date()
      ? new Date(org.trialEndsAt)
      : new Date();
    base.setDate(base.getDate() + days);

    const updated = await applySaasPlanToOrg(orgId, 'trial', {
      plan: 'trial',
      trialEndsAt: base,
      isActive: true,
      subscriptionStatus: 'trial',
      suspendedAt: null,
      suspendedReason: null,
    });

    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'platform.extend_trial',
      entity: 'organization',
      entityId: orgId,
      details: { days },
      ipAddress: clientIp(req),
    });

    res.json(await enrichOrganization(updated));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Error' });
  }
});

platformRouter.post('/organizations/:id/suspend', async (req, res) => {
  try {
    const orgId = parseInt(req.params.id, 10);
    const reason = (req.body.reason || 'Suspendido por FibraNexus').slice(0, 500);
    const [updated] = await db.update(organizations).set({
      isActive: false,
      subscriptionStatus: 'suspended',
      suspendedAt: new Date(),
      suspendedReason: reason,
      updatedAt: new Date(),
    }).where(eq(organizations.id, orgId)).returning();
    if (!updated) return res.status(404).json({ error: 'ISP no encontrado' });

    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'platform.org_suspend',
      entity: 'organization',
      entityId: orgId,
      details: { reason },
      ipAddress: clientIp(req),
    });
    res.json(await enrichOrganization(updated));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

platformRouter.post('/organizations/:id/reactivate', async (req, res) => {
  try {
    const orgId = parseInt(req.params.id, 10);
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    if (!org) return res.status(404).json({ error: 'ISP no encontrado' });

    let status = 'active';
    if (org.plan === 'trial') {
      status = 'trial';
      if (org.trialEndsAt && new Date(org.trialEndsAt) < new Date()) {
        return res.status(400).json({ error: 'Trial vencido: extiende el trial o asigna un plan pago antes de reactivar' });
      }
    }

    const [updated] = await db.update(organizations).set({
      isActive: true,
      subscriptionStatus: status,
      suspendedAt: null,
      suspendedReason: null,
      updatedAt: new Date(),
    }).where(eq(organizations.id, orgId)).returning();

    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'platform.org_reactivate',
      entity: 'organization',
      entityId: orgId,
      ipAddress: clientIp(req),
    });
    res.json(await enrichOrganization(updated));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

platformRouter.post('/organizations/:id/saas-invoices', async (req, res) => {
  try {
    const orgId = parseInt(req.params.id, 10);
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    if (!org) return res.status(404).json({ error: 'ISP no encontrado' });

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Monto inválido' });
    }
    const dueDate = req.body.dueDate || new Date().toISOString().slice(0, 10);
    const invoiceNumber = `SAAS-${orgId}-${Date.now()}`;

    const [inv] = await db.insert(saasInvoices).values({
      organizationId: orgId,
      saasPlanId: org.saasPlanId || null,
      invoiceNumber,
      amount: String(amount.toFixed(2)),
      currency: req.body.currency || 'CLP',
      status: 'pending',
      periodStart: req.body.periodStart || null,
      periodEnd: req.body.periodEnd || null,
      dueDate,
      notes: req.body.notes || null,
    }).returning();

    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'platform.saas_invoice_create',
      entity: 'saas_invoice',
      entityId: inv.id,
      details: { amount, invoiceNumber },
      ipAddress: clientIp(req),
    });
    res.status(201).json(inv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

platformRouter.post('/saas-invoices/:id/mark-paid', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [inv] = await db.select().from(saasInvoices).where(eq(saasInvoices.id, id)).limit(1);
    if (!inv) return res.status(404).json({ error: 'Factura SaaS no encontrada' });

    const [updated] = await db.update(saasInvoices).set({
      status: 'paid',
      paidAt: new Date(),
      updatedAt: new Date(),
      notes: req.body.notes || inv.notes,
    }).where(eq(saasInvoices.id, id)).returning();

    await db.update(organizations).set({
      subscriptionStatus: 'active',
      isActive: true,
      suspendedAt: null,
      suspendedReason: null,
      updatedAt: new Date(),
    }).where(eq(organizations.id, inv.organizationId));

    await writeAuditLog({
      organizationId: inv.organizationId,
      userId: req.user.id,
      action: 'platform.saas_invoice_paid',
      entity: 'saas_invoice',
      entityId: id,
      ipAddress: clientIp(req),
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
