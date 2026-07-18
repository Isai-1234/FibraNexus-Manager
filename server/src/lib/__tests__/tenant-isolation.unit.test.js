/**
 * Pruebas de aislamiento multi-tenant (lógica + contrato de helpers).
 * node --test server/src/lib/__tests__/tenant-isolation.unit.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('tenant isolation contracts in routes', () => {
  const criticalRoutes = [
    'src/routes/clients.js',
    'src/routes/payments.js',
    'src/routes/invoices.js',
    'src/routes/plans.js',
    'src/routes/services.js',
    'src/routes/equipment.js',
    'src/routes/routers.js',
    'src/routes/tickets.js',
  ];

  for (const rel of criticalRoutes) {
    it(`${rel} uses requireOrganizationId / orgFilter`, () => {
      const src = read(rel);
      assert.match(src, /requireOrganizationId/);
      assert.ok(src.includes('orgFilter') || src.includes('organizationId'), `missing org scope in ${rel}`);
    });
  }

  it('clients soft-delete does not delete payments', () => {
    const src = read('src/routes/clients.js');
    assert.equal(src.includes('db.delete(payments)'), false);
    assert.equal(src.includes('db.delete(invoices)'), false);
    assert.match(src, /deletedAt/);
    assert.match(src, /softDelete|soft_delete|dado de baja/i);
  });

  it('payments do not auto-mark paid without balance check', () => {
    const src = read('src/routes/payments.js');
    assert.match(src, /registerPayment/);
    assert.equal(src.includes("status: 'paid', paidDate"), false);
  });

  it('ensureOrgStaffAccess no longer promotes roles', () => {
    const src = read('src/lib/tenant.js');
    assert.equal(src.includes("role: 'admin'"), false);
  });

  it('IP unique is per-organization in schema', () => {
    const src = read('src/db/schema.js');
    assert.match(src, /uq_ip_addresses_org_address/);
    assert.equal(/address: varchar\('address'[^)]*\)\.notNull\(\)\.unique\(\)/.test(src), false);
  });
});
