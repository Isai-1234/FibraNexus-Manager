import { Router } from 'express';
import { db } from '../db/index.js';
import { clients, clientServices, equipment, invoices, tickets, users, plans } from '../db/schema.js';
import { and, eq, sql, ne, inArray } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId } from '../lib/tenant.js';
import { buildClientOverview } from '../lib/clientOverview.js';
import { daysOverdue } from '../lib/orgSettings.js';
import { getOrgSettings } from '../lib/billingScheduler.js';

export const dashboardRouter = Router();

dashboardRouter.get('/admin', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;

    const totalClients = (await db.select({ count: sql`count(*)` }).from(clients).where(orgFilter(clients, orgId)))[0].count;
    const activeServices = (await db.select({ count: sql`count(*)` }).from(clientServices)
      .leftJoin(clients, eq(clientServices.clientId, clients.id))
      .where(and(eq(clientServices.status, 'active'), orgFilter(clients, orgId))))[0].count;
    const suspendedServices = (await db.select({ count: sql`count(*)` }).from(clientServices)
      .leftJoin(clients, eq(clientServices.clientId, clients.id))
      .where(and(eq(clientServices.status, 'suspended'), orgFilter(clients, orgId))))[0].count;
    const totalEquipment = (await db.select({ count: sql`count(*)` }).from(equipment)
      .where(and(orgFilter(equipment, orgId), ne(equipment.type, 'router'))))[0].count;
    const totalRouters = (await db.select({ count: sql`count(*)` }).from(equipment)
      .where(and(orgFilter(equipment, orgId), eq(equipment.type, 'router'))))[0].count;
    const pendingInvoices = (await db.select({ count: sql`count(*)`, total: sql`sum(total::decimal)` }).from(invoices)
      .where(and(inArray(invoices.status, ['pending', 'overdue']), orgFilter(invoices, orgId))))[0];
    const overdueOnly = (await db.select({ count: sql`count(*)`, total: sql`sum(total::decimal)` }).from(invoices)
      .where(and(eq(invoices.status, 'overdue'), orgFilter(invoices, orgId))))[0];
    const openTickets = (await db.select({ count: sql`count(*)` }).from(tickets).where(and(eq(tickets.status, 'open'), orgFilter(tickets, orgId))))[0].count;
    const totalPlans = (await db.select({ count: sql`count(*)` }).from(plans).where(orgFilter(plans, orgId)))[0].count;

    const clientOverview = await buildClientOverview(orgId);
    const clientsWithProblems = clientOverview.filter((c) => c.hasProblem);
    const delinquentClients = clientOverview.filter((c) => c.isDelinquent);
    const offlineClients = clientOverview.filter((c) => c.connectionStatus === 'offline');
    const onlineClients = clientOverview.filter((c) => c.connectionStatus === 'online');

    const overdueInvoicesRaw = await db.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      total: invoices.total,
      dueDate: invoices.dueDate,
      status: invoices.status,
      clientName: users.fullName,
      clientId: invoices.clientId,
    })
      .from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .leftJoin(users, eq(clients.userId, users.id))
      .where(and(eq(invoices.status, 'overdue'), orgFilter(invoices, orgId)))
      .orderBy(invoices.dueDate)
      .limit(15);

    const overdueInvoices = overdueInvoicesRaw.map((inv) => ({
      ...inv,
      overdueDays: daysOverdue(inv.dueDate),
    }));

    const recentTickets = await db.select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      createdAt: tickets.createdAt,
      clientName: users.fullName,
    })
      .from(tickets)
      .leftJoin(clients, eq(tickets.clientId, clients.id))
      .leftJoin(users, eq(clients.userId, users.id))
      .where(orgFilter(tickets, orgId))
      .orderBy(tickets.createdAt)
      .limit(8);

    const orgSettings = await getOrgSettings(orgId);

    res.json({
      stats: {
        totalClients: Number(totalClients),
        activeServices: Number(activeServices),
        suspendedServices: Number(suspendedServices),
        totalEquipment: Number(totalEquipment),
        totalRouters: Number(totalRouters),
        openTickets: Number(openTickets),
        totalPlans: Number(totalPlans),
        pendingAmount: Number(pendingInvoices.total || 0),
        pendingCount: Number(pendingInvoices.count || 0),
        overdueAmount: Number(overdueOnly.total || 0),
        overdueCount: Number(overdueOnly.count || 0),
        delinquentClients: delinquentClients.length,
        offlineClients: offlineClients.length,
        onlineClients: onlineClients.length,
        clientsWithProblems: clientsWithProblems.length,
      },
      orgSettings,
      clientOverview,
      clientsWithProblems,
      delinquentClients,
      overdueInvoices,
      recentTickets,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});
