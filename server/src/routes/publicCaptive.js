import { Router } from 'express';
import { db } from '../db/index.js';
import { organizations, equipment } from '../db/schema.js';
import { eq, and, or, sql } from 'drizzle-orm';
import { mergeOrgSettings } from '../lib/orgSettings.js';
import { buildDefaultPortalUrl, getSuspendPortalUrl } from '../lib/subscriberSuspend.js';
import { config } from '../lib/config.js';

export const publicCaptiveRouter = Router();

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const real = String(req.headers['x-real-ip'] || '').trim();
  const raw = xf || real || req.ip || req.socket?.remoteAddress || '';
  return String(raw).replace(/^::ffff:/, '');
}

function normalizeIp(value) {
  return String(value || '').split('/')[0].trim().replace(/^::ffff:/, '');
}

async function findOrgByCaptiveSourceIp(ip) {
  const needle = normalizeIp(ip);
  if (!needle || needle === '127.0.0.1' || needle === '::1') return null;

  const rows = await db.select({
    organizationId: equipment.organizationId,
    ipAddress: equipment.ipAddress,
    credentials: equipment.credentials,
    type: equipment.type,
  })
    .from(equipment)
    .where(and(
      or(eq(equipment.type, 'router'), eq(equipment.type, 'olt')),
      sql`${equipment.organizationId} is not null`,
    ))
    .limit(200);

  for (const row of rows) {
    const creds = row.credentials || {};
    const candidates = [
      row.ipAddress,
      creds.host,
      creds.apiHost,
      creds.publicIp,
      creds.wanIp,
    ].map(normalizeIp).filter(Boolean);
    if (candidates.includes(needle)) {
      return row.organizationId;
    }
  }
  return null;
}

async function redirectCaptive(req, res) {
  try {
    const ip = clientIp(req);
    const orgId = await findOrgByCaptiveSourceIp(ip);
    const target = orgId ? await getSuspendPortalUrl(orgId) : buildDefaultPortalUrl();
    return res.redirect(302, target);
  } catch {
    return res.redirect(302, buildDefaultPortalUrl());
  }
}

/** Branding público para pantalla de mora del ISP */
publicCaptiveRouter.get('/mora/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    if (!slug) return res.status(400).json({ error: 'slug requerido' });

    const [org] = await db.select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      settings: organizations.settings,
    }).from(organizations).where(eq(organizations.slug, slug)).limit(1);

    if (!org) return res.status(404).json({ error: 'ISP no encontrado' });

    const settings = mergeOrgSettings(org.settings);
    const portalUrl = await getSuspendPortalUrl(org.id);
    const payUrl = `${(config.publicUrl || 'https://app.fibranexus.cl').replace(/\/$/, '')}/login`;

    res.json({
      orgName: org.name,
      slug: org.slug,
      logoUrl: settings.brandLogoUrl || '',
      primaryColor: settings.brandPrimaryColor,
      accentColor: settings.brandAccentColor,
      portalTitle: settings.brandPortalTitle || org.name,
      payUrl,
      portalUrl,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

publicCaptiveRouter.get('/captive', redirectCaptive);
publicCaptiveRouter.head('/captive', redirectCaptive);
publicCaptiveRouter.post('/captive', redirectCaptive);
