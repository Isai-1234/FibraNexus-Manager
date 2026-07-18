/**
 * Fase 2 CRM — contratos de ciclo de vida y OT (sin DB).
 * Ejecutar: node --test server/src/lib/__tests__/crm-lifecycle.unit.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Fase 2 CRM lifecycle contracts', () => {
  it('migration defines client_lifecycle and work_orders', () => {
    const sql = read('migrations/004_crm_lifecycle.sql');
    assert.match(sql, /client_lifecycle/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS work_orders/);
  });

  it('schema exports lifecycle and workOrders', () => {
    const schema = read('src/db/schema.js');
    assert.match(schema, /clientLifecycleEnum/);
    assert.match(schema, /lifecycleStatus/);
    assert.match(schema, /export const workOrders/);
  });

  it('clients validate RUT and set lifecycle on soft-delete', () => {
    const clients = read('src/routes/clients.js');
    assert.match(clients, /assertOptionalRut/);
    assert.match(clients, /lifecycleStatus:\s*'cancelled'/);
  });

  it('work-orders API is mounted and audited', () => {
    assert.match(read('src/index.js'), /\/api\/work-orders/);
    const wo = read('src/routes/workOrders.js');
    assert.match(wo, /work_order\.create/);
    assert.match(wo, /work_order\.complete/);
    assert.match(wo, /requireRole\('admin', 'office', 'technician'\)/);
  });
});
