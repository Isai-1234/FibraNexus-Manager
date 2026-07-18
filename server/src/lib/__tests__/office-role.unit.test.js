/**
 * Fase 2 — contratos del rol administrativo (sin DB).
 * Ejecutar: node --test server/src/lib/__tests__/office-role.unit.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Fase 2 office role contracts', () => {
  it('migration and schema declare office', () => {
    assert.match(read('migrations/003_office_role.sql'), /ADD VALUE IF NOT EXISTS 'office'/);
    assert.match(read('src/db/schema.js'), /'office'/);
  });

  it('staff creation and limits count office staff', () => {
    assert.match(read('src/routes/staff.js'), /z\.enum\(\['admin', 'office', 'technician'\]\)/);
    assert.match(read('src/lib/orgLimits.js'), /\['admin', 'office', 'technician'\]/);
  });

  it('office can do commercial work but no network routes receive office permission', () => {
    const clients = read('src/routes/clients.js');
    const payments = read('src/routes/payments.js');
    const tickets = read('src/routes/tickets.js');
    const network = read('src/routes/network.js');
    const routers = read('src/routes/routers.js');
    assert.match(clients, /requireRole\('admin', 'office'\)/);
    assert.match(payments, /requireRole\('admin', 'office'\)/);
    assert.match(tickets, /requireRole\('admin', 'office', 'technician'\)/);
    assert.doesNotMatch(network, /'office'/);
    assert.doesNotMatch(routers, /'office'/);
  });
});
