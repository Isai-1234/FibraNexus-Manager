import { Router } from 'express';
import { db } from '../db/index.js';
import { invoices, clients, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';

export const invoicesRouter = Router();

invoicesRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const allInvoices = await db.select({
      id: invoices.id, invoiceNumber: invoices.invoiceNumber, total: invoices.total,
      status: invoices.status, dueDate: invoices.dueDate, billingPeriod: invoices.billingPeriod,
      client: { fullName: users.fullName, email: users.email }
    })
    .from(invoices)
    .leftJoin(clients, eq(invoices.clientId, clients.id))
    .leftJoin(users, eq(clients.userId, users.id))
    .limit(50);
    res.json(allInvoices);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar facturas' });
  }
});

invoicesRouter.post('/generate', requireRole('admin'), async (req, res) => {
  try {
    const { billingPeriod, dueDate } = req.body;
    res.json({ message: 'Facturación generada para ' + billingPeriod, count: 0 });
  } catch (error) {
    res.status(500).json({ error: 'Error al generar facturas' });
  }
});
