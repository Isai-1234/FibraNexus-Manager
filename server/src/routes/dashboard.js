import { Router } from 'express';
import { db } from '../db/index.js';
import { clients, clientServices, equipment, invoices, tickets, users, plans } from '../db/schema.js';
import { and, eq, sql, ne } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId } from '../lib/tenant.js';

export const dashboardRouter = Router();

dashboardRouter.get('/admin', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;

    const totalClients = (await db.select({ count: sql`count(*)` }).from(clients).where(orgFilter(clients, orgId)))[0].count;
    const activeServices = (await db.select({ count: sql`count(*)` }).from(clientServices)
      .leftJoin(clients, eq(clientServices.clientId, clients.id))
      .where(and(eq(clientServices.status, 'active'), orgFilter(clients, orgId))))[0].count;
    const totalEquipment = (await db.select({ count: sql`count(*)` }).from(equipment)
      .where(and(orgFilter(equipment, orgId), ne(equipment.type, 'router'))))[0].count;
    const totalRouters = (await db.select({ count: sql`count(*)` }).from(equipment)
      .where(and(orgFilter(equipment, orgId), eq(equipment.type, 'router'))))[0].count;
    const pendingInvoices = (await db.select({ count: sql`count(*)`, total: sql`sum(total::decimal)` }).from(invoices)
      .where(and(eq(invoices.status, 'pending'), orgFilter(invoices, orgId))))[0];
    const openTickets = (await db.select({ count: sql`count(*)` }).from(tickets).where(and(eq(tickets.status, 'open'), orgFilter(tickets, orgId))))[0].count;
    const totalPlans = (await db.select({ count: sql`count(*)` }).from(plans).where(orgFilter(plans, orgId)))[0].count;

    const recentClients = await db.select({
      id: clients.id, fullName: users.fullName, email: users.email, city: clients.city, createdAt: clients.createdAt,
    }).from(clients).leftJoin(users, eq(clients.userId, users.id))
      .where(orgFilter(clients, orgId)).orderBy(clients.createdAt).limit(5);

    const recentTickets = await db.select({
      id: tickets.id, subject: tickets.subject, status: tickets.status, priority: tickets.priority, createdAt: tickets.createdAt,
    }).from(tickets).where(orgFilter(tickets, orgId)).orderBy(tickets.createdAt).limit(5);

    res.json({
      stats: {
        totalClients: Number(totalClients), activeServices: Number(activeServices),
        totalEquipment: Number(totalEquipment), totalRouters: Number(totalRouters),
        openTickets: Number(openTickets), totalPlans: Number(totalPlans),
        pendingAmount: Number(pendingInvoices.total || 0), pendingCount: Number(pendingInvoices.count || 0),
      },
      recentClients, recentTickets,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});
