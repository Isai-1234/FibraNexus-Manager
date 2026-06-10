import { Router } from 'express';
import { db } from '../db/index.js';
import { tickets, users, clients } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';

export const ticketsRouter = Router();

ticketsRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const allTickets = await db.select({
      id: tickets.id, ticketNumber: tickets.ticketNumber, subject: tickets.subject,
      status: tickets.status, priority: tickets.priority, createdAt: tickets.createdAt,
      client: { fullName: users.fullName, email: users.email }
    })
    .from(tickets)
    .leftJoin(clients, eq(tickets.clientId, clients.id))
    .leftJoin(users, eq(clients.userId, users.id))
    .limit(50);
    res.json(allTickets);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar tickets' });
  }
});

ticketsRouter.post('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const { clientId, subject, description, priority } = req.body;
    const ticketNumber = 'TKT-' + Date.now();
    const [ticket] = await db.insert(tickets).values({
      ticketNumber, clientId, subject, description, priority: priority || 'medium'
    }).returning();
    res.status(201).json(ticket);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear ticket' });
  }
});
