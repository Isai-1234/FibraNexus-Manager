/**
 * Rutas WispHub por organización.
 * POST /api/orgs/:orgId/wisphub/importar-clientes
 */
import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { requireOrganizationId } from '../lib/tenant.js';
import { importWisphubClients } from '../lib/wisphubImport.js';
import { parseBody, wisphubImportSchema } from '../lib/validators.js';
import { rateLimit } from '../lib/rateLimit.js';

export const wisphubRouter = Router({ mergeParams: true });

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

wisphubRouter.post(
  '/importar-clientes',
  requireRole('admin'),
  rateLimit({ name: 'wisphub_import', windowMs: 60_000, max: 2 }),
  async (req, res) => {
    // Importación paginada puede tardar varios minutos
    req.setTimeout?.(10 * 60 * 1000);
    res.setTimeout?.(10 * 60 * 1000);

    try {
      const orgId = assertOrgParamMatchesJwt(req, res);
      if (!orgId) return;
      const parsed = parseBody(wisphubImportSchema, req.body || {});
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const summary = await importWisphubClients(orgId);
      if (!summary.ok) {
        return res.status(400).json(summary);
      }
      res.json(summary);
    } catch (error) {
      console.error('[wisphub] importar-clientes:', error);
      res.status(500).json({
        ok: false,
        error: error.message || 'Error al importar clientes desde WispHub',
      });
    }
  },
);
