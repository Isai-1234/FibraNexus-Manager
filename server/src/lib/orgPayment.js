/**
 * Helper: carga settings de org con secretos de pasarela descifrados.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { mergeOrgSettings } from './orgSettings.js';
import { decryptSecret } from './secrets.js';
import { createPaymentGateway, getPaymentGatewayStatusFromSettings } from './paymentGateway.js';

const SECRET_KEYS = ['flowApiKey', 'flowSecretKey', 'webpayCommerceCode', 'webpayApiKey'];

export async function loadOrgPaymentSettings(organizationId) {
  const [org] = await db.select({
    id: organizations.id,
    name: organizations.name,
    settings: organizations.settings,
  }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) return null;
  const merged = mergeOrgSettings(org.settings);
  const decrypted = { ...merged };
  for (const k of SECRET_KEYS) {
    if (decrypted[k]) {
      try {
        decrypted[k] = decryptSecret(decrypted[k]);
      } catch (err) {
        console.error(`[payment] No se pudo descifrar ${k} org=${organizationId}:`, err.message);
        decrypted[k] = '';
      }
    }
  }
  return { org, settings: decrypted };
}

export async function createOrgPaymentGateway(organizationId) {
  const loaded = await loadOrgPaymentSettings(organizationId);
  if (!loaded) return createPaymentGateway('stub');
  return createPaymentGateway(loaded.settings);
}

export function publicPaymentGatewayStatus(settingsRaw) {
  const merged = mergeOrgSettings(settingsRaw);
  const forStatus = {
    paymentProvider: merged.paymentProvider,
    flowApiKey: merged.flowApiKey,
    flowSecretKey: merged.flowSecretKey,
    webpayCommerceCode: merged.webpayCommerceCode,
    webpayApiKey: merged.webpayApiKey,
    _hasFlowApiKey: Boolean(merged.flowApiKey),
    _hasFlowSecretKey: Boolean(merged.flowSecretKey),
  };
  // resolve needs actual key presence — use encrypted strings as truthy
  return getPaymentGatewayStatusFromSettings({
    ...forStatus,
    flowApiKey: merged.flowApiKey || '',
    flowSecretKey: merged.flowSecretKey || '',
  });
}

/** Quita secretos del objeto settings expuesto a la API. */
export function sanitizeSettingsForApi(settings) {
  const s = mergeOrgSettings(settings);
  const {
    flowApiKey,
    flowSecretKey,
    webpayCommerceCode,
    webpayApiKey,
    mailApiKey,
    mailSmtpPassword,
    ...safe
  } = s;
  return {
    ...safe,
    hasFlowApiKey: Boolean(flowApiKey),
    hasFlowSecretKey: Boolean(flowSecretKey),
    hasWebpayCredentials: Boolean(webpayCommerceCode && webpayApiKey),
    hasMailApiKey: Boolean(mailApiKey),
    hasMailSmtpPassword: Boolean(mailSmtpPassword),
  };
}
