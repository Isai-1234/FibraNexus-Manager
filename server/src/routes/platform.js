import { Router } from 'express';
import { db } from '../db/index.js';
import {
  organizations, users, clients, equipment, plans, tickets, invoices,
} from '../db/schema.js';
import { eq, sql, and, inArray, desc } from 'drizzle-orm';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { trialDaysLeft } from '../lib/tenant.js';

export const platformRouter = Router();

platformRouter.use(authenticateToken, requireRole('superadmin'));

async function enrichOrganization(org) {
  const [{ count: clientCount }] = await db.select({ count: sql`count(*)` })
    .from(clients).where(eq(clients.organizationId, org.id));
  const [{ count: staffCount }] = await db.select({ count: sql`count(*)` })
    .from(users).where(and(eq(users.organizationId, org.id), inArray(users.role, ['admin', 'technician'])));
  const [{ count: routerCount }] = await db.select({ count: sql`count(*)` })
    .from(equipment).where(and(eq(equipment.organizationId, org.id), eq(equipment.type, 'router')));
  const [{ count: planCount }] = await db.select({ count: sql`count(*)` })
    .from(plans).where(eq(plans.organizationId, org.id));
  const [{ count: openTickets }] = await db.select({ count: sql`count(*)` })
    .from(tickets).where(and(eq(tickets.organizationId, org.id), eq(tickets.status, 'open')));
  const [{ total: pendingAmount }] = await db.select({ total: sql`coalesce(sum(total::decimal), 0)` })
    .from(invoices).where(and(eq(invoices.organizationId, org.id), eq(invoices.status, 'pending')));

  const days = trialDaysLeft(org);
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    email: org.email,
    plan: org.plan,
    isActive: org.isActive,
    trialDaysLeft: days,
    trialEndsAt: org.trialEndsAt,
    maxRouters: org.maxRouters,
    maxClients: org.maxClients,
    clientCount: Number(clientCount),
    staffCount: Number(staffCount),
    routerCount: Number(routerCount),
    planCount: Number(planCount),
    openTickets: Number(openTickets),
    pendingAmount: Number(pendingAmount || 0),
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
    trialExpiringSoon: org.plan === 'trial' && days != null && days <= 7,
  };
}

platformRouter.get('/dashboard', async (req, res) => {
  try {
    const orgs = await db.select().from(organizations).orderBy(desc(organizations.createdAt));
    const enriched = await Promise.all(orgs.map(enrichOrganization));

    res.json({
      stats: {
        totalOrganizations: enriched.length,
        activeOrganizations: enriched.filter((o) => o.isActive).length,
        activeTrials: enriched.filter((o) => o.plan === 'trial' && o.isActive).length,
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
      .where(and(eq(users.organizationId, orgId), inArray(users.role, ['admin', 'technician'])))
      .orderBy(users.createdAt);

    res.json({
      ...(await enrichOrganization(org)),
      staff,
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

    const { name, email, plan, trialEndsAt, isActive, maxRouters, maxClients } = req.body;
    const updates = { updatedAt: new Date() };
    if (name != null) updates.name = name;
    if (email != null) updates.email = email;
    if (plan != null) updates.plan = plan;
    if (trialEndsAt != null) updates.trialEndsAt = new Date(trialEndsAt);
    if (isActive != null) updates.isActive = Boolean(isActive);
    if (maxRouters != null) updates.maxRouters = parseInt(maxRouters);
    if (maxClients != null) updates.maxClients = parseInt(maxClients);

    const [updated] = await db.update(organizations).set(updates)
      .where(eq(organizations.id, orgId)).returning();

    res.json(await enrichOrganization(updated));
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

platformRouter.post('/organizations/:id/extend-trial', async (req, res) => {
  try {
    const orgId = parseInt(req.params.id);
    const days = parseInt(req.body.days) || 14;
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    if (!org) return res.status(404).json({ error: 'ISP no encontrado' });

    const base = org.trialEndsAt && new Date(org.trialEndsAt) > new Date()
      ? new Date(org.trialEndsAt)
      : new Date();
    base.setDate(base.getDate() + days);

    const [updated] = await db.update(organizations).set({
      plan: 'trial',
      trialEndsAt: base,
      isActive: true,
      updatedAt: new Date(),
    }).where(eq(organizations.id, orgId)).returning();

    res.json(await enrichOrganization(updated));
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});
