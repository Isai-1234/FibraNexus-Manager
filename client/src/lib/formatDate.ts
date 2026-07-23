/** Formatea fechas DB/API para UI chilena */
export function formatDateCL(value: string | null | undefined): string {
  if (!value) return '—'
  const raw = String(value).split('T')[0]
  const [y, m, d] = raw.split('-').map(Number)
  if (!y || !m || !d) return String(value)
  const date = new Date(y, m - 1, d)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Período interno (2026-07-d1-p0 / 2026-07-pro) → etiqueta legible para ISP */
export function formatBillingPeriod(value: string | null | undefined): string {
  if (!value) return '—'
  const raw = String(value)
  const m = raw.match(/^(\d{4})-(\d{2})(?:-d(\d+))?(?:-p(\d+))?(-pro)?/)
  if (!m) return raw
  const year = Number(m[1])
  const month = Number(m[2])
  const day = m[3] ? Number(m[3]) : null
  const prorate = Boolean(m[5])
  const monthName = new Date(year, month - 1, 1).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })
  if (prorate) return `Prorrateo · ${monthName}`
  if (day) return `${monthName} (día ${day})`
  return monthName.charAt(0).toUpperCase() + monthName.slice(1)
}

export function todayISO(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}
