import { Router } from 'express';
import { db } from '../db/index.js';
import { payments, invoices, clients, users } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId, getInvoiceInOrg } from '../lib/tenant.js';

export const paymentsRouter = Router();

paymentsRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const all = await db.select({
      id: payments.id,
      invoiceId: payments.invoiceId,
      clientId: payments.clientId,
      amount: payments.amount,
      method: payments.method,
      reference: payments.reference,
      paymentDate: payments.paymentDate,
      notes: payments.notes,
      createdAt: payments.createdAt,
      client: { fullName: users.fullName, email: users.email },
    })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .leftJoin(clients, eq(payments.clientId, clients.id))
      .leftJoin(users, eq(clients.userId, users.id))
      .where(orgFilter(invoices, orgId))
      .limit(50);
    res.json(all);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar pagos' });
  }
});

paymentsRouter.post('/', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const { invoiceId, method, reference, amount } = req.body;
    const inv = await getInvoiceInOrg(parseInt(invoiceId), orgId);
    if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
    if (inv.status === 'paid') return res.status(400).json({ error: 'La factura ya está pagada' });

    const payAmount = amount != null ? String(amount) : String(inv.total);
    const [payment] = await db.insert(payments).values({
      invoiceId: inv.id,
      clientId: inv.clientId,
      amount: payAmount,
      method: method || 'transfer',
      reference,
    }).returning();

    await db.update(invoices)
      .set({ status: 'paid', paidDate: new Date(), updatedAt: new Date() })
      .where(and(eq(invoices.id, inv.id), orgFilter(invoices, orgId)));

    res.status(201).json(payment);
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar pago: ' + error.message });
  }
});
