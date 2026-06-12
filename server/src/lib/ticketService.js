import { db } from '../db/index.js';
import { tickets, ticketMessages, users, clients } from '../db/schema.js';
import { and, eq, asc } from 'drizzle-orm';
import { orgFilter } from './tenant.js';

const CLOSED_STATUSES = ['resolved', 'closed'];

export async function getTicketInOrg(ticketId, orgId) {
  const [row] = await db.select({
    id: tickets.id,
    organizationId: tickets.organizationId,
    ticketNumber: tickets.ticketNumber,
    clientId: tickets.clientId,
    assignedTo: tickets.assignedTo,
    subject: tickets.subject,
    description: tickets.description,
    status: tickets.status,
    priority: tickets.priority,
    category: tickets.category,
    createdAt: tickets.createdAt,
    updatedAt: tickets.updatedAt,
    resolvedAt: tickets.resolvedAt,
    client: { fullName: users.fullName, email: users.email },
  })
    .from(tickets)
    .leftJoin(clients, eq(tickets.clientId, clients.id))
    .leftJoin(users, eq(clients.userId, users.id))
    .where(and(eq(tickets.id, ticketId), orgFilter(tickets, orgId)))
    .limit(1);
  return row || null;
}

export async function getTicketForClient(ticketId, clientId) {
  const [row] = await db.select().from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.clientId, clientId)))
    .limit(1);
  return row || null;
}

export async function listTicketMessages(ticketId, { includeInternal = true } = {}) {
  const rows = await db.select({
    id: ticketMessages.id,
    ticketId: ticketMessages.ticketId,
    userId: ticketMessages.userId,
    message: ticketMessages.message,
    isInternal: ticketMessages.isInternal,
    createdAt: ticketMessages.createdAt,
    authorName: users.fullName,
    authorRole: users.role,
  })
    .from(ticketMessages)
    .leftJoin(users, eq(ticketMessages.userId, users.id))
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(asc(ticketMessages.createdAt));

  return includeInternal ? rows : rows.filter((m) => !m.isInternal);
}

export async function fetchTicketDetail(ticketId, orgId, { includeInternal = true } = {}) {
  const ticket = await getTicketInOrg(ticketId, orgId);
  if (!ticket) return null;
  const messages = await listTicketMessages(ticketId, { includeInternal });
  return { ...ticket, messages };
}

export async function fetchClientTicketDetail(ticketId, clientId) {
  const ticket = await getTicketForClient(ticketId, clientId);
  if (!ticket) return null;
  const messages = await listTicketMessages(ticketId, { includeInternal: false });
  return { ...ticket, messages };
}

export async function addTicketMessage({ ticketId, userId, message, isInternal = false }) {
  const [msg] = await db.insert(ticketMessages).values({
    ticketId,
    userId,
    message: message.trim(),
    isInternal: Boolean(isInternal),
  }).returning();

  await db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, ticketId));
  return msg;
}

export async function updateTicketRecord(ticketId, orgId, patch) {
  const ticket = await getTicketInOrg(ticketId, orgId);
  if (!ticket) return null;

  const update = { updatedAt: new Date() };
  if (patch.status) {
    update.status = patch.status;
    if (CLOSED_STATUSES.includes(patch.status)) {
      update.resolvedAt = new Date();
    } else if (ticket.resolvedAt) {
      update.resolvedAt = null;
    }
  }
  if (patch.priority) update.priority = patch.priority;
  if (patch.assignedTo !== undefined) update.assignedTo = patch.assignedTo || null;
  if (patch.category !== undefined) update.category = patch.category;

  const [updated] = await db.update(tickets).set(update)
    .where(and(eq(tickets.id, ticketId), orgFilter(tickets, orgId)))
    .returning();
  return updated;
}
