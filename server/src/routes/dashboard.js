import { Router } from 'express';
import { db } from '../db/index.js';
import { clients, clientServices, equipment, invoices, tickets, users, plans } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';

export const dashboardRouter = Router();

dashboardRouter.get('/admin', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const totalClients = (await db.select({ count: sql`count(*)` }).from(clients))[0].count;
    const activeServices = (await db.select({ count: sql`count(*)` }).from(clientServices).where(eq(clientServices.status, 'active')))[0].count;
    const totalEquipment = (await db.select({ count: sql`count(*)` }).from(equipment))[0].count;
    const pendingInvoices = (await db.select({ count: sql`count(*)`, total: sql`sum(total::decimal)` }).from(invoices).where(eq(invoices.status, 'pending')))[0];
    const openTickets = (await db.select({ count: sql`count(*)` }).from(tickets).where(eq(tickets.status, 'open')))[0].count;
    const totalPlans = (await db.select({ count: sql`count(*)` }).from(plans))[0].count;

    const recentClients = await db.select({
      id: clients.id, fullName: users.fullName, email: users.email, city: clients.city, createdAt: clients.createdAt
    }).from(clients).leftJoin(users, eq(clients.userId, users.id)).orderBy(clients.createdAt).limit(5);

    const recentTickets = await db.select({
      id: tickets.id, subject: tickets.subject, status: tickets.status, priority: tickets.priority, createdAt: tickets.createdAt
    }).from(tickets).orderBy(tickets.createdAt).limit(5);

    res.json({
      stats: { totalClients: Number(totalClients), activeServices: Number(activeServices),
        totalEquipment: Number(totalEquipment), openTickets: Number(openTickets), totalPlans: Number(totalPlans),
        pendingAmount: Number(pendingInvoices.total || 0), pendingCount: Number(pendingInvoices.count || 0) },
      recentClients, recentTickets
    });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});
