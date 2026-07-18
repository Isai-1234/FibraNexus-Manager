/**
 * Fase 5 — contratos portal, branding y vista técnico (sin DB).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mergeOrgSettings, DEFAULT_ORG_SETTINGS } from '../orgSettings.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Fase 5 branding settings', () => {
  it('defaults include brand colors and logo', () => {
    assert.ok(DEFAULT_ORG_SETTINGS.brandPrimaryColor);
    assert.equal(DEFAULT_ORG_SETTINGS.brandLogoUrl, '');
  });

  it('mergeOrgSettings sanitizes hex colors', () => {
    const m = mergeOrgSettings({ brandPrimaryColor: '#ABC', brandAccentColor: 'nope' });
    assert.equal(m.brandPrimaryColor, '#aabbcc');
    assert.equal(m.brandAccentColor, DEFAULT_ORG_SETTINGS.brandAccentColor);
  });

  it('settings whitelist accepts brand fields', () => {
    const src = read('src/routes/settings.js');
    assert.match(src, /brandLogoUrl/);
    assert.match(src, /brandPrimaryColor/);
    assert.match(src, /brandPortalTitle/);
  });
});

describe('Fase 5 portal contracts', () => {
  it('portal exposes checkout for clients', () => {
    const portal = read('src/routes/portal.js');
    assert.match(portal, /portalRouter\.post\('\/checkout'/);
    assert.match(portal, /branding/);
    assert.match(portal, /documents/);
    assert.match(portal, /requireRole\('client'\)/);
  });

  it('client portal UI has pay and documents tabs', () => {
    const ui = read('../client/src/pages/portal/ClientPortal.tsx');
    assert.match(ui, /\/portal\/checkout/);
    assert.match(ui, /documentos/);
    assert.match(ui, /Pagar/);
    assert.match(ui, /brandPrimaryColor|primaryColor|brand\.primaryColor/);
  });
});

describe('Fase 5 technician field contracts', () => {
  it('work-orders support mine filter', () => {
    assert.match(read('src/routes/workOrders.js'), /req\.query\.mine/);
  });

  it('field work orders UI exists', () => {
    const field = read('../client/src/pages/technician/FieldWorkOrders.tsx');
    assert.match(field, /Vista de campo/);
    assert.match(field, /attachments/);
    assert.match(field, /complete/);
  });
});
