import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  paymentIntents,
  paymentWebhookEvents,
  invoices,
} from '../db/schema.js';
import { createPaymentGateway } from '../lib/paymentGateway.js';
import { registerPayment } from '../lib/paymentService.js';
import { writeAuditLog, clientIp } from '../lib/auditLog.js';
import { rateLimit } from '../lib/rateLimit.js';
import { orgFilter } from '../lib/tenant.js';

export const webhooksRouter = Router();

async function processPaidWebhook({ provider, event, intent, inv, orgId, invoiceId, req, res }) {
  await db.insert(paymentWebhookEvents).values({
    organizationId: orgId,
    provider,
    eventId: event.eventId,
    invoiceId,
    paymentIntentId: intent?.id || null,
    payload: req.body || {},
  });

  if (event.status === 'failed' || event.status === 'cancelled') {
    if (intent) {
      await db.update(paymentIntents).set({
        status: 'failed',
        updatedAt: new Date(),
      }).where(eq(paymentIntents.id, intent.id));
    }
    await writeAuditLog({
      organizationId: orgId,
      userId: null,
      action: 'payment.webhook_failed',
      entity: 'invoice',
      entityId: invoiceId,
      details: { provider, eventId: event.eventId, status: event.status },
      ipAddress: clientIp(req),
    });
    try {
      const { raisePaymentFailAlert } = await import('../lib/orgAlerts.js');
      await raisePaymentFailAlert(orgId, invoiceId, `Webhook ${provider}: ${event.status}`);
    } catch { /* non-fatal */ }
    return res.json({ ok: true, status: event.status });
  }

  const amount = event.amount != null ? event.amount : Number(inv.total);
  const method = ['flow', 'card', 'transfer', 'cash', 'other'].includes(event.method)
    ? event.method
    : 'other';

  const result = await registerPayment({
    orgId,
    invoiceId,
    amount,
    method,
    reference: `wh:${provider}:${event.eventId}`,
    notes: `Webhook ${provider}`,
    idempotencyKey: `wh:${provider}:${event.eventId}`,
  });

  if (result.error && !result.idempotent) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  if (intent) {
    await db.update(paymentIntents).set({
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(paymentIntents.id, intent.id));
  }

  await writeAuditLog({
    organizationId: orgId,
    userId: null,
    action: 'payment.webhook',
    entity: 'payment',
    entityId: result.payment?.id,
    details: {
      provider,
      eventId: event.eventId,
      invoiceId,
      invoiceStatus: result.invoiceStatus,
      balance: result.balance,
    },
    ipAddress: clientIp(req),
  });

  if (result.fullyPaid) {
    try {
      const { tryAutoReactivateAfterPayment } = await import('../lib/subscriberSuspend.js');
      await tryAutoReactivateAfterPayment(inv, orgId);
    } catch { /* non-fatal */ }
  }

  return res.json({
    ok: true,
    invoiceStatus: result.invoiceStatus,
    balance: result.balance,
    idempotent: result.idempotent,
  });
}

/**
 * Webhook firmado de pasarela.
 * Header: X-Webhook-Signature: <hmac-sha256 hex del body JSON>
 * Secret: PAYMENT_WEBHOOK_SECRET
 */
webhooksRouter.post(
  '/payments/:provider',
  rateLimit({ name: 'payment_webhook', windowMs: 60_000, max: 120 }),
  async (req, res) => {
    try {
      const provider = String(req.params.provider || 'stub').toLowerCase();
      const gateway = createPaymentGateway('stub');
      const secret = process.env.PAYMENT_WEBHOOK_SECRET;
      if (!secret) {
        return res.status(503).json({ error: 'PAYMENT_WEBHOOK_SECRET no configurado' });
      }

      const raw = JSON.stringify(req.body || {});
      const sig = req.get('X-Webhook-Signature') || req.get('x-webhook-signature');
      if (!gateway.verifyWebhookSignature(raw, sig, secret)) {
        return res.status(401).json({ error: 'Firma inválida' });
      }

      const event = gateway.parseWebhookEvent(req.body || {});
      if (!event.eventId) {
        return res.status(400).json({ error: 'eventId requerido' });
      }

      const existing = await db.select({ id: paymentWebhookEvents.id })
        .from(paymentWebhookEvents)
        .where(and(
          eq(paymentWebhookEvents.provider, provider),
          eq(paymentWebhookEvents.eventId, event.eventId),
        ))
        .limit(1);
      if (existing.length) {
        return res.json({ ok: true, idempotent: true });
      }

      let orgId = event.organizationId;
      let invoiceId = event.invoiceId;
      let intent = null;

      if (event.externalId) {
        const intents = await db.select().from(paymentIntents)
          .where(eq(paymentIntents.externalId, event.externalId))
          .limit(5);
        intent = intents[0] || null;
        if (intent) {
          orgId = intent.organizationId;
          invoiceId = intent.invoiceId;
        }
      }

      if (!orgId || !invoiceId) {
        return res.status(400).json({ error: 'organizationId e invoiceId (o externalId) requeridos' });
      }

      const [inv] = await db.select().from(invoices)
        .where(and(eq(invoices.id, invoiceId), orgFilter(invoices, orgId)))
        .limit(1);
      if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });

      return await processPaidWebhook({
        provider, event, intent, inv, orgId, invoiceId, req, res,
      });
    } catch (error) {
      console.error('Webhook payment error:', error.message);
      res.status(500).json({ error: 'Error procesando webhook' });
    }
  },
);

/**
 * Simulador GET del stub (dev/demo). En producción requiere ALLOW_STUB_PAYMENT=1.
 */
webhooksRouter.get('/payments/stub/simulate', rateLimit({ name: 'stub_sim', windowMs: 60_000, max: 30 }), async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_STUB_PAYMENT !== '1') {
      return res.status(404).json({ error: 'No disponible' });
    }
    const externalId = String(req.query.intent || '');
    if (!externalId) return res.status(400).send('intent requerido');

    const [intent] = await db.select().from(paymentIntents)
      .where(eq(paymentIntents.externalId, externalId))
      .limit(1);
    if (!intent) return res.status(404).send('Intent no encontrado');

    const payload = {
      eventId: `sim_${externalId}_${Date.now()}`,
      organizationId: intent.organizationId,
      invoiceId: intent.invoiceId,
      externalId: intent.externalId,
      amount: Number(intent.amount),
      status: 'paid',
      method: 'other',
    };

    const existing = await db.select({ id: paymentWebhookEvents.id })
      .from(paymentWebhookEvents)
      .where(and(
        eq(paymentWebhookEvents.provider, 'stub'),
        eq(paymentWebhookEvents.eventId, payload.eventId),
      ))
      .limit(1);

    if (!existing.length) {
      await db.insert(paymentWebhookEvents).values({
        organizationId: intent.organizationId,
        provider: 'stub',
        eventId: payload.eventId,
        invoiceId: intent.invoiceId,
        paymentIntentId: intent.id,
        payload,
      });
      await registerPayment({
        orgId: intent.organizationId,
        invoiceId: intent.invoiceId,
        amount: Number(intent.amount),
        method: 'other',
        reference: `wh:stub:${payload.eventId}`,
        notes: 'Simulación stub',
        idempotencyKey: `wh:stub:${payload.eventId}`,
      });
      await db.update(paymentIntents).set({
        status: 'completed',
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(paymentIntents.id, intent.id));
    }

    const returnUrl = String(req.query.returnUrl || '');
    if (returnUrl.startsWith('http')) {
      return res.redirect(returnUrl);
    }
    res.type('html').send('<h1>Pago stub OK</h1><p>Puedes cerrar esta ventana.</p>');
  } catch (error) {
    res.status(500).send(error.message);
  }
});
