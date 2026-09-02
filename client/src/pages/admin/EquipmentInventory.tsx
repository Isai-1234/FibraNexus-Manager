import { Fragment, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  RefreshCw, Router, Server, Trash2, Wifi, Antenna, Network, Search, ChevronRight, ChevronDown,
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

function SignalBar({ dbm }: { dbm: number | null }) {
  if (dbm == null || !Number.isFinite(dbm)) {
    return <span className="text-ink-muted/40">—</span>
  }
  // -40 excelente → 100%; -85 peor → ~0%
  const pct = Math.max(5, Math.min(100, Math.round(((dbm + 85) / 45) * 100)))
  const bar = dbm >= -60 ? 'bg-emerald-500' : dbm >= -70 ? 'bg-amber-400' : 'bg-orange-500'
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="w-14 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-sm tabular-nums font-medium ${signalClass(dbm)}`}>
        {dbm}
        <span className="text-ink-muted font-normal text-[11px] ml-0.5">dBm</span>
      </span>
    </div>
  )
}

function roleOf(item: any) {
  return item.roleHint || item.type
}

function isAp(item: any) {
  return roleOf(item) === 'ap'
}

function isStation(item: any) {
  const r = roleOf(item)
  return r === 'station' || (item.type === 'cpe' && r !== 'ap')
}

/** CPEs / estaciones bajo un sectorial: parentId, o mismo sitio con abonado. */
function stationsUnderAp(ap: any, all: any[]) {
  const byParent = all.filter((e) => e.parentId != null && Number(e.parentId) === Number(ap.id) && isStation(e))
  if (byParent.length) return byParent
  if (!ap.siteId) return []
  return all.filter((e) =>
    isStation(e)
    && e.siteId === ap.siteId
    && e.id !== ap.id
    && (e.clientId || e.parentId == null),
  )
}

export default function EquipmentInventory({ API, onOpenRedIsp, onOpenClient }: Props) {
  const [items, setItems] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterId>('ap')
  const [search, setSearch] = useState('')
  const [refreshingId, setRefreshingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [expandedApId, setExpandedApId] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

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
      setError(e.response?.data?.error || e.message || 'Error al cargar señales RF / inventario')
      setItems([])
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  // Auto-refresh cada 30s (solo si la pestaña esta visible) para que la
  // recuperacion de un equipo apagado/encendido se vea sin refrescar a mano.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 30_000)
    return () => clearInterval(t)
  }, [])

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
      if (selectedId === id) setSelectedId(null)
      if (expandedApId === id) setExpandedApId(null)
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || e.message)
    }
  }

  const apStats = useMemo(() => {
    const aps = items.filter(isAp)
    const online = aps.filter((a) => a.inventoryOnline).length
    const stations = items.filter(isStation)
    const signals = stations.map((s) => s.wirelessSignal).filter((v: any) => v != null && Number.isFinite(v))
    const avg = signals.length
      ? Math.round(signals.reduce((a: number, b: number) => a + b, 0) / signals.length)
      : null
    const rfAlerts = items.filter((e) =>
      (e.wirelessSignal != null && e.wirelessSignal < -75)
      || (e.wirelessCcq != null && e.wirelessCcq < 50)
      || e.alertKind === 'link',
    ).length
    return {
      apOnline: online,
      apTotal: aps.length,
      stations: stations.length,
      avgSignal: avg,
      rfAlerts,
      offline: aps.filter((a) => !a.inventoryOnline).length,
    }
  }, [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      const role = roleOf(item)
      if (filter === 'router' && item.type !== 'router') return false
      if (filter === 'ap' && role !== 'ap') return false
      if (filter === 'cpe' && !isStation(item)) return false
      if (filter === 'switch' && item.type !== 'switch') return false
      if (filter === 'olt' && item.type !== 'olt') return false
      // En vista sectoriales, los CPE se muestran anidados al expandir (no en la lista raíz)
      if (filter === 'all' && isStation(item) && item.parentId) {
        // sigue visible en "Todos"; ok
      }
      if (!q) return true
      const blob = [
        item.name, item.brand, item.model, item.ipAddress, item.displayIp,
        item.siteName, item.clientName, item.macAddress,
      ].filter(Boolean).join(' ').toLowerCase()
      return blob.includes(q)
    })
  }, [items, filter, search])

  const selected = useMemo(
    () => items.find((e) => e.id === selectedId) || null,
    [items, selectedId],
  )

  const chips: { id: FilterId; label: string; count: number }[] = [
    { id: 'ap', label: 'Sectoriales', count: stats?.byType?.ap ?? apStats.apTotal },
    { id: 'cpe', label: 'CPE', count: stats?.byType?.cpe ?? apStats.stations },
    { id: 'router', label: 'Routers', count: stats?.byType?.router ?? 0 },
    { id: 'all', label: 'Todo el inventario', count: stats?.total ?? items.length },
    { id: 'switch', label: 'Switches', count: stats?.byType?.switch ?? 0 },
    { id: 'olt', label: 'OLTs', count: stats?.byType?.olt ?? 0 },
  ].filter((c) => c.id === 'ap' || c.id === 'cpe' || c.id === 'all' || c.count > 0)

  function toggleAp(ap: any) {
    setSelectedId(ap.id)
    setExpandedApId((prev) => (prev === ap.id ? null : ap.id))
  }

  function renderRow(item: any, opts: { nested?: boolean } = {}) {
    const role = roleOf(item)
    const st = statusMeta(item)
    const showRadio = role === 'ap' || isStation(item)
    const showClients = isAp(item)
    const children = isAp(item) ? stationsUnderAp(item, items) : []
    const stationCount = item.stationCount != null ? item.stationCount : (showClients ? children.length : null)
    const showCpuRam = item.type === 'router'
    const model = [item.brand, item.model].filter(Boolean).join(' ')
    const expanded = expandedApId === item.id
    const isSelected = selectedId === item.id

    return (
      <Fragment key={item.id}>
        <tr
          className={`group border-t border-line/50 transition-colors cursor-pointer ${
            isSelected ? 'bg-teal-50/60 dark:bg-teal-950/30' : 'hover:bg-surface-raised/40'
          } ${opts.nested ? 'bg-surface-raised/20' : ''}`}
          onClick={() => {
            if (isAp(item)) toggleAp(item)
            else setSelectedId(item.id)
          }}
        >
          <td className="pl-4 pr-1 py-3 align-middle">
            <span
              className={`inline-block w-2 h-2 rounded-full ${st.dot}`}
              title={st.title || st.label}
            />
          </td>
          <td className="px-2 py-3 align-middle">
            <div className={`flex items-center gap-2 min-w-0 ${opts.nested ? 'pl-5' : ''}`}>
              {isAp(item) ? (
                <span className="shrink-0 text-ink-muted">
                  {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </span>
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
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
          <td className="px-2 py-3 align-middle text-sm" onClick={(e) => e.stopPropagation()}>
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
          <td className="px-2 py-3 align-middle">
            {showRadio ? <SignalBar dbm={item.wirelessSignal} /> : <span className="text-ink-muted/40">—</span>}
          </td>
          <td className="px-2 py-3 align-middle text-sm tabular-nums text-ink-muted">
            {showRadio && item.wirelessNoise != null ? (
              <span>{item.wirelessNoise} <span className="text-[11px]">dBm</span></span>
            ) : (
              <span className="text-ink-muted/40">—</span>
            )}
          </td>
          <td className="px-2 py-3 align-middle text-sm tabular-nums">
            {showRadio && item.wirelessCcq != null ? (
              <span className={item.wirelessCcq >= 80 ? 'text-emerald-600' : item.wirelessCcq >= 50 ? 'text-amber-600' : 'text-red-600'}>
                {item.wirelessCcq}%
              </span>
            ) : (
              <span className="text-ink-muted/40">—</span>
            )}
          </td>
          <td className="px-2 py-3 align-middle text-sm">
            {showClients && stationCount != null ? (
              <span className="tabular-nums text-ink">{stationCount}</span>
            ) : item.clientId && onOpenClient ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenClient(item.clientId) }}
                className="text-ink-muted hover:text-teal-700 text-[13px] transition"
              >
                Abonado
              </button>
            ) : (
              <span className="text-ink-muted/40">—</span>
            )}
          </td>
          <td className="pl-2 pr-3 py-3 align-middle" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <button
                type="button"
                title="Actualizar SNMP"
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
        {expanded && children.map((child) => renderRow(child, { nested: true }))}
      </Fragment>
    )
  }

  return (
    <div className="space-y-5">
      {/* Resumen RF */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">Monitoreo de señales RF</p>
          <p className="text-xs text-ink-muted mt-0.5">
            {apStats.apTotal} sectoriales · {apStats.stations} clientes / CPE
            {onOpenRedIsp && (
              <>
                {' · '}
                <button type="button" onClick={onOpenRedIsp} className="hover:text-teal-700 transition">
                  Ver topología →
                </button>
              </>
            )}
          </p>
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'APs online', value: `${apStats.apOnline}/${apStats.apTotal}`, color: 'text-emerald-600' },
          { label: 'Clientes / CPE', value: apStats.stations, color: 'text-sky-600' },
          { label: 'Señal promedio', value: apStats.avgSignal != null ? `${apStats.avgSignal} dBm` : '—', color: 'text-amber-600' },
          { label: 'Alertas RF', value: apStats.rfAlerts, color: 'text-amber-500' },
          { label: 'Fuera de línea', value: apStats.offline, color: 'text-red-600' },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-line bg-surface-card px-3.5 py-3">
            <p className="text-[11px] uppercase tracking-wide text-ink-muted">{c.label}</p>
            <p className={`text-xl font-bold tabular-nums mt-0.5 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-line">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => { setFilter(c.id); setExpandedApId(null) }}
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
            <Antenna className="h-10 w-10 mx-auto mb-3 opacity-25" />
            <p className="text-sm">Sin equipos en este filtro</p>
            <p className="text-xs mt-1">Prueba «Todo el inventario» o adopta equipos en Red ISP.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted/80">
                  <th className="pl-4 pr-2 py-2.5 font-medium w-8" />
                  <th className="px-2 py-2.5 font-medium">Equipo</th>
                  <th className="px-2 py-2.5 font-medium">IP</th>
                  <th className="px-2 py-2.5 font-medium hidden lg:table-cell">Uptime</th>
                  <th className="px-2 py-2.5 font-medium">Carga</th>
                  <th className="px-2 py-2.5 font-medium">Señal</th>
                  <th className="px-2 py-2.5 font-medium">Ruido</th>
                  <th className="px-2 py-2.5 font-medium">CCQ</th>
                  <th className="px-2 py-2.5 font-medium">Clientes</th>
                  <th className="pl-2 pr-4 py-2.5 font-medium w-20" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => renderRow(item))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="rounded-xl border border-line bg-surface-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
                <TypeIcon role={roleOf(selected)} />
                {selected.name}
              </h3>
              <p className="text-xs text-ink-muted mt-1">
                {[selected.brand, selected.model].filter(Boolean).join(' ') || 'Sin modelo'}
                {selected.siteName ? ` — ${selected.siteName}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-xs text-ink-muted hover:text-ink"
            >
              Cerrar
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-sm">
            <div>
              <p className="text-[11px] uppercase text-ink-muted">Dirección IP</p>
              <p className="font-mono mt-0.5">{selected.displayIp || selected.ipAddress || '—'}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase text-ink-muted">Señal recibida</p>
              <p className={`mt-0.5 font-medium tabular-nums ${selected.wirelessSignal != null ? signalClass(selected.wirelessSignal) : ''}`}>
                {selected.wirelessSignal != null ? `${selected.wirelessSignal} dBm` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase text-ink-muted">Piso de ruido</p>
              <p className="mt-0.5 tabular-nums">{selected.wirelessNoise != null ? `${selected.wirelessNoise} dBm` : '—'}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase text-ink-muted">CCQ</p>
              <p className="mt-0.5 tabular-nums">{selected.wirelessCcq != null ? `${selected.wirelessCcq}%` : '—'}</p>
            </div>
            {isAp(selected) && (
              <div>
                <p className="text-[11px] uppercase text-ink-muted">Clientes activos</p>
                <p className="mt-0.5 tabular-nums">
                  {selected.stationCount ?? stationsUnderAp(selected, items).length}
                </p>
              </div>
            )}
            {selected.clientName && (
              <div>
                <p className="text-[11px] uppercase text-ink-muted">Abonado</p>
                <p className="mt-0.5">
                  {selected.clientId && onOpenClient ? (
                    <button
                      type="button"
                      className="text-teal-700 hover:underline"
                      onClick={() => onOpenClient(selected.clientId)}
                    >
                      {selected.clientName}
                    </button>
                  ) : selected.clientName}
                </p>
              </div>
            )}
            <div>
              <p className="text-[11px] uppercase text-ink-muted">Uptime</p>
              <p className="mt-0.5 font-mono text-xs">{selected.snmpUptime || '—'}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase text-ink-muted">Estado</p>
              <p className="mt-0.5">{statusMeta(selected).label}</p>
            </div>
          </div>
          {isAp(selected) && expandedApId !== selected.id && (
            <button
              type="button"
              onClick={() => setExpandedApId(selected.id)}
              className="mt-4 text-sm text-teal-700 hover:underline"
            >
              Ver CPE conectados →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
