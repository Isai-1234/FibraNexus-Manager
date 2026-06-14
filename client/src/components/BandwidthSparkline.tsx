import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

interface Sample { ts: number; rxBps: number; txBps: number }
interface Props {
  routerId: number
  API: string
  className?: string
  pollMs?: number
}

const MAX_PTS = 20
const W = 200
const H = 34

function fmt(bps: number) {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)}M`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)}K`
  return `${bps}b`
}

function buildPaths(samples: Sample[], maxVal: number) {
  const step = W / (MAX_PTS - 1)
  const offset = (MAX_PTS - samples.length) * step

  const pts = (key: 'rxBps' | 'txBps') =>
    samples.map((s, i) => ({
      x: offset + i * step,
      y: H - 2 - ((s[key] || 0) / maxVal) * (H - 4),
    }))

  function toSvg(points: { x: number; y: number }[]) {
    if (points.length < 2) return { line: '', area: '' }
    const segs = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
    const area = `${segs} L${points[points.length - 1].x.toFixed(1)} ${H} L${points[0].x.toFixed(1)} ${H}Z`
    return { line: segs, area }
  }

  return { rx: toSvg(pts('rxBps')), tx: toSvg(pts('txBps')) }
}

export default function BandwidthSparkline({ routerId, API, className = '', pollMs = 3000 }: Props) {
  const [samples, setSamples] = useState<Sample[]>([])
  const [state, setState] = useState<'loading' | 'live' | 'error' | 'idle'>('loading')
  const [errMsg, setErrMsg] = useState('')

  const poll = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/edgeos/${routerId}/bandwidth`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        timeout: 9000,
      })
      const d = res.data
      if (d?.connected && d.interfaces?.length > 0) {
        const rxBps = (d.interfaces as any[]).reduce((s: number, i: any) => s + (Number(i.rxBps) || 0), 0)
        const txBps = (d.interfaces as any[]).reduce((s: number, i: any) => s + (Number(i.txBps) || 0), 0)
        setSamples(prev => [...prev.slice(-(MAX_PTS - 1)), { ts: Date.now(), rxBps, txBps }])
        setState('live')
        setErrMsg(d.source === 'heartbeat' ? 'hb' : '')
      } else {
        setState(d?.error ? 'error' : 'idle')
        if (d?.error) setErrMsg(d.error)
      }
    } catch (e: any) {
      setState('error')
      setErrMsg(e.message || 'timeout')
    }
  }, [API, routerId])

  useEffect(() => {
    poll()
    const id = setInterval(poll, pollMs)
    return () => clearInterval(id)
  }, [poll, pollMs])

  if (state === 'loading') {
    return <div className={`h-12 rounded bg-gray-100 animate-pulse ${className}`} />
  }

  if (state === 'error') {
    return (
      <div className={`text-[10px] text-red-400 font-mono truncate leading-tight ${className}`} title={errMsg}>
        ⚠ {errMsg.slice(0, 55)}
      </div>
    )
  }

  if (state === 'idle' || samples.length === 0) {
    return (
      <div className={`text-[10px] text-gray-400 italic ${className}`}>
        Sin datos de tráfico
      </div>
    )
  }

  const last = samples[samples.length - 1]
  const maxVal = Math.max(1, ...samples.flatMap(s => [s.rxBps, s.txBps]))
  const { rx, tx } = buildPaths(samples, maxVal)

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] font-semibold text-blue-500">↓ {fmt(last.rxBps)}</span>
        {errMsg === 'hb' ? (
          <span className="flex items-center gap-0.5 text-[9px] text-blue-500 font-semibold">
            <span className="w-1 h-1 rounded-full bg-blue-400 inline-block" /> hb
          </span>
        ) : (
          <span className="flex items-center gap-0.5 text-[9px] text-emerald-500 font-semibold">
            <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse inline-block" /> live
          </span>
        )}
        <span className="text-[10px] font-semibold text-orange-500">{fmt(last.txBps)} ↑</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" height={H} preserveAspectRatio="none">
        {rx.area && <path d={rx.area} fill="#3b82f615" />}
        {tx.area && <path d={tx.area} fill="#f9731615" />}
        {rx.line && <path d={rx.line} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
        {tx.line && <path d={tx.line} fill="none" stroke="#f97316" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
      </svg>
    </div>
  )
}
