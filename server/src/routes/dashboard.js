import { Router } from 'express';
import { db } from '../db/index.js';
import { clients, clientServices, equipment, invoices, tickets, users, plans, payments } from '../db/schema.js';
import { and, eq, sql, ne, inArray, gte, lt, desc } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId } from '../lib/tenant.js';
import { buildClientOverview } from '../lib/clientOverview.js';
import { daysOverdue } from '../lib/orgSettings.js';
import { getOrgSettings } from '../lib/billingScheduler.js';
import { OPEN_INVOICE_STATUSES, attachInvoiceBalances } from '../lib/paymentService.js';

export const dashboardRouter = Router();

function startOfMonthUTC(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
}

function addMonthsUTC(date, delta) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1));
}

dashboardRouter.get('/admin', requireRole('admin', 'office', 'technician'), async (req, res) => {
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
    const openTickets = (await db.select({ count: sql`count(*)` }).from(tickets).where(and(eq(tickets.status, 'open'), orgFilter(tickets, orgId))))[0].count;
    const totalPlans = (await db.select({ count: sql`count(*)` }).from(plans).where(orgFilter(plans, orgId)))[0].count;

    const clientOverview = await buildClientOverview(orgId);
    const clientsWithProblems = clientOverview.filter((c) => c.hasProblem);
    const delinquentClients = clientOverview.filter((c) => c.isDelinquent);
    const offlineClients = clientOverview.filter((c) => c.connectionStatus === 'offline');
    const onlineClients = clientOverview.filter((c) => c.connectionStatus === 'online');
    const pendingInstallClients = clientOverview.filter((c) => c.lifecycleStatus === 'pending_install');
    const prospectClients = clientOverview.filter((c) => (c.lifecycleStatus || 'prospect') === 'prospect');
    // Misma noción que el filtro CRM de Abonados: lifecycle o servicio suspendido/cortado
    const suspendedClients = clientOverview.filter((c) =>
      c.lifecycleStatus === 'suspended' || c.serviceStatus === 'suspended');
    const cutClients = clientOverview.filter((c) =>
      c.lifecycleStatus === 'cut' || c.serviceStatus === 'cut');

    // Por cobrar = suma de saldos abiertos del overview (misma cifra que perfil/listado)
    const pendingAmount = Math.round(clientOverview.reduce((s, c) => s + Number(c.pendingAmount || 0), 0) * 100) / 100;
    const pendingCount = clientOverview.filter((c) => Number(c.pendingAmount || 0) > 0).length;

    const openInvoiceRows = await db.select({
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
      .where(and(inArray(invoices.status, OPEN_INVOICE_STATUSES), orgFilter(invoices, orgId)))
      .orderBy(invoices.dueDate);

    const openWithBalance = await attachInvoiceBalances(openInvoiceRows);
    const overdueWithBalance = openWithBalance
      .filter((inv) => inv.status === 'overdue' || (inv.status === 'partial' && daysOverdue(inv.dueDate) > 0))
      .filter((inv) => Number(inv.balance || 0) > 0);
    const overdueAmount = Math.round(overdueWithBalance.reduce((s, inv) => s + Number(inv.balance || 0), 0) * 100) / 100;
    const overdueInvoices = overdueWithBalance.slice(0, 15).map((inv) => ({
      ...inv,
      overdueDays: daysOverdue(inv.dueDate),
    }));

    const now = new Date();
    const monthStart = startOfMonthUTC(now.getUTCFullYear(), now.getUTCMonth());
    const monthEnd = addMonthsUTC(monthStart, 1);

    const monthPayAgg = (await db.select({
      count: sql`count(*)::int`,
      total: sql`coalesce(sum(${payments.amount}::decimal), 0)`,
    }).from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(and(
        orgFilter(invoices, orgId),
        gte(payments.paymentDate, monthStart),
        lt(payments.paymentDate, monthEnd),
      )))[0];

    const recentPayments = await db.select({
      id: payments.id,
      amount: payments.amount,
      method: payments.method,
      paymentDate: payments.paymentDate,
      reference: payments.reference,
      invoiceId: payments.invoiceId,
      invoiceNumber: invoices.invoiceNumber,
      clientId: payments.clientId,
      clientName: users.fullName,
    })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .leftJoin(clients, eq(payments.clientId, clients.id))
      .leftJoin(users, eq(clients.userId, users.id))
      .where(and(
        orgFilter(invoices, orgId),
        gte(payments.paymentDate, monthStart),
        lt(payments.paymentDate, monthEnd),
      ))
      .orderBy(desc(payments.paymentDate))
      .limit(20);

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
        pendingAmount,
        pendingCount,
        overdueAmount,
        overdueCount: overdueWithBalance.length,
        monthCollected: Math.round(Number(monthPayAgg?.total || 0) * 100) / 100,
        monthPaymentCount: Number(monthPayAgg?.count || 0),
        delinquentClients: delinquentClients.length,
        offlineClients: offlineClients.length,
        onlineClients: onlineClients.length,
        clientsWithProblems: clientsWithProblems.length,
        pendingInstallClients: pendingInstallClients.length,
        prospectClients: prospectClients.length,
        suspendedClients: suspendedClients.length,
        cutClients: cutClients.length,
      },
      orgSettings,
      clientOverview,
      clientsWithProblems,
      delinquentClients,
      overdueInvoices,
      recentTickets,
      recentPayments: recentPayments.map((p) => ({
        ...p,
        amount: Number(p.amount || 0),
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});
