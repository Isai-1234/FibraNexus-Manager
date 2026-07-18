import { Router } from 'express';
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { requireOrganizationId } from '../lib/tenant.js';
import { mergeOrgSettings, DEFAULT_ORG_SETTINGS } from '../lib/orgSettings.js';
import { runBillingJobsForOrg } from '../lib/billingScheduler.js';
import { getPaymentGatewayStatus } from '../lib/paymentGateway.js';

export const settingsRouter = Router();

settingsRouter.get('/billing', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const [org] = await db.select({ id: organizations.id, name: organizations.name, settings: organizations.settings })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
    res.json({
      organization: org.name,
      settings: mergeOrgSettings(org.settings),
      defaults: DEFAULT_ORG_SETTINGS,
      paymentGateway: getPaymentGatewayStatus(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

settingsRouter.patch('/billing', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

    const current = mergeOrgSettings(org.settings);
    const allowed = [
      'billingAutoEnabled', 'billingHour', 'graceDaysBeforeSuspend',
      'autoSuspendEnabled', 'stopBillingWhenSuspended', 'autoMarkOverdue',
      'autoReactivateOnPayment', 'debtNoticesEnabled', 'suspendPortalUrl',
      'brandLogoUrl', 'brandPrimaryColor', 'brandAccentColor', 'brandPortalTitle',
    ];
    const patch = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    const settings = mergeOrgSettings({ ...current, ...patch });

    const [updated] = await db.update(organizations)
      .set({ settings, updatedAt: new Date() })
      .where(eq(organizations.id, orgId))
      .returning();

    res.json({ settings: mergeOrgSettings(updated.settings) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

settingsRouter.post('/billing/run-jobs', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const result = await runBillingJobsForOrg(orgId);
    res.json({ message: 'Jobs ejecutados', result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
