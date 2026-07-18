import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organizations, clients, clientServices, plans, invoices } from '../db/schema.js';

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
  if (!org) return false;
  if (!org.isActive) return false;
  const status = org.subscriptionStatus || (org.plan === 'trial' ? 'trial' : 'active');
  if (status === 'suspended' || status === 'cancelled') return false;
  if (status === 'trial' || org.plan === 'trial') {
    if (org.trialEndsAt && new Date(org.trialEndsAt) < new Date()) return false;
  }
  if (status === 'past_due' && org.subscriptionEndsAt && new Date(org.subscriptionEndsAt) < new Date()) {
    return false;
  }
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

/** @deprecated Eliminada auto-promoción client→admin (SEC-10). Se mantiene stub por compatibilidad de imports. */
export async function ensureOrgStaffAccess(user) {
  return user;
}

export async function getClientInOrg(clientId, orgId) {
  const rows = await db.select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), orgFilter(clients, orgId)))
    .limit(1);
  return rows[0] || null;
}

export async function getPlanInOrg(planId, orgId) {
  const rows = await db.select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.id, planId), orgFilter(plans, orgId)))
    .limit(1);
  return rows[0] || null;
}

export async function getServiceInOrg(serviceId, orgId) {
  const rows = await db.select({ id: clientServices.id })
    .from(clientServices)
    .innerJoin(clients, eq(clientServices.clientId, clients.id))
    .where(and(eq(clientServices.id, serviceId), orgFilter(clients, orgId)))
    .limit(1);
  return rows[0] || null;
}

export async function getInvoiceInOrg(invoiceId, orgId) {
  const rows = await db.select({
    id: invoices.id,
    clientId: invoices.clientId,
    total: invoices.total,
    status: invoices.status,
  })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), orgFilter(invoices, orgId)))
    .limit(1);
  return rows[0] || null;
}

export async function requireActiveOrg(req, res, next) {
  const orgId = requireOrganizationId(req, res);
  if (!orgId) return;
  try {
    const org = await loadOrganization(orgId);
    if (!org) return res.status(403).json({ error: 'Organización no encontrada' });
    if (!isOrganizationActive(org)) {
      const suspended = org.subscriptionStatus === 'suspended' || !org.isActive;
      return res.status(402).json({
        error: suspended
          ? 'Cuenta suspendida. Contacta a FibraNexus para reactivar.'
          : 'Trial expirado o suscripción inactiva. Actualiza tu plan para continuar.',
        code: suspended ? 'ORG_SUSPENDED' : 'TRIAL_EXPIRED',
        organization: {
          plan: org.plan,
          subscriptionStatus: org.subscriptionStatus,
          trialEndsAt: org.trialEndsAt,
          suspendedReason: org.suspendedReason || null,
        },
      });
    }
    req.organization = org;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Error verificando organización' });
  }
}
