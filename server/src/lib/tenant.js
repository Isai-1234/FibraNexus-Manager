import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';

export function getOrganizationId(req) {
  const id = req.user?.organizationId;
  if (!id) return null;
  return id;
}

export function requireOrganizationId(req, res) {
  const id = getOrganizationId(req);
  if (!id) {
    res.status(403).json({ error: 'Usuario sin organización asignada' });
    return null;
  }
  return id;
}

export function orgFilter(table, orgId) {
  return eq(table.organizationId, orgId);
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'isp';
}

export async function loadOrganization(orgId) {
  return db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
}

export function trialDaysLeft(org) {
  if (!org?.trialEndsAt) return null;
  const ms = new Date(org.trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function isOrganizationActive(org) {
  if (!org?.isActive) return false;
  if (org.plan === 'trial' && org.trialEndsAt && new Date(org.trialEndsAt) < new Date()) return false;
  return true;
}

export function inferConnectionMethod(router) {
  const creds = router.credentials || {};
  const saved = creds.lastRouterInfo;
  if (creds.tunnelToken || creds.tunnelHostname || (router.ipAddress && String(router.ipAddress).includes('fibranexus.cl'))) {
    return 'cloudflare_tunnel';
  }
  if (creds.connectionMethod === 'agent' && String(creds.routerType || '').startsWith('mikrotik') && saved?.version) {
    return 'cloudflare_tunnel';
  }
  if (creds.connectionMethod) return creds.connectionMethod;
  return 'direct';
}

export async function requireActiveOrg(req, res, next) {
  const orgId = requireOrganizationId(req, res);
  if (!orgId) return;
  try {
    const org = await loadOrganization(orgId);
    if (!org) return res.status(403).json({ error: 'Organización no encontrada' });
    if (!isOrganizationActive(org)) {
      return res.status(402).json({
        error: 'Trial expirado. Actualiza tu plan para continuar.',
        code: 'TRIAL_EXPIRED',
        organization: { plan: org.plan, trialEndsAt: org.trialEndsAt },
      });
    }
    req.organization = org;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Error verificando organización' });
  }
}
