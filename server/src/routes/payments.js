import { Router } from 'express';
import { db } from '../db/index.js';
import { payments, invoices } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';

export const paymentsRouter = Router();

paymentsRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  const all = await db.select().from(payments).limit(50);
  res.json(all);
});

paymentsRouter.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { invoiceId, clientId, amount, method, reference } = req.body;
    const [payment] = await db.insert(payments).values({
      invoiceId: parseInt(invoiceId), clientId: parseInt(clientId),
      amount: String(amount), method: method || 'transfer', reference
    }).returning();

    // Verificar si la factura queda pagada
    const inv = await db.query.invoices.findFirst({ where: eq(invoices.id, parseInt(invoiceId)) });
    if (inv && Number(inv.total) <= Number(amount)) {
      await db.update(invoices).set({ status: 'paid', paidDate: new Date() }).where(eq(invoices.id, parseInt(invoiceId)));
    }

    res.status(201).json(payment);
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar pago: ' + error.message });
  }
});
