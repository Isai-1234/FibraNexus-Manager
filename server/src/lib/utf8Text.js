/**
 * UTF-8 helpers — WispHub / importaciones.
 *
 * Síntoma típico de doble-encoding: ñ (UTF-8 c3b1) leída como Latin-1
 * y re-codificada → hex c383c2b1 (texto "Ã±").
 *
 * Reparación: Buffer.from(str, 'latin1').toString('utf8') solo si el
 * string parece mojibake (marcadores Ã/Â) y el resultado es UTF-8 válido.
 */

/** Marcadores frecuentes de UTF-8 interpretado como Latin-1 (español + puntuación). */
const MOJIBAKE_HINT =
  /Ã[¡-¿À-ÿ]|Ã±|Ã¡|Ã©|Ã­|Ã³|Ãº|Ã\u0081|Ã\u0091|Â[¡-¿]|â€[™œ]|Ã¼|Ã¶|Ã¤/i;

/**
 * Decodifica bytes de respuesta HTTP siempre como UTF-8
 * (ignora charset incorrecto tipo iso-8859-1 en Content-Type).
 */
export function decodeUtf8Buffer(buf) {
  if (!buf) return '';
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString('utf8');
}

/**
 * ¿Parece texto UTF-8 doble-codificado (mojibake Latin-1)?
 */
export function looksLikeUtf8Mojibake(value) {
  if (value == null || typeof value !== 'string' || !value) return false;
  return MOJIBAKE_HINT.test(value);
}

/**
 * Repara un string con doble-encoding UTF-8→Latin-1→UTF-8.
 * Si no parece mojibake o la reparación produce U+FFFD, devuelve el original.
 */
export function repairUtf8Mojibake(value) {
  if (value == null || typeof value !== 'string' || value === '') return value;
  if (!looksLikeUtf8Mojibake(value)) return value;
  try {
    const repaired = Buffer.from(value, 'latin1').toString('utf8');
    if (!repaired || repaired === value) return value;
    if (repaired.includes('\uFFFD')) return value;
    return repaired;
  } catch {
    return value;
  }
}

/** Aplica repair a todos los strings de un objeto plano (1 nivel) o anidado shallow. */
export function repairUtf8Deep(value, depth = 0) {
  if (depth > 4) return value;
  if (typeof value === 'string') return repairUtf8Mojibake(value);
  if (Array.isArray(value)) return value.map((v) => repairUtf8Deep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = repairUtf8Deep(v, depth + 1);
    }
    return out;
  }
  return value;
}
