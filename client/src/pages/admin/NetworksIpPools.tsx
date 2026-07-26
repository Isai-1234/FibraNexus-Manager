import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  Plus, RefreshCw, X, Network, Building2, Wifi, Server, Home,
} from 'lucide-react'

type Props = {
  API: string
}

type PoolType = 'residential' | 'business' | 'wireless' | 'management'

const TYPE_META: Record<PoolType, { label: string; color: string; bar: string; pill: string; icon: typeof Home }> = {
  residential: {
    label: 'Residencial',
    color: 'text-sky-600',
    bar: 'bg-sky-500',
    pill: 'bg-sky-100 text-sky-800',
    icon: Home,
  },
  business: {
    label: 'Empresarial',
    color: 'text-violet-600',
    bar: 'bg-violet-500',
    pill: 'bg-violet-100 text-violet-800',
    icon: Building2,
  },
  wireless: {
    label: 'Inalámbrico',
    color: 'text-emerald-600',
    bar: 'bg-emerald-500',
    pill: 'bg-emerald-100 text-emerald-800',
    icon: Wifi,
  },
  management: {
    label: 'Gestión',
    color: 'text-amber-600',
    bar: 'bg-amber-500',
    pill: 'bg-amber-100 text-amber-800',
    icon: Server,
  },
}

const emptyForm = {
  name: '',
  subnet: '',
  gateway: '',
  dns: '8.8.8.8, 1.1.1.1',
  vlan: '',
  poolType: 'residential' as PoolType,
  status: 'active',
}

export default function NetworksIpPools({ API }: Props) {
  const [items, setItems] = useState<any[]>([])
  const [suggested, setSuggested] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | PoolType>('all')
  const [selected, setSelected] = useState<any | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    })
  }

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await api().get('/ip-management/pools')
      setItems(res.data.items || [])
      setSuggested(res.data.suggested || [])
      setStats(res.data.stats || null)
      if (selected?.id) {
        const fresh = (res.data.items || []).find((x: any) => x.id === selected.id)
        setSelected(fresh || null)
      }
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Error al cargar redes')
      setItems([])
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    if (filter === 'all') return items
    return items.filter((i) => i.poolType === filter)
  }, [items, filter])

  async function savePool() {
    setSaving(true)
    try {
      await api().post('/ip-management/pools', {
        ...form,
        vlan: form.vlan === '' ? null : Number(form.vlan),
      })
      setShowForm(false)
      setForm(emptyForm)
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || e.message)
    }
    setSaving(false)
  }

  async function bootstrap() {
    if (!confirm('¿Crear redes automáticamente a partir de las IPs ya usadas en abonados y equipos?')) return
    setSaving(true)
    try {
      const res = await api().post('/ip-management/pools/bootstrap')
      alert(`Se crearon ${res.data.created || 0} red(es).`)
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || e.message)
    }
    setSaving(false)
  }

  async function toggleStatus(pool: any) {
    try {
      await api().patch(`/ip-management/pools/${pool.id}`, {
        status: pool.status === 'active' ? 'inactive' : 'active',
      })
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || e.message)
    }
  }

  async function removePool(pool: any) {
    if (!confirm(`¿Eliminar la red "${pool.name}"? No borra IPs de abonados, solo el registro del pool.`)) return
    try {
      await api().delete(`/ip-management/pools/${pool.id}`)
      if (selected?.id === pool.id) setSelected(null)
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || e.message)
    }
  }

  const typeCards = (['residential', 'business', 'wireless', 'management'] as PoolType[]).map((t) => ({
    id: t,
    ...TYPE_META[t],
    count: stats?.byType?.[t] ?? items.filter((i) => i.poolType === t).length,
  }))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            <Network className="h-5 w-5 text-sky-600" />
            Redes &amp; Pools de IPs
          </h2>
          <p className="text-sm text-ink-muted mt-0.5">
            {stats?.networks ?? items.length} redes
            {stats?.totalIps != null && (
              <> — <span className="tabular-nums font-medium text-ink">{stats.usedIps}/{stats.totalIps}</span> IPs asignadas</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="p-2 rounded-lg border border-line text-ink-muted hover:text-ink hover:bg-surface-raised"
            title="Actualizar"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => { setForm(emptyForm); setShowForm(true) }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700"
          >
            <Plus className="h-4 w-4" /> Nueva red
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {typeCards.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setFilter(filter === c.id ? 'all' : c.id)}
            className={`text-left rounded-xl border p-3.5 transition ${
              filter === c.id ? 'border-sky-400 ring-2 ring-sky-100 bg-surface-card' : 'border-line bg-surface-card hover:border-sky-200'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <c.icon className={`h-4 w-4 ${c.color}`} />
              <span className="text-xs font-medium text-ink-muted">{c.label}</span>
            </div>
            <p className={`text-xl font-bold tabular-nums ${c.color}`}>{c.count}</p>
            <p className="text-[11px] text-ink-muted mt-0.5">redes</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {([{ id: 'all', label: 'Todos' }, ...typeCards.map((c) => ({ id: c.id, label: c.label }))] as const).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id as any)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
              filter === f.id
                ? 'bg-sky-600 text-white'
                : 'bg-surface-raised text-ink-muted hover:text-ink'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
      )}

      {items.length === 0 && !loading && suggested.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-amber-900">Detectamos {suggested.length} subred(es) en uso</p>
            <p className="text-xs text-amber-800/80 mt-0.5">
              Puedes crearlas automáticamente para ver ocupación (ej. {suggested[0]?.subnet}).
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void bootstrap()}
            className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-60"
          >
            Crear redes detectadas
          </button>
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface-card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-ink-muted">
            <Network className="h-10 w-10 mx-auto mb-3 opacity-25" />
            <p className="text-sm font-medium">Aún no hay redes / pools</p>
            <p className="text-xs mt-1">Crea una subred (ej. 172.16.11.0/24) para ver IPs ocupadas vs libres.</p>
            <button
              type="button"
              onClick={() => { setForm(emptyForm); setShowForm(true) }}
              className="mt-4 text-sm text-sky-700 hover:underline"
            >
              + Nueva red
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-line">
                  <th className="px-4 py-2.5 font-medium">ID</th>
                  <th className="px-3 py-2.5 font-medium">Nombre</th>
                  <th className="px-3 py-2.5 font-medium">Subred</th>
                  <th className="px-3 py-2.5 font-medium">Gateway</th>
                  <th className="px-3 py-2.5 font-medium hidden lg:table-cell">DNS</th>
                  <th className="px-3 py-2.5 font-medium">VLAN</th>
                  <th className="px-3 py-2.5 font-medium min-w-[160px]">Uso de IPs</th>
                  <th className="px-3 py-2.5 font-medium">Tipo</th>
                  <th className="px-3 py-2.5 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((pool) => {
                  const tm = TYPE_META[(pool.poolType as PoolType) || 'residential'] || TYPE_META.residential
                  const active = pool.status === 'active'
                  return (
                    <tr
                      key={pool.id}
                      onClick={() => setSelected(pool)}
                      className={`border-t border-line/60 cursor-pointer transition ${
                        selected?.id === pool.id ? 'bg-sky-50/70' : 'hover:bg-surface-raised/50'
                      }`}
                    >
                      <td className="px-4 py-3 text-xs font-mono text-ink-muted">{pool.code}</td>
                      <td className="px-3 py-3 text-sm font-medium text-ink">{pool.name}</td>
                      <td className="px-3 py-3 text-sm font-mono text-sky-700">{pool.subnet}</td>
                      <td className="px-3 py-3 text-sm font-mono text-ink-soft">{pool.gateway || '—'}</td>
                      <td className="px-3 py-3 text-xs text-ink-muted hidden lg:table-cell max-w-[140px] truncate">{pool.dns || '—'}</td>
                      <td className="px-3 py-3 text-sm tabular-nums text-ink-muted">{pool.vlan ?? '—'}</td>
                      <td className="px-3 py-3">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs tabular-nums">
                            <span className="text-ink font-medium">{pool.usedCount}/{pool.totalUsable}</span>
                            <span className="text-ink-muted">{pool.usagePercent}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${tm.bar}`}
                              style={{ width: `${Math.min(100, pool.usagePercent || 0)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${tm.pill}`}>
                          {tm.label}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
                          <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                          {active ? 'Activa' : 'Inactiva'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="rounded-xl border border-line bg-surface-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-ink">{selected.name}</h3>
              <p className="text-xs text-ink-muted mt-0.5 font-mono">
                {selected.code} · {selected.subnet}
                {' · '}
                {selected.freeCount} libres / {selected.usedCount} ocupadas
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void toggleStatus(selected)}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-line hover:bg-surface-raised"
              >
                {selected.status === 'active' ? 'Desactivar' : 'Activar'}
              </button>
              <button
                type="button"
                onClick={() => void removePool(selected)}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50"
              >
                Eliminar
              </button>
              <button type="button" onClick={() => setSelected(null)} className="p-1.5 text-ink-muted hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          {(selected.usedIps || []).length === 0 ? (
            <p className="text-sm text-ink-muted">Ninguna IP de esta subred aparece en abonados, equipos o detectados.</p>
          ) : (
            <div className="overflow-x-auto max-h-56 overflow-y-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-raised text-[11px] uppercase text-ink-muted">
                  <tr>
                    <th className="text-left px-3 py-2">IP</th>
                    <th className="text-left px-3 py-2">Uso</th>
                    <th className="text-left px-3 py-2">Fuente</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {selected.usedIps.map((u: any) => (
                    <tr key={u.ip}>
                      <td className="px-3 py-1.5 font-mono text-sky-700">{u.ip}</td>
                      <td className="px-3 py-1.5 text-ink-soft">{u.clientName || u.label || '—'}</td>
                      <td className="px-3 py-1.5 text-xs text-ink-muted">{(u.sources || []).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div
            className="bg-surface-card rounded-2xl border border-line shadow-xl w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-ink">Nueva red / pool</h3>
              <button type="button" onClick={() => setShowForm(false)} className="p-1 text-ink-muted hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block text-xs text-ink-muted">
                Nombre
                <input
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink bg-surface"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Red Hogares Norte"
                />
              </label>
              <label className="block text-xs text-ink-muted">
                Subred (CIDR)
                <input
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm font-mono text-ink bg-surface"
                  value={form.subnet}
                  onChange={(e) => setForm({ ...form, subnet: e.target.value })}
                  placeholder="192.168.10.0/24"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-ink-muted">
                  Gateway
                  <input
                    className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm font-mono text-ink bg-surface"
                    value={form.gateway}
                    onChange={(e) => setForm({ ...form, gateway: e.target.value })}
                    placeholder="192.168.10.1"
                  />
                </label>
                <label className="block text-xs text-ink-muted">
                  VLAN
                  <input
                    className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink bg-surface"
                    value={form.vlan}
                    onChange={(e) => setForm({ ...form, vlan: e.target.value })}
                    placeholder="10"
                  />
                </label>
              </div>
              <label className="block text-xs text-ink-muted">
                DNS
                <input
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink bg-surface"
                  value={form.dns}
                  onChange={(e) => setForm({ ...form, dns: e.target.value })}
                />
              </label>
              <label className="block text-xs text-ink-muted">
                Tipo
                <select
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink bg-surface"
                  value={form.poolType}
                  onChange={(e) => setForm({ ...form, poolType: e.target.value as PoolType })}
                >
                  {(Object.keys(TYPE_META) as PoolType[]).map((t) => (
                    <option key={t} value={t}>{TYPE_META[t].label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex gap-2 mt-5">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 rounded-lg border border-line text-sm">
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving || !form.name.trim() || !form.subnet.trim()}
                onClick={() => void savePool()}
                className="flex-1 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
