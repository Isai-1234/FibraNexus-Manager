/**
 * Helper DTE por org — patrón espejo de orgPayment.js (sin tocarlo).
 * Secretos cifrados en organizations.settings con CREDENTIALS_ENCRYPTION_KEY.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { mergeOrgSettings } from './orgSettings.js';
import { decryptSecret } from './secrets.js';
import { createDteProvider, getDteProviderStatusFromSettings } from './dteProvider.js';

const DTE_SECRET_KEYS = ['dteApiKey'];

export async function loadOrgDteSettings(organizationId) {
  const [org] = await db.select({
    id: organizations.id,
    name: organizations.name,
    settings: organizations.settings,
  }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) return null;

  const merged = mergeOrgSettings(org.settings);
  const decrypted = { ...merged };
  for (const k of DTE_SECRET_KEYS) {
    if (decrypted[k]) {
      try {
        decrypted[k] = decryptSecret(decrypted[k]);
      } catch (err) {
        console.error(`[dte] No se pudo descifrar ${k} org=${organizationId}:`, err.message);
        decrypted[k] = '';
      }
    }
  }
  return { org, settings: decrypted };
}

export async function createOrgDteProvider(organizationId) {
  const loaded = await loadOrgDteSettings(organizationId);
  if (!loaded) return createDteProvider('stub');
  return createDteProvider(loaded.settings);
}

export function publicDteProviderStatus(settingsRaw) {
  const merged = mergeOrgSettings(settingsRaw);
  return getDteProviderStatusFromSettings({
    ...merged,
    _hasDteApiKey: Boolean(merged.dteApiKey),
  });
}

/** Quita secretos DTE del objeto settings expuesto a la API. */
export function sanitizeDteSecretsFromSettings(settings) {
  const s = mergeOrgSettings(settings);
  const { dteApiKey, ...rest } = s;
  return {
    ...rest,
    hasDteApiKey: Boolean(dteApiKey),
  };
}
