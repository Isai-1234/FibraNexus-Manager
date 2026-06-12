import { Router } from 'express';
import { db } from '../db/index.js';
import { clients, clientServices, invoices, tickets, users, plans } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import {
  fetchClientTicketDetail,
  addTicketMessage,
  updateTicketRecord,
  getTicketForClient,
} from '../lib/ticketService.js';
export const portalRouter = Router();

async function getClientAccount(userId) {
  return db.query.clients.findFirst({ where: eq(clients.userId, userId) });
}

portalRouter.use(authenticateToken, requireRole('client'));

portalRouter.get('/dashboard', async (req, res) => {
  try {
    const client = await getClientAccount(req.user.id);
    if (!client) return res.status(404).json({ error: 'Cuenta de abonado no encontrada' });

    const services = await db.select({
      id: clientServices.id,
      status: clientServices.status,
      ipAddress: clientServices.ipAddress,
      macAddress: clientServices.macAddress,
      installationDate: clientServices.installationDate,
      nextBillingDate: clientServices.nextBillingDate,
      plan: {
        name: plans.name,
        downloadSpeed: plans.downloadSpeed,
        uploadSpeed: plans.uploadSpeed,
        price: plans.price,
      },
    })
      .from(clientServices)
      .leftJoin(plans, eq(clientServices.planId, plans.id))
      .where(eq(clientServices.clientId, client.id));

    const clientInvoices = await db.select()
      .from(invoices)
      .where(eq(invoices.clientId, client.id))
      .orderBy(invoices.createdAt)
      .limit(20);

    const clientTickets = await db.select()
      .from(tickets)
      .where(eq(tickets.clientId, client.id))
      .orderBy(tickets.createdAt)
      .limit(20);

    const user = await db.query.users.findFirst({ where: eq(users.id, req.user.id) });
    const pendingAmount = clientInvoices
      .filter((i) => i.status === 'pending' || i.status === 'overdue')
      .reduce((sum, i) => sum + Number(i.total || 0), 0);

    const daysAsClient = Math.max(0, Math.floor(
      (Date.now() - new Date(client.createdAt).getTime()) / (1000 * 60 * 60 * 24),
    ));

    res.json({
      client: { ...client, user: { fullName: user?.fullName, email: user?.email, phone: user?.phone } },
      daysAsClient,
      services,
      invoices: clientInvoices,
      tickets: clientTickets,
      pendingAmount,
      openTickets: clientTickets.filter((t) => ['open', 'in_progress', 'waiting_client'].includes(t.status)).length,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

portalRouter.post('/tickets', async (req, res) => {
  try {
    const client = await getClientAccount(req.user.id);
    if (!client) return res.status(404).json({ error: 'Cuenta no encontrada' });
    const { subject, description, priority, category } = req.body;
    const ticketNumber = 'TKT-' + Date.now();
    const [ticket] = await db.insert(tickets).values({
      organizationId: client.organizationId,
      ticketNumber,
      clientId: client.id,
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

    res.status(201).json(ticket);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear ticket: ' + error.message });
  }
});

portalRouter.get('/tickets/:id', async (req, res) => {
  try {
    const client = await getClientAccount(req.user.id);
    if (!client) return res.status(404).json({ error: 'Cuenta no encontrada' });
    const ticketId = parseInt(req.params.id, 10);
    const detail = await fetchClientTicketDetail(ticketId, client.id);
    if (!detail) return res.status(404).json({ error: 'Ticket no encontrado' });
    res.json(detail);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener ticket' });
  }
});

portalRouter.post('/tickets/:id/messages', async (req, res) => {
  try {
    const client = await getClientAccount(req.user.id);
    if (!client) return res.status(404).json({ error: 'Cuenta no encontrada' });
    const ticketId = parseInt(req.params.id, 10);
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Mensaje requerido' });

    const ticket = await getTicketForClient(ticketId, client.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });
    if (['closed', 'resolved'].includes(ticket.status)) {
      return res.status(400).json({ error: 'Este ticket ya está cerrado' });
    }

    await addTicketMessage({
      ticketId,
      userId: req.user.id,
      message: message.trim(),
      isInternal: false,
    });

    if (ticket.status === 'waiting_client' || ticket.status === 'resolved') {
      await updateTicketRecord(ticketId, client.organizationId, { status: 'open' });
    }

    const detail = await fetchClientTicketDetail(ticketId, client.id);
    res.status(201).json(detail);
  } catch (error) {
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});
