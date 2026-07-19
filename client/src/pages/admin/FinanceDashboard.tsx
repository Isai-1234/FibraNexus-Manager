import { useState, useEffect, useMemo } from 'react'
import {
  TrendingUp, TrendingDown, Download, Plus, X, Trash2, Pencil, Loader2,
} from 'lucide-react'
import axios from 'axios'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import ThemeToggle from '../../components/ThemeToggle'

type MoneyCount = { count: number; total: number }
type PeriodBucket = {
  payments: MoneyCount
  paidInvoices: MoneyCount
  unpaidInvoices: MoneyCount
  overdueInvoices: MoneyCount
  projectedFromActiveServices?: boolean
}

type FinanceSummary = {
  period: string
  current: PeriodBucket
  previous: PeriodBucket
  next: PeriodBucket
  months: {
    previous: PeriodBucket & { month: string; label: string }
    current: PeriodBucket & { month: string; label: string }
    next: PeriodBucket & { month: string; label: string }
  }
  chartInvoicing: Array<{ month: string; paid: number; unpaid: number; onTime: number; overdue: number }>
  chartPayments: Array<{ month: string; cash: number; transfer: number; card: number; flow: number }>
}

type Expense = {
  id: number
  date: string
  amount: string | number
  category: string
  description?: string | null
  provider?: string | null
  invoiceNumber?: string | null
}

const CATEGORY_LABELS: Record<string, string> = {
  equipment: 'Equipos',
  services: 'Servicios',
  rent: 'Arriendo',
  salary: 'Sueldos',
  taxes: 'Impuestos',
  other: 'Otros',
}

const COLORS = {
  paid: '#22c55e',
  unpaid: '#f59e0b',
  overdue: '#ef4444',
  onTime: '#38bdf8',
  cash: '#8b5cf6',
  transfer: '#06b6d4',
  card: '#f59e0b',
  flow: '#22c55e',
}

function apiClient(API: string) {
  return axios.create({
    baseURL: API,
    headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
  })
}

function formatCLP(n: number) {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(Math.round(n || 0))
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

function currentMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function filterChartByPeriod<T extends { month: string }>(rows: T[], period: string): T[] {
  if (!rows?.length) return []
  if (period === 'year') return rows
  if (period === 'quarter') return rows.slice(-3)
  return rows.slice(-1)
}

function MetricCard({
  title, total, count, prevTotal, accent,
}: {
  title: string
  total: number
  count: number
  prevTotal: number
  accent: string
}) {
  const pct = pctChange(total, prevTotal)
  const up = pct != null && pct >= 0
  return (
    <div className="rounded-xl border border-line bg-surface-card/80 p-4 shadow-lg">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{title}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums" style={{ color: accent }}>{formatCLP(total)}</p>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className="text-ink-muted">{count} registro{count === 1 ? '' : 's'}</span>
        {pct == null ? (
          <span className="text-ink-muted">vs anterior: —</span>
        ) : (
          <span className={`inline-flex items-center gap-0.5 font-medium ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
            {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            {up ? '+' : ''}{pct}%
          </span>
        )}
      </div>
    </div>
  )
}

function MonthColumn({
  title, data, highlight,
}: {
  title: string
  data: PeriodBucket & { label?: string }
  highlight?: boolean
}) {
  const rows = [
    { label: 'Pagos recibidos', v: data.payments },
    { label: 'Facturas pagadas', v: data.paidInvoices },
    { label: 'Pendientes', v: data.unpaidInvoices },
    { label: 'Vencidas', v: data.overdueInvoices },
  ]
  return (
    <div className={`rounded-xl border p-4 ${highlight ? 'border-sky-500/50 bg-surface-card' : 'border-line bg-surface-card/60'}`}>
      <p className="text-sm font-semibold text-ink capitalize">{title}</p>
      {data.label && <p className="text-xs text-ink-muted mb-3 capitalize">{data.label}</p>}
      {!data.label && <div className="mb-3" />}
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-2 text-sm">
            <div>
              <p className="text-ink-soft">{r.label}</p>
              <p className="text-[11px] text-ink-muted">{r.v.count} ítems</p>
            </div>
            <p className="font-mono text-ink tabular-nums">{formatCLP(r.v.total)}</p>
          </div>
        ))}
      </div>
      {data.projectedFromActiveServices && (
        <p className="mt-3 text-[11px] text-sky-400/90">Proyección por servicios activos</p>
      )}
    </div>
  )
}

const emptyExpenseForm = {
  date: new Date().toISOString().slice(0, 10),
  amount: '',
  category: 'other',
  description: '',
  provider: '',
  invoiceNumber: '',
}

export default function FinanceDashboard({ API }: { API: string }) {
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year'>('month')
  const [chartPeriod, setChartPeriod] = useState<'month' | 'quarter' | 'year'>('year')
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [expenseMonth, setExpenseMonth] = useState(currentMonthStr())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [form, setForm] = useState(emptyExpenseForm)
  const [saving, setSaving] = useState(false)

  async function loadSummary() {
    const res = await apiClient(API).get('/finance/summary', { params: { period } })
    setSummary(res.data)
  }

  async function loadExpenses() {
    const res = await apiClient(API).get('/finance/expenses', { params: { month: expenseMonth } })
    setExpenses(Array.isArray(res.data) ? res.data : [])
  }

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      await Promise.all([loadSummary(), loadExpenses()])
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Error al cargar finanzas')
    }
    setLoading(false)
  }

  useEffect(() => { refresh() }, [period, expenseMonth])

  const chartInv = useMemo(
    () => filterChartByPeriod(summary?.chartInvoicing || [], chartPeriod),
    [summary, chartPeriod],
  )
  const chartPay = useMemo(
    () => filterChartByPeriod(summary?.chartPayments || [], chartPeriod),
    [summary, chartPeriod],
  )

  function openCreate() {
    setEditing(null)
    setForm({ ...emptyExpenseForm, date: `${expenseMonth}-01` })
    setShowModal(true)
  }

  function openEdit(exp: Expense) {
    setEditing(exp)
    setForm({
      date: String(exp.date).slice(0, 10),
      amount: String(exp.amount),
      category: exp.category || 'other',
      description: exp.description || '',
      provider: exp.provider || '',
      invoiceNumber: exp.invoiceNumber || '',
    })
    setShowModal(true)
  }

  async function saveExpense(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        date: form.date,
        amount: Number(form.amount),
        category: form.category,
        description: form.description || null,
        provider: form.provider || null,
        invoiceNumber: form.invoiceNumber || null,
      }
      if (editing) {
        await apiClient(API).put(`/finance/expenses/${editing.id}`, body)
      } else {
        await apiClient(API).post('/finance/expenses', body)
      }
      setShowModal(false)
      await loadExpenses()
    } catch (err: any) {
      alert(err.response?.data?.error || err.message)
    }
    setSaving(false)
  }

  async function deleteExpense(id: number) {
    if (!confirm('¿Eliminar este egreso?')) return
    try {
      await apiClient(API).delete(`/finance/expenses/${id}`)
      await loadExpenses()
    } catch (err: any) {
      alert(err.response?.data?.error || err.message)
    }
  }

  async function exportCsv() {
    try {
      const res = await apiClient(API).get('/finance/export.csv', {
        params: { period },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `finanzas-${period}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || 'Error al exportar')
    }
  }

  const cur = summary?.current
  const prev = summary?.previous

  return (
    <div className="flex-1 overflow-auto bg-surface text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur px-4 sm:px-8 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-ink">Finanzas</h1>
              <p className="text-xs text-ink-muted">Ingresos, facturación y egresos del ISP</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ThemeToggle />
            <div className="inline-flex rounded-lg border border-line bg-surface-card p-0.5">
              {([
                ['month', 'Mes'],
                ['quarter', 'Trimestre'],
                ['year', 'Año'],
              ] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPeriod(v)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                    period === v ? 'bg-sky-600 text-white' : 'text-ink-muted hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-line bg-surface-card text-sm hover:bg-surface-raised"
            >
              <Download className="h-4 w-4" /> Exportar CSV
            </button>
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-8 space-y-6 max-w-7xl mx-auto">
        {error && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
        )}

        {loading && !summary ? (
          <div className="flex items-center justify-center py-24 text-ink-muted gap-2">
            <Loader2 className="h-5 w-5 animate-spin" /> Cargando…
          </div>
        ) : summary && cur && prev ? (
          <>
            {/* Fila 1 — KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <MetricCard
                title="Pagos recibidos"
                total={cur.payments.total}
                count={cur.payments.count}
                prevTotal={prev.payments.total}
                accent={COLORS.flow}
              />
              <MetricCard
                title="Facturas pagadas"
                total={cur.paidInvoices.total}
                count={cur.paidInvoices.count}
                prevTotal={prev.paidInvoices.total}
                accent={COLORS.paid}
              />
              <MetricCard
                title="Facturas pendientes"
                total={cur.unpaidInvoices.total}
                count={cur.unpaidInvoices.count}
                prevTotal={prev.unpaidInvoices.total}
                accent={COLORS.unpaid}
              />
              <MetricCard
                title="Facturas vencidas"
                total={cur.overdueInvoices.total}
                count={cur.overdueInvoices.count}
                prevTotal={prev.overdueInvoices.total}
                accent={COLORS.overdue}
              />
            </div>

            {/* Fila 2 — meses */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <MonthColumn title="Mes anterior" data={summary.months.previous} />
              <MonthColumn title="Mes actual" data={summary.months.current} highlight />
              <MonthColumn title="Próximo mes" data={summary.months.next} />
            </div>

            {/* Fila 3 — gráficos */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">Tendencias</h2>
              <div className="inline-flex rounded-lg border border-line bg-surface-card p-0.5 self-start">
                {([
                  ['month', 'Mes'],
                  ['quarter', 'Trimestre'],
                  ['year', 'Año'],
                ] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setChartPeriod(v)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                      chartPeriod === v ? 'bg-violet-600 text-white' : 'text-ink-muted hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="rounded-xl border border-line bg-surface-card/80 p-4">
                <p className="text-sm font-medium text-ink mb-3">Facturación por mes</p>
                <div className="h-64 sm:h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartInv} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={56} />
                      <Tooltip
                        contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                        labelStyle={{ color: '#e2e8f0' }}
                        formatter={(v: number) => formatCLP(v)}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="onTime" name="A tiempo" stackId="a" fill={COLORS.onTime} />
                      <Bar dataKey="paid" name="Pagado (tarde)" stackId="a" fill={COLORS.paid} />
                      <Bar dataKey="unpaid" name="Pendiente" stackId="a" fill={COLORS.unpaid} />
                      <Bar dataKey="overdue" name="Vencido" stackId="a" fill={COLORS.overdue} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-line bg-surface-card/80 p-4">
                <p className="text-sm font-medium text-ink mb-3">Pagos por método</p>
                <div className="h-64 sm:h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartPay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={56} />
                      <Tooltip
                        contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                        labelStyle={{ color: '#e2e8f0' }}
                        formatter={(v: number) => formatCLP(v)}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="cash" name="Efectivo" stackId="b" fill={COLORS.cash} />
                      <Bar dataKey="transfer" name="Transferencia" stackId="b" fill={COLORS.transfer} />
                      <Bar dataKey="card" name="Tarjeta" stackId="b" fill={COLORS.card} />
                      <Bar dataKey="flow" name="Flow" stackId="b" fill={COLORS.flow} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Fila 4 — egresos */}
            <div className="rounded-xl border border-line bg-surface-card/80 overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b border-line">
                <div>
                  <h2 className="text-sm font-semibold text-ink">Egresos</h2>
                  <p className="text-xs text-ink-muted">Gastos operativos del período</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="month"
                    value={expenseMonth}
                    onChange={(e) => setExpenseMonth(e.target.value)}
                    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
                  />
                  <button
                    type="button"
                    onClick={openCreate}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-sm font-medium"
                  >
                    <Plus className="h-4 w-4" /> Agregar egreso
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-ink-muted border-b border-line">
                      <th className="px-4 py-3 font-medium">Fecha</th>
                      <th className="px-4 py-3 font-medium">Proveedor</th>
                      <th className="px-4 py-3 font-medium">Descripción</th>
                      <th className="px-4 py-3 font-medium">Categoría</th>
                      <th className="px-4 py-3 font-medium text-right">Monto</th>
                      <th className="px-4 py-3 font-medium text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-ink-muted">
                          Sin egresos en este mes
                        </td>
                      </tr>
                    ) : expenses.map((exp) => (
                      <tr key={exp.id} className="border-b border-line/80 hover:bg-surface-raised/40">
                        <td className="px-4 py-3 font-mono text-xs text-ink-soft">{String(exp.date).slice(0, 10)}</td>
                        <td className="px-4 py-3 text-ink">{exp.provider || '—'}</td>
                        <td className="px-4 py-3 text-ink-muted max-w-[220px] truncate">{exp.description || '—'}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-surface-raised text-ink-soft border border-line">
                            {CATEGORY_LABELS[exp.category] || exp.category}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-rose-300">{formatCLP(Number(exp.amount))}</td>
                        <td className="px-4 py-3 text-right">
                          <button type="button" onClick={() => openEdit(exp)} className="p-1.5 rounded-lg hover:bg-slate-700 text-ink-muted hover:text-white" title="Editar">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => deleteExpense(exp.id)} className="p-1.5 rounded-lg hover:bg-rose-500/20 text-ink-muted hover:text-rose-400" title="Eliminar">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface-card shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <h3 className="font-semibold text-white">{editing ? 'Editar egreso' : 'Agregar egreso'}</h3>
              <button type="button" onClick={() => setShowModal(false)} className="p-1 rounded-lg hover:bg-surface-raised text-ink-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={saveExpense} className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-ink-muted mb-1">Fecha</label>
                  <input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-ink-muted mb-1">Monto</label>
                  <input required type="number" min="1" step="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-mono" placeholder="0" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-ink-muted mb-1">Categoría</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm">
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-ink-muted mb-1">Proveedor</label>
                <input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-ink-muted mb-1">Descripción</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-ink-muted mb-1">Nº factura / boleta</label>
                <input value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-mono" />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-2.5 rounded-lg border border-line text-sm hover:bg-surface-raised">
                  Cancelar
                </button>
                <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-sm font-medium disabled:opacity-50">
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
