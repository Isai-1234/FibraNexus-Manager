/**
 * Fase 3 — contratos de facturación / pasarela / avisos (sin DB).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createPaymentGateway,
  signWebhookPayload,
  getPaymentProviderName,
} from '../paymentGateway.js';
import { getMessagingProvider } from '../debtNotices.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Fase 3 payment gateway', () => {
  it('defaults to stub without live credentials', () => {
    assert.equal(getPaymentProviderName(), 'stub');
    const gw = createPaymentGateway();
    assert.match(gw.name, /stub/);
  });

  it('verifies HMAC webhook signatures', async () => {
    const gw = createPaymentGateway('stub');
    const body = { eventId: 'e1', invoiceId: 1, organizationId: 1, amount: 1000, status: 'paid' };
    const raw = JSON.stringify(body);
    const secret = 'test-secret';
    const sig = signWebhookPayload(raw, secret);
    assert.equal(gw.verifyWebhookSignature(raw, sig, secret), true);
    assert.equal(gw.verifyWebhookSignature(raw, 'bad', secret), false);
  });

  it('createCheckout returns stub URL with external id', async () => {
    const gw = createPaymentGateway('stub');
    const checkout = await gw.createCheckout({
      organizationId: 1,
      invoiceId: 9,
      amount: 15000,
    });
    assert.ok(checkout.externalId.startsWith('stub_'));
    assert.ok(checkout.checkoutUrl.includes('/api/webhooks/payments/stub/simulate'));
  });
});

describe('Fase 3 debt notices', () => {
  it('console provider is default', async () => {
    const p = getMessagingProvider();
    assert.equal(p.name, 'console');
    const r = await p.sendDebtNotice({
      organizationId: 1, clientId: 2, invoiceId: 3, total: 1000, daysOverdue: 5, to: 'a@b.cl',
    });
    assert.equal(r.ok, true);
  });
});

describe('Fase 3 billing contracts', () => {
  it('migration 005 and schema declare payment tables', () => {
    assert.match(read('migrations/005_billing_payments.sql'), /payment_intents/);
    assert.match(read('migrations/005_billing_payments.sql'), /payment_webhook_events/);
    assert.match(read('migrations/005_billing_payments.sql'), /invoice_adjustments/);
    const schema = read('src/db/schema.js');
    assert.match(schema, /export const paymentIntents/);
    assert.match(schema, /export const invoiceAdjustments/);
  });

  it('routes expose void, adjust, checkout and webhooks', () => {
    assert.match(read('src/routes/invoices.js'), /\/:id\/void/);
    assert.match(read('src/routes/invoices.js'), /\/:id\/adjust/);
    assert.match(read('src/routes/payments.js'), /\/checkout/);
    assert.match(read('src/index.js'), /\/api\/webhooks/);
    assert.match(read('src/routes/webhooks.js'), /PAYMENT_WEBHOOK_SECRET/);
  });

  it('billing jobs can emit debt notices when enabled', () => {
    assert.match(read('src/lib/orgSettings.js'), /debtNoticesEnabled/);
    assert.match(read('src/lib/billingScheduler.js'), /sendOverdueDebtNotices/);
  });
});
