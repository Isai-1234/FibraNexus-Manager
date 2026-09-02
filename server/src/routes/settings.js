import { Router } from 'express';
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { requireOrganizationId } from '../lib/tenant.js';
import { mergeOrgSettings, DEFAULT_ORG_SETTINGS } from '../lib/orgSettings.js';
import { runBillingJobsForOrg } from '../lib/billingScheduler.js';
import { encryptSecret } from '../lib/secrets.js';
import {
  sanitizeSettingsForApi,
  publicPaymentGatewayStatus,
} from '../lib/orgPayment.js';
import {
  sanitizeDteSecretsFromSettings,
  publicDteProviderStatus,
} from '../lib/orgDte.js';
import {
  sanitizeWisphubSecretsFromSettings,
  publicWisphubStatus,
} from '../lib/orgWisphub.js';

export const settingsRouter = Router();

function sanitizeBillingSettingsForApi(merged) {
  return sanitizeWisphubSecretsFromSettings(
    sanitizeDteSecretsFromSettings(sanitizeSettingsForApi(merged)),
  );
}

settingsRouter.get('/billing', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const [org] = await db.select({ id: organizations.id, name: organizations.name, settings: organizations.settings })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
    const merged = mergeOrgSettings(org.settings);
    res.json({
      organizationId: org.id,
      organization: org.name,
      settings: sanitizeBillingSettingsForApi(merged),
      defaults: {
        ...DEFAULT_ORG_SETTINGS,
        flowApiKey: undefined,
        flowSecretKey: undefined,
        webpayCommerceCode: undefined,
        webpayApiKey: undefined,
        dteApiKey: undefined,
        wisphubApiKey: undefined,
      },
      paymentGateway: publicPaymentGatewayStatus(merged),
      dteProvider: publicDteProviderStatus(merged),
      wisphub: publicWisphubStatus(merged),
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
      'paymentProvider', 'flowApiUrl', 'webpayEnv',
      'dteProvider', 'dteApiUrl', 'dteRutEmisor', 'dteRazonSocial', 'dteAmbiente',
      'flowDelegacionBoletaActiva',
      'wisphubBaseUrl',
      'mailFromName', 'mailFromEmail', 'mailReplyTo',
    ];
    const patch = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }

    // Secretos: solo actualizar si el admin envió un valor nuevo no vacío.
    // clearFlowCredentials: true borra keys de Flow.
    if (req.body.clearFlowCredentials === true) {
      patch.flowApiKey = '';
      patch.flowSecretKey = '';
      if (patch.paymentProvider === undefined) patch.paymentProvider = 'stub';
    } else {
      if (typeof req.body.flowApiKey === 'string' && req.body.flowApiKey.trim()) {
        patch.flowApiKey = encryptSecret(req.body.flowApiKey.trim());
      }
      if (typeof req.body.flowSecretKey === 'string' && req.body.flowSecretKey.trim()) {
        patch.flowSecretKey = encryptSecret(req.body.flowSecretKey.trim());
      }
    }
    if (req.body.clearWebpayCredentials === true) {
      patch.webpayCommerceCode = '';
      patch.webpayApiKey = '';
    } else {
      if (typeof req.body.webpayCommerceCode === 'string' && req.body.webpayCommerceCode.trim()) {
        patch.webpayCommerceCode = encryptSecret(req.body.webpayCommerceCode.trim());
      }
      if (typeof req.body.webpayApiKey === 'string' && req.body.webpayApiKey.trim()) {
        patch.webpayApiKey = encryptSecret(req.body.webpayApiKey.trim());
      }
    }
    // clearDteCredentials: true borra API key DTE.
    if (req.body.clearDteCredentials === true) {
      patch.dteApiKey = '';
      if (patch.dteProvider === undefined) patch.dteProvider = 'stub';
    } else if (typeof req.body.dteApiKey === 'string' && req.body.dteApiKey.trim()) {
      patch.dteApiKey = encryptSecret(req.body.dteApiKey.trim());
    }
    // clearWisphubCredentials: true borra API key WispHub.
    if (req.body.clearWisphubCredentials === true) {
      patch.wisphubApiKey = '';
    } else if (typeof req.body.wisphubApiKey === 'string' && req.body.wisphubApiKey.trim()) {
      patch.wisphubApiKey = encryptSecret(req.body.wisphubApiKey.trim());
    }
    // clearMailCredentials: true borra la API key de correo del ISP.
    if (req.body.clearMailCredentials === true) {
      patch.mailApiKey = '';
    } else if (typeof req.body.mailApiKey === 'string' && req.body.mailApiKey.trim()) {
      patch.mailApiKey = encryptSecret(req.body.mailApiKey.trim());
    }

    const settings = mergeOrgSettings({ ...current, ...patch });

    const [updated] = await db.update(organizations)
      .set({ settings, updatedAt: new Date() })
      .where(eq(organizations.id, orgId))
      .returning();

    const merged = mergeOrgSettings(updated.settings);
    res.json({
      settings: sanitizeBillingSettingsForApi(merged),
      paymentGateway: publicPaymentGatewayStatus(merged),
      dteProvider: publicDteProviderStatus(merged),
      wisphub: publicWisphubStatus(merged),
    });
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
