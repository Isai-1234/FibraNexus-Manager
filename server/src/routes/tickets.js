import { Router } from 'express';
import { db } from '../db/index.js';
import { tickets, users, clients } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId, getClientInOrg } from '../lib/tenant.js';
import {
  fetchTicketDetail,
  addTicketMessage,
  updateTicketRecord,
  getTicketInOrg,
} from '../lib/ticketService.js';

export const ticketsRouter = Router();

ticketsRouter.get('/', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const allTickets = await db.select({
      id: tickets.id,
      clientId: tickets.clientId,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      description: tickets.description,
      category: tickets.category,
      status: tickets.status,
      priority: tickets.priority,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
      client: { fullName: users.fullName, email: users.email },
    })
      .from(tickets)
      .leftJoin(clients, eq(tickets.clientId, clients.id))
      .leftJoin(users, eq(clients.userId, users.id))
      .where(orgFilter(tickets, orgId))
      .limit(50);
    res.json(allTickets);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar tickets' });
  }
});

ticketsRouter.get('/:id', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const ticketId = parseInt(req.params.id, 10);
    const detail = await fetchTicketDetail(ticketId, orgId, { includeInternal: true });
    if (!detail) return res.status(404).json({ error: 'Ticket no encontrado' });
    res.json(detail);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener ticket' });
  }
});

ticketsRouter.post('/', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const { clientId, subject, description, priority, category } = req.body;
    if (!await getClientInOrg(parseInt(clientId, 10), orgId)) {
      return res.status(404).json({ error: 'Cliente no encontrado en tu organización' });
    }
    const ticketNumber = 'TKT-' + Date.now();
    const [ticket] = await db.insert(tickets).values({
      organizationId: orgId,
      ticketNumber,
      clientId: parseInt(clientId, 10),
      subject,
      description,
      priority: priority || 'medium',
      category: category || 'technical',
    }).returning();

    if (description?.trim()) {
      await addTicketMessage({
        ticketId: ticket.id,
        userId: req.user.id,
        message: description.trim(),
        isInternal: false,
      });
    }

    const detail = await fetchTicketDetail(ticket.id, orgId);
    res.status(201).json(detail);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear ticket' });
  }
});

ticketsRouter.patch('/:id', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const ticketId = parseInt(req.params.id, 10);
    const { status, priority, assignedTo, category } = req.body;
    const updated = await updateTicketRecord(ticketId, orgId, {
      status, priority, assignedTo, category,
    });
    if (!updated) return res.status(404).json({ error: 'Ticket no encontrado' });
    const detail = await fetchTicketDetail(ticketId, orgId);
    res.json(detail);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar ticket' });
  }
});

ticketsRouter.put('/:id', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const ticketId = parseInt(req.params.id, 10);
    const { status, priority, assignedTo, category } = req.body;
    const updated = await updateTicketRecord(ticketId, orgId, {
      status, priority, assignedTo, category,
    });
    if (!updated) return res.status(404).json({ error: 'Ticket no encontrado' });
    const detail = await fetchTicketDetail(ticketId, orgId);
    res.json(detail);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar ticket' });
  }
});

ticketsRouter.post('/:id/messages', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const ticketId = parseInt(req.params.id, 10);
    const { message, isInternal, status } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Mensaje requerido' });

    const ticket = await getTicketInOrg(ticketId, orgId);
    if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });

    await addTicketMessage({
      ticketId,
      userId: req.user.id,
      message: message.trim(),
      isInternal: Boolean(isInternal),
    });

    if (status) {
      await updateTicketRecord(ticketId, orgId, { status });
    } else if (ticket.status === 'open') {
      await updateTicketRecord(ticketId, orgId, { status: 'in_progress' });
    }

    const detail = await fetchTicketDetail(ticketId, orgId);
    res.status(201).json(detail);
  } catch (error) {
    res.status(500).json({ error: 'Error al enviar respuesta' });
  }
});

ticketsRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    await db.delete(tickets).where(and(eq(tickets.id, parseInt(req.params.id, 10)), orgFilter(tickets, orgId)));
    res.json({ message: 'Ticket eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar ticket' });
  }
});
