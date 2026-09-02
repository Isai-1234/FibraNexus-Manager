import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Activity, RefreshCw } from 'lucide-react'

type Sample = { t: number; downMbps: number; upMbps: number }

type RouterOpt = { id: number; name?: string; hostname?: string; status?: string }

type Props = {
  API: string
  routerId: number | null
  routerName?: string
  routers?: RouterOpt[]
  onRouterChange?: (id: number) => void
  pollMs?: number
  className?: string
}

const MAX_SAMPLES = 40

function bytesPerSecToMbps(bps: number) {
  return (Number(bps) || 0) * 8 / 1_000_000
}

function pickWanInterfaces(ifaces: any[], wanHint?: string | null) {
  if (!ifaces?.length) return []
  if (wanHint) {
    const exact = ifaces.filter((i) => i.iface === wanHint)
    if (exact.length) return exact
  }
  const preferred = ifaces.filter((i) =>
    /^(ether1|eth0|eth1|wan|pppoe-out|sfp|combo)/i.test(String(i.iface || '')),
  )
  if (preferred.length) return preferred
  const ranked = [...ifaces].sort((a, b) =>
    ((Number(b.rxBps) || 0) + (Number(b.txBps) || 0))
    - ((Number(a.rxBps) || 0) + (Number(a.txBps) || 0)),
  )
  return ranked[0] ? [ranked[0]] : []
}

function formatMbps(v: number) {
  if (!Number.isFinite(v) || v < 0.005) return '0'
  if (v >= 1000) return `${(v / 1000).toFixed(2)} Gbps`
  if (v >= 10) return `${v.toFixed(1)} Mbps`
  if (v >= 1) return `${v.toFixed(2)} Mbps`
  return `${(v * 1000).toFixed(0)} Kbps`
}

function formatClock(ts: number) {
  return new Date(ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function LiveBandwidthChart({
  API, routerId, routerName, routers = [], onRouterChange, pollMs = 3000, className = '',
}: Props) {
  const [samples, setSamples] = useState<Sample[]>([])
  const [ifaceLabel, setIfaceLabel] = useState<string>('')
  const [source, setSource] = useState<string>('')
  const [state, setState] = useState<'loading' | 'live' | 'idle' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')

  const poll = useCallback(async () => {
    if (!routerId) {
      setState('idle')
      return
    }
    try {
      const res = await axios.get(`${API}/edgeos/${routerId}/bandwidth`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        timeout: 15000,
      })
      const d = res.data
      if (!d?.connected) {
        setState('idle')
        setErrMsg(d?.error || 'Router sin conexión de gestión')
        return
      }
      if (!d.interfaces?.length) {
        // Conectado pero sin muestra aún: dibuja 0 para que el gráfico “viva”
        setSamples((prev) => [...prev.slice(-(MAX_SAMPLES - 1)), {
          t: Date.now(), downMbps: 0, upMbps: 0,
        }])
        setState('live')
        setSource(d.source || 'none')
        setErrMsg(d.source === 'none'
          ? 'API del router aún sin tráfico — reintentando…'
          : '')
        return
      }
      const picked = pickWanInterfaces(d.interfaces, d.wanInterface || null)
      const rxBps = picked.reduce((s, i) => s + (Number(i.rxBps) || 0), 0)
      const txBps = picked.reduce((s, i) => s + (Number(i.txBps) || 0), 0)
      const downMbps = bytesPerSecToMbps(rxBps)
      const upMbps = bytesPerSecToMbps(txBps)
      setIfaceLabel(picked.map((i) => i.iface).join(', '))
      setSource(d.source || 'api')
      setSamples((prev) => [...prev.slice(-(MAX_SAMPLES - 1)), {
        t: Date.now(),
        downMbps: Math.round(downMbps * 1000) / 1000,
        upMbps: Math.round(upMbps * 1000) / 1000,
      }])
      setState('live')
      setErrMsg('')
    } catch (e: any) {
      setState('error')
      setErrMsg(e.response?.data?.error || e.message || 'Error')
    }
  }, [API, routerId])

  useEffect(() => {
    setSamples([])
    setState(routerId ? 'loading' : 'idle')
    setErrMsg('')
    if (!routerId) return
    void poll()
    const id = setInterval(() => void poll(), pollMs)
    return () => clearInterval(id)
  }, [poll, pollMs, routerId])

  const last = samples[samples.length - 1]
  const yMax = useMemo(() => {
    const peak = Math.max(0.5, ...samples.flatMap((s) => [s.downMbps, s.upMbps]))
    return Math.ceil(peak * 1.25 * 10) / 10
  }, [samples])

  if (!routerId) {
    return (
      <div className={`fn-card-elevated p-6 ${className}`}>
        <p className="text-sm font-semibold text-ink">Uso de ancho de banda</p>
        <p className="text-sm text-ink-muted mt-2">
          Conecta un MikroTik o EdgeRouter para ver bajada/subida en tiempo real.
        </p>
      </div>
    )
  }

  return (
    <div className={`fn-panel ${className}`}>
      <div className="px-5 pt-4 pb-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Activity className="h-4 w-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
            <h3 className="text-sm font-semibold text-ink">Uso de ancho de banda</h3>
            {state === 'live' && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {source === 'heartbeat' ? 'hb' : 'live'}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {routers.length > 0 && onRouterChange ? (
              <select
                value={routerId}
                onChange={(e) => onRouterChange(Number(e.target.value))}
                className="text-xs rounded-lg border border-line bg-surface-card text-ink px-2 py-1 max-w-[220px]"
              >
                {routers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name || r.hostname || `Router #${r.id}`}
                    {r.status === 'online' ? ' · online' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-ink-muted truncate">{routerName || `Router #${routerId}`}</p>
            )}
            {ifaceLabel && <span className="text-[11px] text-ink-muted">{ifaceLabel} · Mbps</span>}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {last && (
            <>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400/90 font-medium">Bajada</p>
                <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300 tabular-nums leading-tight">{formatMbps(last.downMbps)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wide text-sky-600 dark:text-sky-400/90 font-medium">Subida</p>
                <p className="text-lg font-bold text-sky-700 dark:text-sky-300 tabular-nums leading-tight">{formatMbps(last.upMbps)}</p>
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => void poll()}
            className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-raised"
            title="Actualizar ahora"
          >
            <RefreshCw className={`h-4 w-4 ${state === 'loading' ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="px-2 pb-3 h-[240px]">
        {state === 'error' ? (
          <div className="h-full flex items-center justify-center text-sm text-red-400 px-4 text-center">
            {errMsg || 'No se pudo leer el tráfico del router'}
          </div>
        ) : state === 'idle' && samples.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-sm text-ink-muted gap-1 px-4 text-center">
            <p>{errMsg || 'Sin datos de tráfico aún'}</p>
            <p className="text-xs text-ink-muted">Verifica que el router esté online y con API/túnel activo.</p>
          </div>
        ) : state === 'loading' && samples.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-ink-muted">
            Consultando MikroTik…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={samples} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="bwDownNoc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="bwUpNoc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 6" stroke="#94a3b8" strokeOpacity={0.25} vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={formatClock}
                tick={{ fontSize: 10, fill: '#7a6e60' }}
                minTickGap={40}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, yMax]}
                tickFormatter={(v) => (v >= 1 ? `${v}` : v.toFixed(1))}
                tick={{ fontSize: 10, fill: '#7a6e60' }}
                width={40}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgb(var(--bg-secondary))',
                  border: '1px solid rgb(var(--border))',
                  borderRadius: 10,
                  fontSize: 12,
                  color: 'rgb(var(--text-primary))',
                }}
                labelFormatter={(v) => formatClock(Number(v))}
                formatter={(value: number, name: string) => [
                  formatMbps(Number(value)),
                  name === 'downMbps' ? 'Bajada' : 'Subida',
                ]}
              />
              <Area
                type="monotone"
                dataKey="downMbps"
                name="downMbps"
                stroke="#34d399"
                strokeWidth={2.5}
                fill="url(#bwDownNoc)"
                isAnimationActive={false}
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="upMbps"
                name="upMbps"
                stroke="#38bdf8"
                strokeWidth={2}
                fill="url(#bwUpNoc)"
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {errMsg && state === 'live' && (
        <p className="px-5 pb-2 text-[11px] text-amber-400/90">{errMsg}</p>
      )}

      <div className="px-5 pb-3 flex items-center gap-4 text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 rounded bg-emerald-400" /> Bajada
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 rounded bg-sky-400" /> Subida
        </span>
      </div>
    </div>
  )
}
