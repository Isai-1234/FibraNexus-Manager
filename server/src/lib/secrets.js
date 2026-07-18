/**
 * Cifrado en reposo para secretos de equipos (AES-256-GCM).
 * Formato: enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
 *
 * CREDENTIALS_ENCRYPTION_KEY: 32 bytes en hex (64 chars) o base64.
 * Sin clave: se puede leer plaintext legacy; en producción (NODE_ENV=production)
 * se exige la clave al escribir secretos nuevos.
 */
import crypto from 'crypto';

const PREFIX = 'enc:v1:';
const SECRET_CRED_KEYS = [
  'routerPass',
  'tunnelToken',
  // agentToken se guarda en claro para lookup del heartbeat; NUNCA se expone en GET
];

export function getEncryptionKey() {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  try {
    const buf = Buffer.from(s, 'base64');
    if (buf.length === 32) return buf;
  } catch {
    /* ignore */
  }
  throw new Error('CREDENTIALS_ENCRYPTION_KEY inválida: use 32 bytes hex (64 chars) o base64');
}

export function requireEncryptionKeyForWrite() {
  const key = getEncryptionKey();
  if (!key && process.env.NODE_ENV === 'production') {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY es obligatoria en producción');
  }
  return key;
}

export function isEncryptedValue(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptSecret(plaintext) {
  if (plaintext == null || plaintext === '') return plaintext;
  if (isEncryptedValue(plaintext)) return plaintext;
  const key = requireEncryptionKeyForWrite();
  if (!key) return String(plaintext); // dev sin clave: plaintext (migración pendiente)
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(value) {
  if (value == null || value === '') return value;
  if (!isEncryptedValue(value)) return value;
  const key = getEncryptionKey();
  if (!key) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY requerida para descifrar secretos');
  }
  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Formato de secreto cifrado inválido');
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Cifra campos sensibles dentro de credentials jsonb + snmpCommunity suelto */
export function encryptCredentialsObject(creds) {
  if (!creds || typeof creds !== 'object') return creds;
  const out = { ...creds };
  for (const k of SECRET_CRED_KEYS) {
    if (out[k] != null && out[k] !== '') {
      out[k] = encryptSecret(out[k]);
    }
  }
  return out;
}

export function decryptCredentialsObject(creds) {
  if (!creds || typeof creds !== 'object') return creds;
  const out = { ...creds };
  for (const k of SECRET_CRED_KEYS) {
    if (out[k] != null && out[k] !== '') {
      try {
        out[k] = decryptSecret(out[k]);
      } catch (err) {
        console.error('[secrets] No se pudo descifrar campo', k, err.message);
        throw err;
      }
    }
  }
  return out;
}

/**
 * Respuesta API segura: nunca incluye secretos en claro ni cifrados.
 */
export function sanitizeCredentialsForApi(creds) {
  if (!creds || typeof creds !== 'object') {
    return {
      hasRouterPass: false,
      hasAgentToken: false,
      hasTunnelToken: false,
      hasSnmpInCredentials: false,
    };
  }
  const {
    routerPass: _rp,
    agentToken: _at,
    tunnelToken: _tt,
    snmpCommunity: _sc,
    pendingCmds,
    cmdHistory,
    heartbeatArp,
    heartbeatDhcp,
    ...safe
  } = creds;

  return {
    ...safe,
    hasRouterPass: !!(creds.routerUser && creds.routerPass),
    hasAgentToken: !!creds.agentToken,
    hasTunnelToken: !!creds.tunnelToken,
    hasSnmpInCredentials: !!creds.snmpCommunity,
    agentTokenRotatedAt: creds.agentTokenRotatedAt || null,
    pendingCmdCount: Array.isArray(pendingCmds) ? pendingCmds.length : 0,
    // No exponer historial de comandos con posibles datos sensibles
  };
}

export function sanitizeEquipmentRow(row) {
  if (!row) return row;
  const { snmpCommunity, credentials, ...rest } = row;
  return {
    ...rest,
    hasSnmpCommunity: !!(snmpCommunity && String(snmpCommunity).length > 0),
    snmpCommunitySet: !!(snmpCommunity && String(snmpCommunity).length > 0),
    credentials: sanitizeCredentialsForApi(credentials),
  };
}

export function redactToken(token) {
  if (!token || typeof token !== 'string') return '[empty]';
  if (token.length <= 8) return '****';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export { SECRET_CRED_KEYS };
