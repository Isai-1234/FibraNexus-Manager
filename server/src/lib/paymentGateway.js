/**
 * Adaptador de pasarela de pagos (ISP → abonado).
 * Sin credenciales reales solo opera el stub — no se inventa Flow/Webpay.
 */

import crypto from 'crypto';

export function getPaymentProviderName() {
  if (process.env.FLOW_API_KEY && process.env.FLOW_SECRET_KEY) return 'flow';
  if (process.env.WEBPAY_COMMERCE_CODE && process.env.WEBPAY_API_KEY) return 'webpay';
  return 'stub';
}

export function createPaymentGateway(provider = getPaymentProviderName()) {
  if (provider === 'stub' || provider === 'flow' || provider === 'webpay') {
    // Flow/Webpay reales requieren SDK + certs; hasta entonces stub seguro.
    return createStubGateway(provider === 'stub' ? 'stub' : `${provider}-stub`);
  }
  return createStubGateway('stub');
}

function createStubGateway(providerLabel) {
  return {
    name: providerLabel,
    async createCheckout({ organizationId, invoiceId, amount, currency = 'CLP', returnUrl }) {
      const externalId = `stub_${organizationId}_${invoiceId}_${crypto.randomBytes(6).toString('hex')}`;
      const base = (process.env.PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:10000').replace(/\/$/, '');
      const checkoutUrl = `${base}/api/webhooks/payments/stub/simulate?intent=${encodeURIComponent(externalId)}&returnUrl=${encodeURIComponent(returnUrl || '')}`;
      return {
        provider: providerLabel,
        externalId,
        amount: Number(amount),
        currency,
        checkoutUrl,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        metadata: { mode: 'stub', invoiceId, organizationId },
      };
    },
    verifyWebhookSignature(rawBody, signatureHeader, secret) {
      if (!secret) return false;
      const expected = crypto
        .createHmac('sha256', secret)
        .update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody))
        .digest('hex');
      const provided = String(signatureHeader || '').replace(/^sha256=/i, '').trim();
      if (!provided || provided.length !== expected.length) return false;
      try {
        return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
      } catch {
        return false;
      }
    },
    parseWebhookEvent(body) {
      return {
        eventId: String(body.eventId || body.id || ''),
        organizationId: body.organizationId ? Number(body.organizationId) : null,
        invoiceId: body.invoiceId ? Number(body.invoiceId) : null,
        externalId: body.externalId || body.intentId || null,
        amount: body.amount != null ? Number(body.amount) : null,
        status: body.status || 'paid',
        method: body.method || 'other',
      };
    },
  };
}

/** Firma HMAC para pruebas del stub / documentación */
export function signWebhookPayload(payload, secret = process.env.PAYMENT_WEBHOOK_SECRET) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', secret || 'dev-webhook-secret').update(raw).digest('hex');
}
