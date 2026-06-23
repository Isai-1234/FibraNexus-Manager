import { db } from '../db/index.js';
import {
  clients, clientServices, invoices, tickets, users, plans, equipment, sites,
} from '../db/schema.js';
import { and, eq, inArray } from 'drizzle-orm';
import { orgFilter } from './tenant.js';
import { daysOverdue } from './orgSettings.js';
import { getOnlinePppoeUsernames } from './billingScheduler.js';

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

  let onlinePppoe = new Set();
  try {
    onlinePppoe = await getOnlinePppoeUsernames(orgId);
  } catch { /* routers offline */ }

  const serviceRows = await db.select({
    clientId: clientServices.clientId,
    serviceId: clientServices.id,
    status: clientServices.status,
    planName: plans.name,
    ipAddress: clientServices.ipAddress,
    pppoeUsername: clientServices.pppoeUsername,
  })
    .from(clientServices)
    .leftJoin(plans, eq(clientServices.planId, plans.id))
    .where(inArray(clientServices.clientId, clientIds));

  const invoiceRows = await db.select({
    clientId: invoices.clientId,
    total: invoices.total,
    status: invoices.status,
    dueDate: invoices.dueDate,
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

  const equipRows = await db.select({
    clientId: equipment.clientId,
    equipmentId: equipment.id,
    equipmentName: equipment.name,
    status: equipment.status,
    type: equipment.type,
    ipAddress: equipment.ipAddress,
    siteId: equipment.siteId,
    siteName: sites.name,
  })
    .from(equipment)
    .leftJoin(sites, eq(equipment.siteId, sites.id))
    .where(and(orgFilter(equipment, orgId), inArray(equipment.clientId, clientIds)));

  const equipByClient = new Map();
  for (const e of equipRows) {
    if (!e.clientId) continue;
    if (!equipByClient.has(e.clientId)) equipByClient.set(e.clientId, []);
    equipByClient.get(e.clientId).push(e);
  }

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
    const clientEquip = equipByClient.get(c.id) || [];
    const cpe = clientEquip.find((e) => e.type === 'cpe') || clientEquip[0];
    const activeSvc = svcs.find((s) => s.status === 'active');
    const suspendedSvc = svcs.find((s) => s.status === 'suspended' || s.status === 'cut');
    const openTickets = tks.filter((t) => ['open', 'in_progress', 'waiting_client'].includes(t.status));
    const pendingInvs = invs.filter((i) => i.status === 'pending' || i.status === 'overdue');
    const pendingAmount = pendingInvs.reduce((sum, i) => sum + Number(i.total || 0), 0);
    const overdueInvs = invs.filter((i) => i.status === 'overdue');
    const maxOverdueDays = overdueInvs.reduce((max, i) => Math.max(max, daysOverdue(i.dueDate)), 0);

    let connectionStatus = 'none';
    let connectionDetail = '';
    if (suspendedSvc || activeSvc?.status === 'suspended') {
      connectionStatus = 'suspended';
      connectionDetail = 'Servicio suspendido';
    } else if (activeSvc) {
      if (activeSvc.pppoeUsername && onlinePppoe.has(activeSvc.pppoeUsername)) {
        connectionStatus = 'online';
        connectionDetail = 'PPPoE conectado';
      } else if (activeSvc.pppoeUsername) {
        connectionStatus = 'offline';
        connectionDetail = 'PPPoE desconectado';
      } else if (cpe?.status === 'online') {
        connectionStatus = 'online';
        connectionDetail = 'Antena online (SNMP)';
      } else if (cpe?.status === 'offline') {
        connectionStatus = 'offline';
        connectionDetail = 'Antena offline';
      } else if (activeSvc.ipAddress) {
        connectionStatus = 'static';
        connectionDetail = `Cola IP ${activeSvc.ipAddress}`;
      } else {
        connectionStatus = 'unknown';
        connectionDetail = 'Sin datos de red';
      }
    }

    const alerts = [];
    if (maxOverdueDays > 0) {
      alerts.push({ type: 'overdue', label: `Mora ${maxOverdueDays} días`, severity: 'high' });
    } else if (pendingAmount > 0) {
      alerts.push({ type: 'debt', label: 'Deuda pendiente', severity: 'high' });
    }
    if (connectionStatus === 'offline') {
      alerts.push({ type: 'offline', label: 'Desconectado', severity: 'medium' });
    }
    if (suspendedSvc) alerts.push({ type: 'suspended', label: 'Servicio suspendido', severity: 'high' });
    if (!activeSvc && svcs.length > 0) alerts.push({ type: 'inactive', label: 'Sin servicio activo', severity: 'medium' });
    if (!svcs.length) alerts.push({ type: 'no_service', label: 'Sin servicio', severity: 'medium' });
    if (openTickets.some((t) => t.priority === 'critical' || t.priority === 'high')) {
      alerts.push({ type: 'ticket', label: 'Ticket urgente', severity: 'high' });
    } else if (openTickets.length > 0) {
      alerts.push({ type: 'ticket', label: `${openTickets.length} ticket(s)`, severity: 'medium' });
    }

    const statusSummary = alerts.length
      ? alerts.map((a) => a.label).slice(0, 3).join(' · ')
      : 'Al dia';

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
      connectionStatus,
      connectionDetail,
      planName: activeSvc?.planName || suspendedSvc?.planName || null,
      ipAddress: (cpe?.ipAddress?.split('/')[0] || activeSvc?.ipAddress || null),
      equipmentId: cpe?.equipmentId || null,
      equipmentName: cpe?.equipmentName || null,
      siteId: cpe?.siteId || null,
      siteName: cpe?.siteName || null,
      pppoeUsername: activeSvc?.pppoeUsername || null,
      antennaOnline: cpe?.status === 'online',
      openTickets: openTickets.length,
      pendingAmount,
      overdueDays: maxOverdueDays,
      isDelinquent: maxOverdueDays > 0,
      alerts,
      statusSummary,
      hasProblem: alerts.some((a) => a.severity === 'high'),
    };
  });
}
