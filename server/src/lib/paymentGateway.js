/**
 * Adaptador de pasarela de pagos (ISP → abonado).
 * Live solo si hay credenciales Flow o Webpay; si no, stub seguro.
 */

import crypto from 'crypto';

export function getPaymentProviderName() {
  if (process.env.FLOW_API_KEY && process.env.FLOW_SECRET_KEY) return 'flow';
  if (process.env.WEBPAY_COMMERCE_CODE && process.env.WEBPAY_API_KEY) return 'webpay';
  return 'stub';
}

export function isPaymentGatewayLive() {
  return getPaymentProviderName() !== 'stub';
}

export function getPaymentGatewayStatus() {
  const provider = getPaymentProviderName();
  return {
    provider,
    mode: provider === 'stub' ? 'stub' : 'live',
    configured: provider !== 'stub',
  };
}

export function createPaymentGateway(provider = getPaymentProviderName()) {
  if (provider === 'flow') return createFlowGateway();
  if (provider === 'webpay') return createWebpayGateway();
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
      return verifyHmacSha256(rawBody, signatureHeader, secret);
    },
    parseWebhookEvent(body) {
      return parseGenericWebhook(body);
    },
  };
}

/** Flow.cl — create payment via REST (signed params). */
function createFlowGateway() {
  const apiKey = process.env.FLOW_API_KEY;
  const secretKey = process.env.FLOW_SECRET_KEY;
  const apiBase = (process.env.FLOW_API_URL || 'https://www.flow.cl/api').replace(/\/$/, '');
  const publicBase = (process.env.PUBLIC_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');

  return {
    name: 'flow',
    async createCheckout({ organizationId, invoiceId, amount, currency = 'CLP', returnUrl, customerEmail }) {
      const commerceOrder = `fn-${organizationId}-${invoiceId}-${Date.now()}`;
      const urlConfirmation = `${publicBase}/api/webhooks/payments/flow`;
      const urlReturn = returnUrl || publicBase || '';
      const params = {
        apiKey,
        commerceOrder,
        subject: `Factura #${invoiceId}`,
        currency: currency || 'CLP',
        amount: Math.round(Number(amount)),
        email: customerEmail || `org${organizationId}@fibranexus.local`,
        urlConfirmation,
        urlReturn,
      };
      params.s = flowSign(params, secretKey);

      const body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
      const res = await fetch(`${apiBase}/payment/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url || !data?.token) {
        throw new Error(data?.message || data?.error || `Flow create failed (${res.status})`);
      }
      const checkoutUrl = `${data.url}?token=${encodeURIComponent(data.token)}`;
      return {
        provider: 'flow',
        externalId: String(data.token),
        amount: Number(amount),
        currency,
        checkoutUrl,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        metadata: { mode: 'live', commerceOrder, flowOrder: data.flowOrder, invoiceId, organizationId },
      };
    },
    verifyWebhookSignature(rawBody, signatureHeader, secret) {
      // Flow confirma con token; firma HMAC opcional si envían header.
      if (!signatureHeader) return true;
      return verifyHmacSha256(rawBody, signatureHeader, secret || secretKey);
    },
    parseWebhookEvent(body) {
      return {
        eventId: String(body.eventId || body.token || body.flowOrder || ''),
        organizationId: body.organizationId ? Number(body.organizationId) : null,
        invoiceId: body.invoiceId ? Number(body.invoiceId) : null,
        externalId: body.token || body.externalId || null,
        amount: body.amount != null ? Number(body.amount) : null,
        status: mapFlowStatus(body.status || body.paymentStatus),
        method: 'flow',
      };
    },
  };
}

function flowSign(params, secretKey) {
  const keys = Object.keys(params).filter((k) => k !== 's').sort();
  const toSign = keys.map((k) => `${k}${params[k]}`).join('');
  return crypto.createHmac('sha256', secretKey).update(toSign).digest('hex');
}

function mapFlowStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === '1' || s === 'paid' || s === 'success' || s === 'completed') return 'paid';
  if (s === '2' || s === 'pending') return 'pending';
  if (s === '3' || s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === '4' || s === 'failed' || s === 'rejected') return 'failed';
  return 'paid';
}

/** Transbank Webpay Plus REST. */
function createWebpayGateway() {
  const commerceCode = process.env.WEBPAY_COMMERCE_CODE;
  const apiKey = process.env.WEBPAY_API_KEY;
  const apiBase = (process.env.WEBPAY_API_URL
    || (process.env.WEBPAY_ENV === 'production'
      ? 'https://webpay3g.transbank.cl'
      : 'https://webpay3gint.transbank.cl')).replace(/\/$/, '');

  return {
    name: 'webpay',
    async createCheckout({ organizationId, invoiceId, amount, currency = 'CLP', returnUrl }) {
      const buyOrder = `fn${organizationId}i${invoiceId}t${Date.now()}`.slice(0, 26);
      const sessionId = `org${organizationId}`;
      const res = await fetch(`${apiBase}/rswebpaytransaction/api/webpay/v1.2/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Tbk-Api-Key-Id': commerceCode,
          'Tbk-Api-Key-Secret': apiKey,
        },
        body: JSON.stringify({
          buy_order: buyOrder,
          session_id: sessionId,
          amount: Math.round(Number(amount)),
          return_url: returnUrl || process.env.FRONTEND_URL || process.env.PUBLIC_URL,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url || !data?.token) {
        throw new Error(data?.error_message || data?.error || `Webpay create failed (${res.status})`);
      }
      return {
        provider: 'webpay',
        externalId: String(data.token),
        amount: Number(amount),
        currency,
        checkoutUrl: `${data.url}?token_ws=${encodeURIComponent(data.token)}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        metadata: { mode: 'live', buyOrder, invoiceId, organizationId },
      };
    },
    verifyWebhookSignature(rawBody, signatureHeader, secret) {
      if (!signatureHeader) return true;
      return verifyHmacSha256(rawBody, signatureHeader, secret || apiKey);
    },
    parseWebhookEvent(body) {
      return {
        eventId: String(body.eventId || body.token || body.buy_order || ''),
        organizationId: body.organizationId ? Number(body.organizationId) : null,
        invoiceId: body.invoiceId ? Number(body.invoiceId) : null,
        externalId: body.token || body.token_ws || body.externalId || null,
        amount: body.amount != null ? Number(body.amount) : null,
        status: body.status === 'AUTHORIZED' || body.response_code === 0 ? 'paid' : (body.status || 'paid'),
        method: 'card',
      };
    },
  };
}

function verifyHmacSha256(rawBody, signatureHeader, secret) {
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
}

function parseGenericWebhook(body) {
  return {
    eventId: String(body.eventId || body.id || ''),
    organizationId: body.organizationId ? Number(body.organizationId) : null,
    invoiceId: body.invoiceId ? Number(body.invoiceId) : null,
    externalId: body.externalId || body.intentId || null,
    amount: body.amount != null ? Number(body.amount) : null,
    status: body.status || 'paid',
    method: body.method || 'other',
  };
}

/** Firma HMAC para pruebas del stub / documentación */
export function signWebhookPayload(payload, secret = process.env.PAYMENT_WEBHOOK_SECRET) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', secret || 'dev-webhook-secret').update(raw).digest('hex');
}
