/**
 * Fase 1 — contratos SaaS (sin DB).
 * node --test server/src/lib/__tests__/saas-platform.unit.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isOrganizationActive } from '../tenant.js';
import { limitsFromSaasPlan } from '../saasPlans.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('isOrganizationActive (Fase 1)', () => {
  it('rejects suspended orgs', () => {
    assert.equal(isOrganizationActive({
      isActive: false,
      subscriptionStatus: 'suspended',
      plan: 'pro',
    }), false);
    assert.equal(isOrganizationActive({
      isActive: true,
      subscriptionStatus: 'suspended',
      plan: 'pro',
    }), false);
  });

  it('rejects expired trial', () => {
    assert.equal(isOrganizationActive({
      isActive: true,
      subscriptionStatus: 'trial',
      plan: 'trial',
      trialEndsAt: new Date(Date.now() - 86400000),
    }), false);
  });

  it('allows active paid plan', () => {
    assert.equal(isOrganizationActive({
      isActive: true,
      subscriptionStatus: 'active',
      plan: 'starter',
    }), true);
  });

  it('allows active trial with future end', () => {
    assert.equal(isOrganizationActive({
      isActive: true,
      subscriptionStatus: 'trial',
      plan: 'trial',
      trialEndsAt: new Date(Date.now() + 86400000 * 5),
    }), true);
  });
});

describe('limitsFromSaasPlan', () => {
  it('maps plan fields to org limits', () => {
    const mapped = limitsFromSaasPlan({
      id: 2,
      slug: 'starter',
      maxClients: 200,
      maxUsers: 5,
      maxRouters: 10,
      maxEquipment: 500,
      metricsRetentionDays: 14,
    });
    assert.equal(mapped.plan, 'starter');
    assert.equal(mapped.saasPlanId, 2);
    assert.equal(mapped.maxClients, 200);
    assert.equal(mapped.maxUsers, 5);
    assert.equal(mapped.metricsRetentionDays, 14);
  });
});

describe('Fase 1 code contracts', () => {
  it('migration 002 exists', () => {
    const p = path.join(root, 'migrations/002_saas_platform.sql');
    assert.equal(fs.existsSync(p), true);
    const body = fs.readFileSync(p, 'utf8');
    assert.match(body, /saas_plans/);
    assert.match(body, /subscription_status/);
    assert.match(body, /saas_invoices/);
  });

  it('platform has suspend/reactivate routes', () => {
    const src = fs.readFileSync(path.join(root, 'src/routes/platform.js'), 'utf8');
    assert.match(src, /\/suspend/);
    assert.match(src, /\/reactivate/);
    assert.match(src, /saas-invoices/);
  });

  it('staff router exists and enforces staff limit', () => {
    const src = fs.readFileSync(path.join(root, 'src/routes/staff.js'), 'utf8');
    assert.match(src, /assertWithinStaffLimit/);
    assert.match(src, /requireRole\('admin'\)/);
  });

  it('schema includes saas tables', () => {
    const src = fs.readFileSync(path.join(root, 'src/db/schema.js'), 'utf8');
    assert.match(src, /saasPlans/);
    assert.match(src, /saasInvoices/);
    assert.match(src, /subscriptionStatus/);
    assert.match(src, /maxUsers/);
  });
});
