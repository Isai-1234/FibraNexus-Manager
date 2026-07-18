import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { requireOrganizationId } from '../lib/tenant.js';
import { parseBody, paymentCreateSchema } from '../lib/validators.js';
import { registerPayment, sumPaymentsForInvoice } from '../lib/paymentService.js';
import { writeAuditLog, clientIp } from '../lib/auditLog.js';
import { db } from '../db/index.js';
import { payments, invoices, clients, users } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
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

/** Crea checkout (stub o pasarela cuando haya credenciales) */
paymentsRouter.post('/checkout', requireRole('admin', 'office'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const invoiceId = parseInt(req.body.invoiceId, 10);
    if (!invoiceId) return res.status(400).json({ error: 'invoiceId requerido' });

    const [inv] = await db.select().from(invoices)
      .where(and(eq(invoices.id, invoiceId), orgFilter(invoices, orgId)))
      .limit(1);
    if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
    if (inv.status === 'cancelled' || inv.status === 'paid') {
      return res.status(400).json({ error: 'La factura no admite cobro online' });
    }

    const paidSum = await sumPaymentsForInvoice(invoiceId);
    const balance = Math.max(0, Number(inv.total) - paidSum);
    if (balance <= 0) return res.status(400).json({ error: 'Saldo en cero' });

    const { createOrgPaymentGateway } = await import('../lib/orgPayment.js');
    const { paymentIntents } = await import('../db/schema.js');
    const gateway = await createOrgPaymentGateway(orgId);
    const checkout = await gateway.createCheckout({
      organizationId: orgId,
      invoiceId,
      amount: balance,
      currency: 'CLP',
      returnUrl: req.body.returnUrl || process.env.FRONTEND_URL || '',
    });

    const [intent] = await db.insert(paymentIntents).values({
      organizationId: orgId,
      invoiceId,
      clientId: inv.clientId,
      provider: String(checkout.provider).includes('stub') ? 'stub' : checkout.provider,
      externalId: checkout.externalId,
      amount: String(balance.toFixed(2)),
      currency: 'CLP',
      status: 'pending',
      checkoutUrl: checkout.checkoutUrl,
      metadata: checkout.metadata || {},
      expiresAt: checkout.expiresAt,
    }).returning();

    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'payment.checkout_create',
      entity: 'payment_intent',
      entityId: intent.id,
      details: { invoiceId, amount: balance, provider: intent.provider },
      ipAddress: clientIp(req),
    });

    res.status(201).json({
      intentId: intent.id,
      provider: intent.provider,
      externalId: intent.externalId,
      amount: balance,
      checkoutUrl: intent.checkoutUrl,
      expiresAt: intent.expiresAt,
      mode: intent.provider === 'stub' ? 'stub' : 'live',
    });
  } catch (error) {
    console.error('Checkout error:', error.message);
    res.status(500).json({ error: error.message || 'Error al crear checkout' });
  }
});
