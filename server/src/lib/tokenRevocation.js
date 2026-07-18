/**
 * Denylist simple de JWT (logout / rotación). En memoria por proceso.
 * Suficiente para un solo dyno; multi-instancia requerirá Redis.
 */
const revoked = new Map(); // jti|tokenHash -> expMs

export function revokeToken(token, expUnixSeconds) {
  if (!token) return;
  const expMs = expUnixSeconds ? expUnixSeconds * 1000 : Date.now() + 8 * 3600_000;
  revoked.set(token, expMs);
}

export function isTokenRevoked(token) {
  if (!token) return false;
  const exp = revoked.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    revoked.delete(token);
    return false;
  }
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of revoked.entries()) {
    if (now > exp) revoked.delete(k);
  }
}, 10 * 60_000).unref?.();
