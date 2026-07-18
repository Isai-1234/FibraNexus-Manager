/**
 * Rate limiter in-memory (por IP + clave). Suficiente para un solo proceso Render.
 * En multi-instancia, sustituir por Redis más adelante.
 */
const buckets = new Map();

function keyOf(ip, name) {
  return `${name}:${ip || 'unknown'}`;
}

export function rateLimit({ name, windowMs = 60_000, max = 20 }) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
      || req.ip
      || req.socket?.remoteAddress
      || 'unknown';
    const key = keyOf(ip, name);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      const retry = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: 'Demasiados intentos. Espera un momento.' });
    }
    next();
  };
}

/** Limpieza ocasional para no crecer sin límite */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets.entries()) {
    if (now > v.resetAt) buckets.delete(k);
  }
}, 5 * 60_000).unref?.();
