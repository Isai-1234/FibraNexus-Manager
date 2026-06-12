import { Router } from 'express';
import { db } from '../db/index.js';
import { tickets, users, clients } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId, getClientInOrg } from '../lib/tenant.js';

export const ticketsRouter = Router();

ticketsRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
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

ticketsRouter.post('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const { clientId, subject, description, priority } = req.body;
    if (!await getClientInOrg(parseInt(clientId), orgId)) {
      return res.status(404).json({ error: 'Cliente no encontrado en tu organización' });
    }
    const ticketNumber = 'TKT-' + Date.now();
    const [ticket] = await db.insert(tickets).values({
      organizationId: orgId,
      ticketNumber, clientId, subject, description, priority: priority || 'medium',
    }).returning();
    res.status(201).json(ticket);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear ticket' });
  }
});

ticketsRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    await db.delete(tickets).where(and(eq(tickets.id, parseInt(req.params.id)), orgFilter(tickets, orgId)));
    res.json({ message: 'Ticket eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar ticket' });
  }
});
