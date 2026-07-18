/**
 * Post-MVP ops — gateway live status, PDF, OT uploads (sin DB).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createPaymentGateway,
  getPaymentProviderName,
  getPaymentGatewayStatus,
  isPaymentGatewayLive,
} from '../paymentGateway.js';
import { buildInvoicePdfBuffer } from '../invoicePdf.js';
import { publicUploadUrl, buildStoredFilename } from '../uploads.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Post-MVP payment gateway status', () => {
  it('defaults to stub mode without credentials', () => {
    assert.equal(getPaymentProviderName(), 'stub');
    assert.equal(isPaymentGatewayLive(), false);
    const st = getPaymentGatewayStatus();
    assert.equal(st.mode, 'stub');
    assert.equal(st.provider, 'stub');
  });

  it('createPaymentGateway stub still works', async () => {
    const gw = createPaymentGateway('stub');
    assert.equal(gw.name, 'stub');
    const checkout = await gw.createCheckout({ organizationId: 1, invoiceId: 2, amount: 1000 });
    assert.ok(checkout.checkoutUrl.includes('/api/webhooks/payments/stub/simulate'));
  });

  it('settings expose paymentGateway status', () => {
    assert.match(read('src/routes/settings.js'), /getPaymentGatewayStatus/);
    assert.match(read('src/routes/settings.js'), /paymentGateway/);
  });
});

describe('Post-MVP invoice PDF', () => {
  it('buildInvoicePdfBuffer returns a PDF buffer', async () => {
    const buf = await buildInvoicePdfBuffer({
      invoice: {
        id: 1,
        invoiceNumber: 'F-TEST-1',
        status: 'pending',
        amount: 10000,
        tax: 1900,
        total: 11900,
        dueDate: '2026-07-20',
        createdAt: new Date(),
        billingPeriod: '2026-07',
        clientId: 9,
      },
      client: { fullName: 'Cliente Test', email: 'c@test.cl', rut: '11111111-1' },
      org: { name: 'ISP Test' },
      paidSum: 0,
      balance: 11900,
    });
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 100);
    assert.equal(buf.slice(0, 4).toString(), '%PDF');
  });

  it('routes expose PDF for staff and portal', () => {
    assert.match(read('src/routes/invoices.js'), /\/:id\/pdf/);
    assert.match(read('src/routes/portal.js'), /\/invoices\/:id\/pdf/);
  });
});

describe('Post-MVP OT uploads', () => {
  it('publicUploadUrl and filename helpers', () => {
    assert.equal(publicUploadUrl(3, 9, 'a.jpg'), '/uploads/work-orders/3/9/a.jpg');
    assert.match(buildStoredFilename('foto.PNG'), /\.png$/);
  });

  it('work-orders attachments route and static uploads mounted', () => {
    assert.match(read('src/routes/workOrders.js'), /\/:id\/attachments/);
    assert.match(read('src/routes/workOrders.js'), /multer/);
    assert.match(read('src/index.js'), /\/uploads/);
    assert.match(read('src/index.js'), /ensureUploadRoot/);
  });
});
