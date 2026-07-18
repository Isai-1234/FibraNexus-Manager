/**
 * Fase 4 — contratos de alertas operativas y acciones remotas EdgeOS (sin DB).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Fase 4 org alerts contracts', () => {
  it('migration 006 declares org_alerts and enums', () => {
    const sql = read('migrations/006_org_alerts.sql');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS org_alerts/);
    assert.match(sql, /alert_severity/);
    assert.match(sql, /alert_status/);
    assert.match(sql, /dedupe_key/);
    assert.match(sql, /UNIQUE \(organization_id, dedupe_key\)/);
  });

  it('schema exports orgAlerts and severity enum', () => {
    const schema = read('src/db/schema.js');
    assert.match(schema, /export const alertSeverityEnum/);
    assert.match(schema, /export const orgAlerts/);
  });

  it('alerts API is mounted with ack/resolve/refresh', () => {
    assert.match(read('src/index.js'), /\/api\/alerts/);
    const routes = read('src/routes/alerts.js');
    assert.match(routes, /\/:id\/ack/);
    assert.match(routes, /\/:id\/resolve/);
    assert.match(routes, /\/refresh/);
    assert.match(routes, /\/summary/);
  });

  it('scheduler refreshes operational alerts', () => {
    assert.match(read('src/lib/scheduler.js'), /refreshAlertsRound/);
    assert.match(read('src/lib/orgAlerts.js'), /refreshOperationalAlerts/);
    assert.match(read('src/lib/orgAlerts.js'), /raisePaymentFailAlert/);
  });
});

describe('Fase 4 EdgeOS remote confirm + audit', () => {
  it('network and provision mutations require confirm', () => {
    const edgeos = read('src/routes/edgeos.js');
    assert.match(edgeos, /Confirma la acción remota enviando confirm=true/);
    assert.match(edgeos, /Confirma la eliminación remota con confirm=true/);
    assert.match(edgeos, /Confirma el aprovisionamiento remoto con confirm=true/);
    assert.match(edgeos, /Confirma el retiro remoto con confirm=true/);
  });

  it('appendPendingCmd receives audit on mutating paths', () => {
    const edgeos = read('src/routes/edgeos.js');
    assert.match(edgeos, /confirmed: true/);
    assert.ok((edgeos.match(/appendPendingCmd\([^)]+,\s*\{[\s\S]*?confirmed:\s*true/g) || []).length >= 3);
  });

  it('USE_JOB_QUEUE remains fatal without real Redis', () => {
    assert.match(read('src/index.js'), /USE_JOB_QUEUE=true pero la cola Redis es un stub/);
  });
});
