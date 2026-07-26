import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Activity, RefreshCw } from 'lucide-react'

type Sample = { t: number; downMbps: number; upMbps: number }

type Props = {
  API: string
  routerId: number | null
  routerName?: string
  pollMs?: number
  className?: string
}

const MAX_SAMPLES = 40 // ~2 min a 3s

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
  // Si no hay WAN clara, toma la interfaz con más tráfico (evita sumar LAN+WAN)
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
  API, routerId, routerName, pollMs = 3000, className = '',
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
        timeout: 12000,
      })
      const d = res.data
      if (!d?.connected || !d.interfaces?.length) {
        setState(d?.error ? 'error' : 'idle')
        if (d?.error) setErrMsg(d.error)
        return
      }
      const picked = pickWanInterfaces(d.interfaces, d.wanInterface || null)
      const rxBps = picked.reduce((s, i) => s + (Number(i.rxBps) || 0), 0)
      const txBps = picked.reduce((s, i) => s + (Number(i.txBps) || 0), 0)
      // En MikroTik: rx = tráfico entrante al router (bajada clientes desde internet suele ser tx en WAN)
      // Convención ISP: "Bajada" = hacia abonados = tx en interfaz WAN; "Subida" = desde abonados = rx en WAN
      // Pero monitor-traffic rx/tx es desde el punto de vista del router. En WAN:
      //   rx-bits = internet → router (download hacia la red)
      //   tx-bits = router → internet (upload desde la red)
      // Eso coincide con bajada/subida del ISP hacia internet. Para el abonado es al revés en LAN.
      // Usamos convención: Down = rx (tráfico recibido en la iface), Up = tx.
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
      <div className={`rounded-xl border border-line bg-surface-card p-6 ${className}`}>
        <p className="text-sm font-semibold text-ink">Uso de ancho de banda</p>
        <p className="text-sm text-ink-muted mt-2">
          Conecta un MikroTik o EdgeRouter para ver bajada/subida en tiempo real.
        </p>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border border-line bg-surface-card overflow-hidden ${className}`}>
      <div className="px-5 pt-4 pb-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-500 shrink-0" />
            <h3 className="text-sm font-semibold text-ink">Uso de ancho de banda</h3>
            {state === 'live' && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {source === 'heartbeat' ? 'hb' : 'live'}
              </span>
            )}
          </div>
          <p className="text-xs text-ink-muted mt-1 truncate">
            {routerName || `Router #${routerId}`}
            {ifaceLabel ? ` · ${ifaceLabel}` : ''}
            {' · Mbps en vivo'}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {last && (
            <>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wide text-sky-600/90 font-medium">Bajada</p>
                <p className="text-lg font-bold text-sky-700 tabular-nums leading-tight">{formatMbps(last.downMbps)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wide text-violet-600/90 font-medium">Subida</p>
                <p className="text-lg font-bold text-violet-700 tabular-nums leading-tight">{formatMbps(last.upMbps)}</p>
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

      <div className="px-2 pb-3 h-[220px]">
        {state === 'error' ? (
          <div className="h-full flex items-center justify-center text-sm text-red-600 px-4 text-center">
            {errMsg || 'No se pudo leer el tráfico del router'}
          </div>
        ) : state === 'idle' || (state === 'loading' && samples.length === 0) ? (
          <div className="h-full flex items-center justify-center text-sm text-ink-muted">
            {state === 'loading' ? 'Consultando MikroTik…' : 'Sin datos de tráfico aún'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={samples} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="bwDown" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="bwUp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 6" stroke="currentColor" className="text-line opacity-60" vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={formatClock}
                tick={{ fontSize: 10, fill: 'currentColor' }}
                className="text-ink-muted"
                minTickGap={40}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, yMax]}
                tickFormatter={(v) => (v >= 1 ? `${v}` : v.toFixed(1))}
                tick={{ fontSize: 10, fill: 'currentColor' }}
                className="text-ink-muted"
                width={36}
                axisLine={false}
                tickLine={false}
                unit=""
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface-card, #fff)',
                  border: '1px solid var(--line, #e2e8f0)',
                  borderRadius: 10,
                  fontSize: 12,
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
                stroke="#0ea5e9"
                strokeWidth={2}
                fill="url(#bwDown)"
                isAnimationActive={false}
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="upMbps"
                name="upMbps"
                stroke="#8b5cf6"
                strokeWidth={2}
                fill="url(#bwUp)"
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="px-5 pb-3 flex items-center gap-4 text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 rounded bg-sky-500" /> Bajada (rx)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 rounded bg-violet-500" /> Subida (tx)
        </span>
      </div>
    </div>
  )
}
