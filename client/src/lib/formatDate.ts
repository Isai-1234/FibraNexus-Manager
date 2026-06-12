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

export function todayISO(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}
