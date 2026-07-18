import { db } from '../db/index.js';
import { activityLog } from '../db/schema.js';

/**
 * Auditoría operativa. Nunca registrar contraseñas ni tokens completos.
 */
export async function writeAuditLog({
  organizationId = null,
  userId = null,
  action,
  entity,
  entityId = null,
  details = null,
  ipAddress = null,
  success = true,
}) {
  try {
    const safeDetails = details && typeof details === 'object'
      ? scrubDetails(details)
      : details;
    await db.insert(activityLog).values({
      organizationId,
      userId,
      action: String(action).slice(0, 255),
      entity: String(entity).slice(0, 100),
      entityId: entityId != null ? Number(entityId) : null,
      details: {
        ...(safeDetails && typeof safeDetails === 'object' ? safeDetails : { note: safeDetails }),
        success: Boolean(success),
      },
      ipAddress: ipAddress ? String(ipAddress).slice(0, 45) : null,
    });
  } catch (err) {
    console.error('[audit] write failed:', err.message);
  }
}

function scrubDetails(obj) {
  const banned = [
    'password', 'routerPass', 'agentToken', 'tunnelToken', 'snmpCommunity',
    'token', 'authorization', 'secret', 'jwt',
  ];
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (banned.some((b) => k.toLowerCase().includes(b.toLowerCase()))) {
      out[k] = '[redacted]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = scrubDetails(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}
