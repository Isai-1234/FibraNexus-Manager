import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  AlertTriangle, CheckCircle, RefreshCw, Router, Server,
  Trash2, Wifi, XCircle, Antenna, Network,
} from 'lucide-react'
import DeviceIpLink from '../../components/DeviceIpLink'

type Props = {
  API: string
  onOpenRedIsp?: () => void
  onOpenClient?: (clientId: number) => void
}

type FilterId = 'all' | 'router' | 'ap' | 'cpe' | 'switch' | 'olt' | 'other'

const TYPE_LABEL: Record<string, string> = {
  router: 'Router',
  switch: 'Switch',
  olt: 'OLT',
  ont: 'ONT',
  ap: 'Access Point',
  cpe: 'CPE / Antena',
  server: 'Servidor',
  other: 'Otro',
  station: 'CPE abonado',
}

function TypeIcon({ role }: { role?: string }) {
  if (role === 'router') return <Router className="h-3.5 w-3.5 text-violet-600" />
  if (role === 'ap') return <Antenna className="h-3.5 w-3.5 text-teal-600" />
  if (role === 'station' || role === 'cpe') return <Wifi className="h-3.5 w-3.5 text-sky-600" />
  if (role === 'switch' || role === 'olt') return <Server className="h-3.5 w-3.5 text-slate-600" />
  return <Network className="h-3.5 w-3.5 text-slate-500" />
}

function Meter({ value, tone }: { value: number | null; tone: 'cpu' | 'ram' }) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="text-ink-muted text-xs">—</span>
  }
  const clamped = Math.max(0, Math.min(100, value))
  const color = clamped >= 85
    ? 'bg-red-500'
    : clamped >= 65
      ? (tone === 'cpu' ? 'bg-orange-500' : 'bg-amber-500')
      : (tone === 'cpu' ? 'bg-blue-500' : 'bg-emerald-500')
  return (
    <div className="min-w-[72px]">
      <div className="flex items-center justify-between text-[10px] text-ink-muted mb-0.5">
        <span>{clamped}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-raised overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}

function StatusCell({ item }: { item: any }) {
  const online = Boolean(item.inventoryOnline)
  if (item.alertKind === 'link' || item.alertKind === 'down') {
    return (
      <span className="inline-flex items-center gap-1.5 text-red-600" title={item.snmpError || 'Offline'}>
        <XCircle className="h-4 w-4" />
        <span className="text-xs font-medium">Offline</span>
      </span>
    )
  }
  if (item.alertKind === 'cpu' || item.alertKind === 'warn') {
    return (
      <span className="inline-flex items-center gap-1.5 text-amber-600" title="Requiere atención">
        <AlertTriangle className="h-4 w-4" />
        <span className="text-xs font-medium">Alerta</span>
      </span>
    )
  }
  if (online) {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-600">
        <CheckCircle className="h-4 w-4" />
        <span className="text-xs font-medium">Online</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-muted" title="Sin SNMP / sin monitoreo">
      <span className="w-2 h-2 rounded-full bg-slate-400" />
      <span className="text-xs font-medium">Sin mon.</span>
    </span>
  )
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
      if (filter === 'cpe' && !(item.type === 'cpe' || role === 'station')) return false
      if (filter === 'switch' && item.type !== 'switch') return false
      if (filter === 'olt' && item.type !== 'olt') return false
      if (filter === 'other' && ['router', 'cpe', 'ap', 'switch', 'olt'].includes(item.type) && role !== 'other') {
        if (role === 'ap' || role === 'station') return false
        if (item.type !== 'other' && item.type !== 'server' && item.type !== 'ont') return false
      }
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
    { id: 'ap', label: 'APs / sectoriales', count: stats?.byType?.ap ?? 0 },
    { id: 'cpe', label: 'CPE', count: stats?.byType?.cpe ?? 0 },
    { id: 'switch', label: 'Switches', count: stats?.byType?.switch ?? 0 },
    { id: 'olt', label: 'OLTs', count: stats?.byType?.olt ?? 0 },
  ]

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-3 text-sm text-blue-900 flex flex-wrap items-center justify-between gap-2">
        <span>
          <strong>Inventario operativo</strong> — listado plano de toda la red.
          La jerarquía torre → sectorial → casa está en <strong>Red ISP</strong>.
        </span>
        {onOpenRedIsp && (
          <button
            type="button"
            onClick={onOpenRedIsp}
            className="px-3 py-1.5 bg-surface-card border border-blue-200 rounded-lg text-blue-700 text-xs font-medium hover:bg-blue-50"
          >
            Ir a Red ISP →
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink">
            <span className="font-semibold tabular-nums">{stats?.total ?? items.length}</span> dispositivos
            {(stats?.offline ?? 0) > 0 && (
              <> — <span className="text-red-600 font-medium tabular-nums">{stats.offline} offline</span></>
            )}
            {(stats?.alerts ?? 0) > 0 && (
              <> — <span className="text-amber-600 font-medium tabular-nums">{stats.alerts} alertas</span></>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="px-3 py-2 border border-line rounded-lg text-sm hover:bg-surface-raised flex items-center gap-1.5 text-ink"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setFilter(c.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              filter === c.id
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-surface-card text-ink-soft border-line hover:bg-surface-raised'
            }`}
          >
            {c.label}: {c.count}
          </button>
        ))}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar nombre, IP, nodo, abonado…"
          className="ml-auto min-w-[220px] flex-1 max-w-sm px-3 py-1.5 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      <div className="bg-surface-card rounded-xl shadow-sm border border-line overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Server className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium text-ink-muted">Sin equipos en este filtro</p>
            <p className="text-sm mt-1">Agrégalos desde Red ISP (por nodo) o Routers y agentes.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px]">
              <thead className="bg-surface border-b">
                <tr>
                  {['Estado', 'Equipo', 'Tipo', 'Modelo', 'IP', 'Uptime', 'CPU', 'RAM', 'Señal', 'Clientes', 'Acciones'].map((h) => (
                    <th key={h} className="text-left px-3 py-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((item) => {
                  const role = item.roleHint || item.type
                  const showRadio = role === 'ap' || role === 'station' || item.type === 'cpe'
                  const showClients = role === 'ap' && item.stationCount != null
                  const showCpuRam = item.type === 'router'
                  return (
                    <tr key={item.id} className="hover:bg-blue-50/30 transition">
                      <td className="px-3 py-3"><StatusCell item={item} /></td>
                      <td className="px-3 py-3">
                        <div className="flex items-start gap-2 min-w-0">
                          <span className="mt-0.5 shrink-0"><TypeIcon role={role} /></span>
                          <div className="min-w-0">
                            <p className="font-medium text-ink text-sm truncate">{item.name}</p>
                            <p className="text-[11px] text-ink-muted truncate">
                              {item.siteName || 'Sin nodo'}
                              {item.clientName ? ` · ${item.clientName}` : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="px-2 py-0.5 rounded-md bg-surface-raised text-ink-soft text-[11px] font-medium">
                          {TYPE_LABEL[role] || TYPE_LABEL[item.type] || item.type}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-ink-muted">
                        {[item.brand, item.model].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {(item.displayIp || item.ipAddress) ? (
                          <DeviceIpLink
                            ip={item.displayIp || item.ipAddress}
                            className="font-mono text-blue-600 hover:underline"
                            showIcon
                          />
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-ink-muted font-mono whitespace-nowrap">
                        {item.snmpUptime || item.credentials?.lastRouterInfo?.uptime || '—'}
                      </td>
                      <td className="px-3 py-3">
                        {showCpuRam ? <Meter value={item.cpuLoad} tone="cpu" /> : <span className="text-ink-muted text-xs">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        {showCpuRam ? <Meter value={item.ramPercent} tone="ram" /> : <span className="text-ink-muted text-xs">—</span>}
                      </td>
                      <td className="px-3 py-3 text-xs whitespace-nowrap">
                        {showRadio && item.wirelessSignal != null ? (
                          <span className={
                            item.wirelessSignal >= -60 ? 'text-emerald-600 font-medium'
                              : item.wirelessSignal >= -70 ? 'text-amber-600 font-medium'
                                : 'text-orange-600 font-medium'
                          }>
                            {item.wirelessSignal} dBm
                          </span>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs tabular-nums">
                        {showClients ? (
                          <span className="font-medium text-ink">{item.stationCount}</span>
                        ) : item.clientId && onOpenClient ? (
                          <button
                            type="button"
                            onClick={() => onOpenClient(item.clientId)}
                            className="text-blue-600 hover:underline"
                          >
                            Ver
                          </button>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            title="Actualizar estado"
                            onClick={() => void refreshOne(item.id)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${refreshingId === item.id ? 'animate-spin' : ''}`} />
                          </button>
                          {item.clientId && onOpenClient && (
                            <button
                              type="button"
                              title="Ver abonado"
                              onClick={() => onOpenClient(item.clientId)}
                              className="p-1.5 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded transition text-[11px] font-medium px-2"
                            >
                              Abonado
                            </button>
                          )}
                          <button
                            type="button"
                            title="Eliminar"
                            onClick={() => void removeOne(item.id)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"
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

      <p className="text-[11px] text-ink-muted">
        CPU/RAM solo en routers MikroTik con heartbeat. Señal en antenas con SNMP o tabla de estaciones del AP.
        Para crear o editar equipos por nodo, usa Red ISP.
      </p>
    </div>
  )
}
