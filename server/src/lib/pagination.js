/**
 * Paginación estándar. Sin ?page= la API sigue devolviendo array (compat UI).
 */
export function parsePaginationQuery(query, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const paginated = query.page !== undefined || query.limit !== undefined;
  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.min(
    maxLimit,
    Math.max(1, parseInt(String(query.limit || defaultLimit), 10) || defaultLimit),
  );
  return { page, limit, offset: (page - 1) * limit, paginated };
}

export function paginationMeta(total, page, limit) {
  const n = Number(total) || 0;
  return {
    page,
    limit,
    total: n,
    pages: Math.max(1, Math.ceil(n / limit)),
  };
}
