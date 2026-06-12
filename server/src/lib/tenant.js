import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organizations, users, clients, clientServices, plans, invoices } from '../db/schema.js';

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

export async function ensureOrgStaffAccess(user) {
  if (!user?.organizationId || user.role !== 'client' || user.role === 'superadmin') return user;

  const abonado = await db.query.clients.findFirst({ where: eq(clients.userId, user.id) });
  if (abonado) return user;

  const staff = await db.query.users.findMany({
    where: and(
      eq(users.organizationId, user.organizationId),
      inArray(users.role, ['admin', 'technician']),
      eq(users.isActive, true),
    ),
  });

  const hasActiveStaff = staff.some((s) => s.lastLogin != null);
  if (hasActiveStaff) return user;

  const [updated] = await db.update(users)
    .set({ role: 'admin', updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();
  return updated || user;
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
