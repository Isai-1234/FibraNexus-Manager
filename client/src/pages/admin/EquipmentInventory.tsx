import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  RefreshCw, Router, Server, Trash2, Wifi, Antenna, Network, Search,
} from 'lucide-react'
import DeviceIpLink from '../../components/DeviceIpLink'

type Props = {
  API: string
  onOpenRedIsp?: () => void
  onOpenClient?: (clientId: number) => void
}

type FilterId = 'all' | 'router' | 'ap' | 'cpe' | 'switch' | 'olt'

function TypeIcon({ role }: { role?: string }) {
  const cls = 'h-4 w-4'
  if (role === 'router') return <Router className={`${cls} text-violet-500`} />
  if (role === 'ap') return <Antenna className={`${cls} text-teal-500`} />
  if (role === 'station' || role === 'cpe') return <Wifi className={`${cls} text-sky-500`} />
  if (role === 'switch' || role === 'olt') return <Server className={`${cls} text-slate-500`} />
  return <Network className={`${cls} text-slate-400`} />
}

function statusMeta(item: any): { dot: string; label: string; title?: string } {
  if (item.alertKind === 'link' || item.alertKind === 'down') {
    return { dot: 'bg-red-500', label: 'Offline', title: item.snmpError || 'Offline' }
  }
  if (item.alertKind === 'cpu' || item.alertKind === 'warn') {
    return { dot: 'bg-amber-400', label: 'Alerta', title: 'Requiere atención' }
  }
  if (item.inventoryOnline) {
    return { dot: 'bg-emerald-500', label: 'Online' }
  }
  return { dot: 'bg-slate-300', label: 'Sin mon.', title: 'Sin SNMP / sin monitoreo' }
}

function Meter({ value }: { value: number | null }) {
  if (value == null || !Number.isFinite(value)) return null
  const clamped = Math.max(0, Math.min(100, value))
  const bar = clamped >= 85 ? 'bg-red-400' : clamped >= 65 ? 'bg-amber-400' : 'bg-slate-400'
  return (
    <div className="flex items-center gap-2 min-w-[88px]">
      <div className="flex-1 h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-ink-muted w-7 text-right">{clamped}%</span>
    </div>
  )
}

function signalClass(dbm: number) {
  if (dbm >= -60) return 'text-emerald-600'
  if (dbm >= -70) return 'text-amber-600'
  return 'text-orange-600'
}

export default function EquipmentInventory({ API, onOpenRedIsp, onOpenClient }: Props) {
  const [items, setItems] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterId>('all')
  const [search, setSearch] = useState('')
  const [refreshingId, setRefreshingId] = useState<number | null>(null)
  const [error, setError] = useState('')

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
      const res = await api().get('/equipment')
      const payload = res.data
      if (Array.isArray(payload)) {
        setItems(payload)
        setStats(null)
      } else {
        setItems(payload.items || [])
        setStats(payload.stats || null)
      }
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Error al cargar inventario')
      setItems([])
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function refreshOne(id: number) {
    setRefreshingId(id)
    try {
      await api().post(`/network/equipment/${id}/snmp/poll`).catch(() =>
        api().patch(`/equipment/${id}`, {}),
      )
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || e.message)
    }
    setRefreshingId(null)
  }

  async function removeOne(id: number) {
    if (!confirm('¿Eliminar este equipo del inventario?')) return
    try {
      await api().delete(`/equipment/${id}`)
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || e.message)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      const role = item.roleHint || item.type
      if (filter === 'router' && item.type !== 'router') return false
      if (filter === 'ap' && role !== 'ap') return false
      if (filter === 'cpe' && !(role === 'station' || (item.type === 'cpe' && role !== 'ap'))) return false
      if (filter === 'switch' && item.type !== 'switch') return false
      if (filter === 'olt' && item.type !== 'olt') return false
      if (!q) return true
      const blob = [
        item.name, item.brand, item.model, item.ipAddress, item.displayIp,
        item.siteName, item.clientName, item.macAddress,
      ].filter(Boolean).join(' ').toLowerCase()
      return blob.includes(q)
    })
  }, [items, filter, search])

  const chips: { id: FilterId; label: string; count: number }[] = [
    { id: 'all', label: 'Todos', count: stats?.total ?? items.length },
    { id: 'router', label: 'Routers', count: stats?.byType?.router ?? 0 },
    { id: 'ap', label: 'Sectoriales', count: stats?.byType?.ap ?? 0 },
    { id: 'cpe', label: 'CPE', count: stats?.byType?.cpe ?? 0 },
    { id: 'switch', label: 'Switches', count: stats?.byType?.switch ?? 0 },
    { id: 'olt', label: 'OLTs', count: stats?.byType?.olt ?? 0 },
  ].filter((c) => c.id === 'all' || c.count > 0)

  return (
    <div className="space-y-5">
      {/* Cabecera quieta */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-sm text-ink-muted">
            <span className="text-ink font-semibold tabular-nums">{stats?.total ?? items.length}</span>
            {' '}equipos
          </p>
          {(stats?.offline ?? 0) > 0 && (
            <span className="text-sm text-red-600/90 tabular-nums">{stats.offline} offline</span>
          )}
          {(stats?.alerts ?? 0) > 0 && (
            <span className="text-sm text-amber-600/90 tabular-nums">{stats.alerts} alertas</span>
          )}
          {onOpenRedIsp && (
            <button
              type="button"
              onClick={onOpenRedIsp}
              className="text-sm text-ink-muted hover:text-teal-700 transition"
            >
              Ver topología →
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-raised transition"
          title="Actualizar"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filtros tipo pestaña + búsqueda */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-line">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setFilter(c.id)}
            className={`px-3 py-2 text-sm transition border-b-2 -mb-px ${
              filter === c.id
                ? 'border-teal-600 text-ink font-medium'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {c.label}
            <span className={`ml-1.5 tabular-nums text-xs ${filter === c.id ? 'text-teal-700' : 'text-ink-muted/70'}`}>
              {c.count}
            </span>
          </button>
        ))}
        <div className="ml-auto relative mb-1.5">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar…"
            className="w-44 sm:w-56 pl-8 pr-3 py-1.5 text-sm rounded-lg border-0 bg-surface-raised/60 text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-teal-500/40"
          />
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50/80 rounded-lg px-3 py-2">{error}</div>
      )}

      <div className="rounded-xl border border-line/80 bg-surface-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600/70" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-ink-muted">
            <Server className="h-10 w-10 mx-auto mb-3 opacity-25" />
            <p className="text-sm">Sin equipos en este filtro</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted/80">
                  <th className="pl-4 pr-2 py-2.5 font-medium w-8" />
                  <th className="px-2 py-2.5 font-medium">Equipo</th>
                  <th className="px-2 py-2.5 font-medium">IP</th>
                  <th className="px-2 py-2.5 font-medium hidden lg:table-cell">Uptime</th>
                  <th className="px-2 py-2.5 font-medium">Carga</th>
                  <th className="px-2 py-2.5 font-medium">Señal</th>
                  <th className="px-2 py-2.5 font-medium">Clientes</th>
                  <th className="pl-2 pr-4 py-2.5 font-medium w-20" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const role = item.roleHint || item.type
                  const st = statusMeta(item)
                  const showRadio = role === 'ap' || role === 'station' || item.type === 'cpe'
                  const showClients = role === 'ap' && item.stationCount != null
                  const showCpuRam = item.type === 'router'
                  const model = [item.brand, item.model].filter(Boolean).join(' ')
                  return (
                    <tr
                      key={item.id}
                      className="group border-t border-line/50 hover:bg-surface-raised/40 transition-colors"
                    >
                      <td className="pl-4 pr-1 py-3 align-middle">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${st.dot}`}
                          title={st.title || st.label}
                        />
                      </td>
                      <td className="px-2 py-3 align-middle">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="shrink-0 opacity-80"><TypeIcon role={role} /></span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink truncate leading-snug">{item.name}</p>
                            <p className="text-[11px] text-ink-muted truncate mt-0.5">
                              {item.siteName || 'Sin nodo'}
                              {model ? ` · ${model}` : ''}
                              {item.clientName ? ` · ${item.clientName}` : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-3 align-middle text-sm">
                        {(item.displayIp || item.ipAddress) ? (
                          <DeviceIpLink
                            ip={item.displayIp || item.ipAddress}
                            className="font-mono text-[13px] text-ink-soft hover:text-teal-700"
                          />
                        ) : (
                          <span className="text-ink-muted/40">—</span>
                        )}
                      </td>
                      <td className="px-2 py-3 align-middle text-[12px] font-mono text-ink-muted hidden lg:table-cell whitespace-nowrap">
                        {item.snmpUptime || item.credentials?.lastRouterInfo?.uptime || (
                          <span className="text-ink-muted/40">—</span>
                        )}
                      </td>
                      <td className="px-2 py-3 align-middle">
                        {showCpuRam ? (
                          <div className="space-y-1.5">
                            <Meter value={item.cpuLoad} />
                            <Meter value={item.ramPercent} />
                          </div>
                        ) : (
                          <span className="text-ink-muted/40 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-2 py-3 align-middle text-sm tabular-nums whitespace-nowrap">
                        {showRadio && item.wirelessSignal != null ? (
                          <span className={`font-medium ${signalClass(item.wirelessSignal)}`}>
                            {item.wirelessSignal}
                            <span className="text-ink-muted font-normal text-[11px] ml-0.5">dBm</span>
                          </span>
                        ) : (
                          <span className="text-ink-muted/40">—</span>
                        )}
                      </td>
                      <td className="px-2 py-3 align-middle text-sm">
                        {showClients ? (
                          <span className="tabular-nums text-ink">{item.stationCount}</span>
                        ) : item.clientId && onOpenClient ? (
                          <button
                            type="button"
                            onClick={() => onOpenClient(item.clientId)}
                            className="text-ink-muted hover:text-teal-700 text-[13px] transition"
                          >
                            Abonado
                          </button>
                        ) : (
                          <span className="text-ink-muted/40">—</span>
                        )}
                      </td>
                      <td className="pl-2 pr-3 py-3 align-middle">
                        <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          <button
                            type="button"
                            title="Actualizar"
                            onClick={() => void refreshOne(item.id)}
                            className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-raised"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${refreshingId === item.id ? 'animate-spin' : ''}`} />
                          </button>
                          <button
                            type="button"
                            title="Eliminar"
                            onClick={() => void removeOne(item.id)}
                            className="p-1.5 rounded-md text-ink-muted hover:text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
