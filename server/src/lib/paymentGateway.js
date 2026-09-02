/**
 * Adaptador de pasarela de pagos (ISP → abonado).
 * Credenciales por organización (Flow/Webpay en settings).
 * Sin credenciales del ISP → stub seguro.
 */

import crypto from 'crypto';

/** Compat tests / webhooks stub: sin org usa solo stub o provider explícito. */
export function getPaymentProviderName() {
  return 'stub';
}

export function isPaymentGatewayLive() {
  return false;
}

export function getPaymentGatewayStatus(orgSettings = null) {
  return getPaymentGatewayStatusFromSettings(orgSettings || {});
}

/**
 * Estado público (sin secretos) a partir de settings de la org.
 */
export function getPaymentGatewayStatusFromSettings(settings = {}) {
  const provider = resolveOrgProvider(settings);
  return {
    provider,
    mode: provider === 'stub' ? 'stub' : 'live',
    configured: provider !== 'stub',
    paymentProvider: settings.paymentProvider === 'flow' || settings.paymentProvider === 'webpay'
      ? settings.paymentProvider
      : (provider === 'stub' ? 'stub' : provider),
    hasFlowApiKey: Boolean(settings.flowApiKey || settings._hasFlowApiKey),
    hasFlowSecretKey: Boolean(settings.flowSecretKey || settings._hasFlowSecretKey),
  };
}

function resolveOrgProvider(settings = {}) {
  const preferred = String(settings.paymentProvider || 'stub').toLowerCase();
  if (preferred === 'flow' && settings.flowApiKey && settings.flowSecretKey) return 'flow';
  if (preferred === 'webpay' && settings.webpayCommerceCode && settings.webpayApiKey) return 'webpay';
  // Auto: si eligió stub pero tiene keys de flow, no forzar live — solo si paymentProvider=flow
  return 'stub';
}

/**
 * @param {string|object} providerOrSettings - 'stub'|'flow'|'webpay' o settings de org
 * @param {object} [credentials] - override opcional { flowApiKey, flowSecretKey, ... }
 */
export function createPaymentGateway(providerOrSettings = 'stub', credentials = null) {
  if (providerOrSettings && typeof providerOrSettings === 'object') {
    const settings = { ...providerOrSettings, ...(credentials || {}) };
    const provider = resolveOrgProvider(settings);
    if (provider === 'flow') {
      return createFlowGateway({
        apiKey: settings.flowApiKey,
        secretKey: settings.flowSecretKey,
        apiBase: settings.flowApiUrl,
      });
    }
    if (provider === 'webpay') {
      return createWebpayGateway({
        commerceCode: settings.webpayCommerceCode,
        apiKey: settings.webpayApiKey,
        apiBase: settings.webpayApiUrl,
        env: settings.webpayEnv,
      });
    }
    return createStubGateway('stub');
  }

  const provider = String(providerOrSettings || 'stub');
  if (provider === 'flow' && credentials?.apiKey && credentials?.secretKey) {
    return createFlowGateway(credentials);
  }
  if (provider === 'webpay' && credentials?.commerceCode && credentials?.apiKey) {
    return createWebpayGateway(credentials);
  }
  return createStubGateway(provider === 'stub' ? 'stub' : 'stub');
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

function createFlowGateway({ apiKey, secretKey, apiBase: apiBaseIn } = {}) {
  const apiBase = (apiBaseIn || process.env.FLOW_API_URL || 'https://www.flow.cl/api').replace(/\/$/, '');
  const publicBase = (process.env.PUBLIC_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');

  return {
    name: 'flow',
    async createCheckout({ organizationId, invoiceId, amount, currency = 'CLP', returnUrl, customerEmail }) {
      if (!apiKey || !secretKey) {
        throw new Error('Flow no configurado: falta API Key o Secret Key del ISP');
      }
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
    /**
     * Flujo real de confirmación: Flow notifica solo el token (POST form-encoded
     * a urlConfirmation) y el estado se consulta firmado a /payment/getStatus.
     * status: 1=pagada 2=pendiente 3=cancelada 4=fallida.
     */
    async getPaymentStatus(token) {
      const params = { apiKey, token: String(token) };
      params.s = flowSign(params, secretKey);
      const qs = new URLSearchParams(params);
      const res = await fetch(`${apiBase}/payment/getStatus?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || `Flow getStatus failed (${res.status})`);
      }
      return {
        rawStatus: Number(data.status),
        status: mapFlowStatus(data.status),
        amount: data.amount != null ? Number(data.amount) : null,
        subject: data.subject || null,
        email: data.email || null,
        commerceOrder: data.commerce_order || data.commerceOrder || null,
        flowOrder: data.flowOrder || null,
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

function createWebpayGateway({ commerceCode, apiKey, apiBase: apiBaseIn, env } = {}) {
  const apiBase = (apiBaseIn
    || (env === 'production' || process.env.WEBPAY_ENV === 'production'
      ? 'https://webpay3g.transbank.cl'
      : 'https://webpay3gint.transbank.cl')).replace(/\/$/, '');

  return {
    name: 'webpay',
    async createCheckout({ organizationId, invoiceId, amount, currency = 'CLP', returnUrl }) {
      if (!commerceCode || !apiKey) {
        throw new Error('Webpay no configurado: falta código de comercio o API key del ISP');
      }
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

export function signWebhookPayload(payload, secret = process.env.PAYMENT_WEBHOOK_SECRET) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', secret || 'dev-webhook-secret').update(raw).digest('hex');
}
