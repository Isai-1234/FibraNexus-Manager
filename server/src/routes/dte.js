/**
 * Rutas DTE / facturación electrónica por organización.
 * POST /api/orgs/:orgId/dte/test-connection
 * POST /api/orgs/:orgId/dte/emitir  (aplica decideDteEmission)
 */
import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { requireOrganizationId } from '../lib/tenant.js';
import { createOrgDteProvider } from '../lib/orgDte.js';
import { maybeEmitDteForPaidInvoice } from '../lib/dteEmitService.js';
import { parseBody, dteEmitirSchema, dteTestConnectionSchema } from '../lib/validators.js';
import { rateLimit } from '../lib/rateLimit.js';

export const dteRouter = Router({ mergeParams: true });

function assertOrgParamMatchesJwt(req, res) {
  const jwtOrgId = requireOrganizationId(req, res);
  if (!jwtOrgId) return null;
  const paramId = Number(req.params.orgId);
  if (!Number.isFinite(paramId) || paramId !== Number(jwtOrgId)) {
    res.status(403).json({ error: 'No tienes acceso a esta organización' });
    return null;
  }
  return jwtOrgId;
}

dteRouter.post(
  '/test-connection',
  requireRole('admin'),
  rateLimit({ name: 'dte_test', windowMs: 60_000, max: 10 }),
  async (req, res) => {
    try {
      const orgId = assertOrgParamMatchesJwt(req, res);
      if (!orgId) return;
      const parsed = parseBody(dteTestConnectionSchema, req.body || {});
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const provider = await createOrgDteProvider(orgId);
      const result = typeof provider.testConnection === 'function'
        ? await provider.testConnection()
        : { ok: true, provider: provider.name, message: 'Proveedor sin testConnection' };

      res.status(result.ok ? 200 : 400).json(result);
    } catch (error) {
      console.error('[dte] test-connection:', error);
      res.status(500).json({ error: error.message || 'Error al probar conexión DTE' });
    }
  },
);

dteRouter.post(
  '/emitir',
  requireRole('admin'),
  rateLimit({ name: 'dte_emitir', windowMs: 60_000, max: 20 }),
  async (req, res) => {
    try {
      const orgId = assertOrgParamMatchesJwt(req, res);
      if (!orgId) return;
      const parsed = parseBody(dteEmitirSchema, req.body || {});
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const data = parsed.data;
      const result = await maybeEmitDteForPaidInvoice({
        orgId,
        invoiceId: data.invoiceId,
        paymentMethod: data.paymentMethod || null,
        emitirOverride: data.emitirOverride,
        extras: {
          tipoDte: data.tipoDte,
          folio: data.folio,
          certificadoPfxBase64: data.certificadoPfxBase64,
          certificadoPassword: data.certificadoPassword,
          cafXml: data.cafXml,
          cafXmlBase64: data.cafXmlBase64,
          receptorRut: data.receptor?.rut,
          receptorNombre: data.receptor?.razonSocial || data.receptor?.nombre,
        },
      });

      const httpOk = result.ok !== false;
      res.status(httpOk ? 200 : 400).json(result);
    } catch (error) {
      console.error('[dte] emitir:', error);
      res.status(500).json({ error: error.message || 'Error al emitir DTE' });
    }
  },
);
