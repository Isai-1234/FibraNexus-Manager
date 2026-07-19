/**
 * Helper WispHub por org — mismo patrón de secretos que orgDte (sin tocar orgPayment).
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { mergeOrgSettings } from './orgSettings.js';
import { decryptSecret } from './secrets.js';

export async function loadOrgWisphubSettings(organizationId) {
  const [org] = await db.select({
    id: organizations.id,
    name: organizations.name,
    settings: organizations.settings,
  }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) return null;

  const merged = mergeOrgSettings(org.settings);
  let apiKey = merged.wisphubApiKey || '';
  if (apiKey) {
    try {
      apiKey = decryptSecret(apiKey);
    } catch (err) {
      console.error(`[wisphub] No se pudo descifrar api key org=${organizationId}:`, err.message);
      apiKey = '';
    }
  }
  return {
    org,
    settings: {
      ...merged,
      wisphubApiKey: apiKey,
      wisphubBaseUrl: merged.wisphubBaseUrl || '',
    },
  };
}

/** Quita secreto WispHub del objeto settings expuesto a la API. */
export function sanitizeWisphubSecretsFromSettings(settings) {
  const s = mergeOrgSettings(settings);
  const { wisphubApiKey, ...rest } = s;
  return {
    ...rest,
    hasWisphubApiKey: Boolean(wisphubApiKey),
  };
}

export function publicWisphubStatus(settingsRaw) {
  const merged = mergeOrgSettings(settingsRaw);
  return {
    configured: Boolean(merged.wisphubApiKey && merged.wisphubBaseUrl),
    hasWisphubApiKey: Boolean(merged.wisphubApiKey),
    wisphubBaseUrl: merged.wisphubBaseUrl || '',
  };
}
