import { db } from '../db/index.js';
import {
  clients, clientServices, invoices, tickets, users, plans,
} from '../db/schema.js';
import { and, eq, inArray } from 'drizzle-orm';
import { orgFilter } from './tenant.js';

function daysSince(date) {
  if (!date) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24)));
}

export async function buildClientOverview(orgId) {
  const rows = await db.select({
    id: clients.id,
    userId: clients.userId,
    fullName: users.fullName,
    email: users.email,
    phone: users.phone,
    city: clients.city,
    clientType: clients.clientType,
    createdAt: clients.createdAt,
    isActive: users.isActive,
    lastLogin: users.lastLogin,
  })
    .from(clients)
    .leftJoin(users, eq(clients.userId, users.id))
    .where(orgFilter(clients, orgId))
    .orderBy(clients.createdAt);

  if (!rows.length) return [];

  const clientIds = rows.map((r) => r.id);

  const serviceRows = await db.select({
    clientId: clientServices.clientId,
    status: clientServices.status,
    planName: plans.name,
    ipAddress: clientServices.ipAddress,
  })
    .from(clientServices)
    .leftJoin(plans, eq(clientServices.planId, plans.id))
    .where(inArray(clientServices.clientId, clientIds));

  const invoiceRows = await db.select({
    clientId: invoices.clientId,
    total: invoices.total,
    status: invoices.status,
  })
    .from(invoices)
    .where(and(orgFilter(invoices, orgId), inArray(invoices.clientId, clientIds)));

  const ticketRows = await db.select({
    clientId: tickets.clientId,
    status: tickets.status,
    priority: tickets.priority,
  })
    .from(tickets)
    .where(and(orgFilter(tickets, orgId), inArray(tickets.clientId, clientIds)));

  const servicesByClient = new Map();
  for (const s of serviceRows) {
    if (!servicesByClient.has(s.clientId)) servicesByClient.set(s.clientId, []);
    servicesByClient.get(s.clientId).push(s);
  }

  const invoicesByClient = new Map();
  for (const inv of invoiceRows) {
    if (!invoicesByClient.has(inv.clientId)) invoicesByClient.set(inv.clientId, []);
    invoicesByClient.get(inv.clientId).push(inv);
  }

  const ticketsByClient = new Map();
  for (const t of ticketRows) {
    if (!ticketsByClient.has(t.clientId)) ticketsByClient.set(t.clientId, []);
    ticketsByClient.get(t.clientId).push(t);
  }

  return rows.map((c) => {
    const svcs = servicesByClient.get(c.id) || [];
    const invs = invoicesByClient.get(c.id) || [];
    const tks = ticketsByClient.get(c.id) || [];
    const activeSvc = svcs.find((s) => s.status === 'active');
    const suspendedSvc = svcs.find((s) => s.status === 'suspended' || s.status === 'cut');
    const openTickets = tks.filter((t) => ['open', 'in_progress', 'waiting_client'].includes(t.status));
    const pendingAmount = invs
      .filter((i) => i.status === 'pending' || i.status === 'overdue')
      .reduce((sum, i) => sum + Number(i.total || 0), 0);

    const alerts = [];
    if (pendingAmount > 0) alerts.push({ type: 'debt', label: 'Deuda pendiente', severity: 'high' });
    if (suspendedSvc) alerts.push({ type: 'suspended', label: 'Servicio suspendido', severity: 'high' });
    if (!activeSvc && svcs.length > 0) alerts.push({ type: 'inactive', label: 'Sin servicio activo', severity: 'medium' });
    if (!svcs.length) alerts.push({ type: 'no_service', label: 'Sin servicio', severity: 'medium' });
    if (openTickets.some((t) => t.priority === 'critical' || t.priority === 'high')) {
      alerts.push({ type: 'ticket', label: 'Ticket urgente', severity: 'high' });
    } else if (openTickets.length > 0) {
      alerts.push({ type: 'ticket', label: `${openTickets.length} ticket(s)`, severity: 'medium' });
    }

    let serviceStatus = 'none';
    if (activeSvc) serviceStatus = 'active';
    else if (suspendedSvc) serviceStatus = suspendedSvc.status;

    return {
      id: c.id,
      fullName: c.fullName,
      email: c.email,
      phone: c.phone,
      city: c.city,
      clientType: c.clientType,
      createdAt: c.createdAt,
      daysAsClient: daysSince(c.createdAt),
      isActive: c.isActive,
      lastLogin: c.lastLogin,
      serviceStatus,
      planName: activeSvc?.planName || suspendedSvc?.planName || null,
      ipAddress: activeSvc?.ipAddress || null,
      openTickets: openTickets.length,
      pendingAmount,
      alerts,
      hasProblem: alerts.some((a) => a.severity === 'high') || openTickets.length > 0,
    };
  });
}
