import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { requireOrganizationId } from '../lib/tenant.js';
import { parseBody, paymentCreateSchema } from '../lib/validators.js';
import { registerPayment, sumPaymentsForInvoice } from '../lib/paymentService.js';
import { writeAuditLog, clientIp } from '../lib/auditLog.js';
import { db } from '../db/index.js';
import { payments, invoices, clients, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { orgFilter } from '../lib/tenant.js';

export const paymentsRouter = Router();

paymentsRouter.get('/', requireRole('admin', 'office', 'technician'), async (req, res) => {
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

paymentsRouter.post('/', requireRole('admin', 'office'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;

    const parsed = parseBody(paymentCreateSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const data = parsed.data;

    const result = await registerPayment({
      orgId,
      invoiceId: data.invoiceId,
      amount: data.amount,
      method: data.method,
      reference: data.reference,
      notes: data.notes,
      currency: data.currency || 'CLP',
      idempotencyKey: data.idempotencyKey,
    });

    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'payment.create',
      entity: 'payment',
      entityId: result.payment.id,
      details: {
        invoiceId: data.invoiceId,
        amount: data.amount,
        method: data.method,
        invoiceStatus: result.invoiceStatus,
        balance: result.balance,
        idempotent: result.idempotent,
      },
      ipAddress: clientIp(req),
    });

    let reactivation = null;
    if (result.fullyPaid) {
      try {
        const { tryAutoReactivateAfterPayment } = await import('../lib/subscriberSuspend.js');
        const inv = await db.query.invoices.findFirst({
          where: eq(invoices.id, data.invoiceId),
        });
        if (inv) reactivation = await tryAutoReactivateAfterPayment(inv, orgId);
      } catch (reactErr) {
        reactivation = { error: reactErr.message };
      }
    }

    res.status(result.idempotent ? 200 : 201).json({
      ...result.payment,
      invoiceStatus: result.invoiceStatus,
      balance: result.balance,
      paidSum: result.paidSum,
      reactivation,
      idempotent: result.idempotent,
    });
  } catch (error) {
    console.error('Payment error:', error.message);
    res.status(500).json({ error: 'Error al registrar pago' });
  }
});

paymentsRouter.get('/invoice/:invoiceId/balance', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const invoiceId = parseInt(req.params.invoiceId, 10);
    const rows = await db.select().from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);
    const inv = rows[0];
    if (!inv || inv.organizationId !== orgId) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }
    const paidSum = await sumPaymentsForInvoice(invoiceId);
    res.json({
      invoiceId,
      total: Number(inv.total),
      paidSum,
      balance: Math.max(0, Number(inv.total) - paidSum),
      status: inv.status,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al calcular saldo' });
  }
});
