/**
 * Validación y normalización de RUT chileno.
 * Acepta con/sin puntos y guión; retorna formato canónico 12345678-9.
 */
export function cleanRut(input) {
  if (input == null) return '';
  return String(input).trim().toUpperCase().replace(/\./g, '').replace(/\s/g, '');
}

export function normalizeRut(input) {
  const cleaned = cleanRut(input);
  if (!cleaned) return null;
  const match = cleaned.match(/^(\d{7,8})-?([\dK])$/i);
  if (!match) return null;
  return `${match[1]}-${match[2].toUpperCase()}`;
}

export function computeRutDv(body) {
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const mod = 11 - (sum % 11);
  if (mod === 11) return '0';
  if (mod === 10) return 'K';
  return String(mod);
}

export function isValidRut(input) {
  const normalized = normalizeRut(input);
  if (!normalized) return false;
  const [body, dv] = normalized.split('-');
  if (!/^\d{7,8}$/.test(body)) return false;
  return computeRutDv(body) === dv;
}

/** Valida si viene RUT; vacío/null es OK (opcional). */
export function assertOptionalRut(input) {
  if (input == null || String(input).trim() === '') return null;
  const normalized = normalizeRut(input);
  if (!normalized || !isValidRut(normalized)) {
    const err = new Error('RUT inválido. Usa formato 12345678-9');
    err.status = 400;
    err.code = 'INVALID_RUT';
    throw err;
  }
  return normalized;
}
