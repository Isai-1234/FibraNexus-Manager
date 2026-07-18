/**
 * Pruebas unitarias de seguridad (sin DB).
 * Ejecutar: node --test server/src/lib/__tests__/security.unit.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptSecret,
  decryptSecret,
  isEncryptedValue,
  sanitizeCredentialsForApi,
  sanitizeEquipmentRow,
  redactToken,
} from '../secrets.js';
import { computeInvoiceStatus } from '../paymentStatus.js';
import { parseBody, loginSchema, paymentCreateSchema, passwordSchema } from '../validators.js';

describe('secrets encryption', () => {
  it('roundtrips with CREDENTIALS_ENCRYPTION_KEY', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('hex');
    const enc = encryptSecret('super-secret-pass');
    assert.equal(isEncryptedValue(enc), true);
    assert.equal(decryptSecret(enc), 'super-secret-pass');
  });

  it('sanitizeCredentialsForApi strips secrets', () => {
    const safe = sanitizeCredentialsForApi({
      routerUser: 'admin',
      routerPass: 'secret',
      agentToken: 'tok-123456789',
      tunnelToken: 'cf-token',
      routerType: 'mikrotik',
      pendingCmds: [{ id: 1 }],
    });
    assert.equal(safe.routerPass, undefined);
    assert.equal(safe.agentToken, undefined);
    assert.equal(safe.tunnelToken, undefined);
    assert.equal(safe.hasRouterPass, true);
    assert.equal(safe.hasAgentToken, true);
    assert.equal(safe.pendingCmdCount, 1);
  });

  it('sanitizeEquipmentRow hides snmpCommunity', () => {
    const row = sanitizeEquipmentRow({
      id: 1,
      name: 'AP1',
      snmpCommunity: 'public',
      credentials: { routerPass: 'x', routerUser: 'u' },
    });
    assert.equal(row.snmpCommunity, undefined);
    assert.equal(row.hasSnmpCommunity, true);
    assert.equal(row.credentials.routerPass, undefined);
  });

  it('redactToken masks middle', () => {
    assert.match(redactToken('abcdefghijklmnop'), /…/);
  });
});

describe('payment status math', () => {
  it('marks partial when underpaid', () => {
    assert.equal(computeInvoiceStatus({
      total: 10000,
      paidSum: 3000,
      dueDate: '2099-01-01',
      currentStatus: 'pending',
    }), 'partial');
  });

  it('marks paid when covered', () => {
    assert.equal(computeInvoiceStatus({
      total: 10000,
      paidSum: 10000,
      dueDate: '2099-01-01',
      currentStatus: 'partial',
    }), 'paid');
  });

  it('keeps cancelled', () => {
    assert.equal(computeInvoiceStatus({
      total: 10000,
      paidSum: 0,
      dueDate: '2020-01-01',
      currentStatus: 'cancelled',
    }), 'cancelled');
  });
});

describe('validators', () => {
  it('rejects weak passwords', () => {
    const r = passwordSchema.safeParse('short');
    assert.equal(r.success, false);
  });

  it('accepts strong password', () => {
    const r = passwordSchema.safeParse('Segura12345');
    assert.equal(r.success, true);
  });

  it('validates login body', () => {
    const bad = parseBody(loginSchema, { email: 'nope', password: '' });
    assert.ok(bad.error);
    const ok = parseBody(loginSchema, { email: 'a@b.cl', password: 'x' });
    assert.equal(ok.error, null);
  });

  it('requires positive payment amount', () => {
    const bad = parseBody(paymentCreateSchema, {
      invoiceId: 1,
      amount: 0,
      method: 'transfer',
    });
    assert.ok(bad.error);
  });
});

describe('auth setup route must not exist in module exports', async () => {
  it('auth router source has no /setup handler registration', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const authSrc = fs.readFileSync(path.join(dir, '../../routes/auth.js'), 'utf8');
    assert.equal(authSrc.includes("authRouter.post('/setup'"), false);
    assert.equal(authSrc.includes('onConflictDoUpdate'), false);
  });
});

describe('tenant orgFilter semantics', () => {
  it('IP unique is per-organization in schema', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const schema = fs.readFileSync(path.join(dir, '../../db/schema.js'), 'utf8');
    assert.match(schema, /uq_ip_addresses_org_address/);
  });
});
