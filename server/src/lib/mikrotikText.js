/**
 * RouterOS / Winbox muestran mal UTF-8 (ej. "InalÃ¡mbrico", "â€"").
 * Normalizamos a ASCII seguro para comentarios y nombres en MikroTik.
 */
export function sanitizeMikrotikText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
