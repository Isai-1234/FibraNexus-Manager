import { useId, useMemo } from 'react'
import { AlertTriangle, Maximize2, Radio, RefreshCw, Wifi } from 'lucide-react'

type WirelessWarning = { type: string; label: string; severity: string }

interface Props {
  equipment: {
    name?: string
    model?: string
    brand?: string
    ipAddress?: string
    status?: string
    siteName?: string
    wirelessSignal?: number | null
    wirelessRssi?: number | null
    wirelessCcq?: number | null
    wirelessSnr?: number | null
    wirelessTxRate?: number | null
    wirelessRxRate?: number | null
    wirelessWarnings?: WirelessWarning[]
    linkQuality?: number | null
    snmpPolledAt?: string | null
    snmpUptime?: string | null
    snmpPollMethod?: string | null
    wirelessDebugHint?: string | null
  } | null
  siteName?: string
  immersive?: boolean
  onExpand?: () => void
  onRefresh?: () => void
  refreshing?: boolean
  className?: string
}

function signalStrengthPercent(dbm: number | null | undefined) {
  if (dbm == null) return 55
  return Math.min(100, Math.max(8, 100 + dbm))
}

export function computeLinkScore(
  online: boolean,
  signal: number | null,
  ccq: number | null | undefined,
  snr: number | null | undefined,
) {
  if (!online) return 0
  let score = 28
  if (signal != null) score += Math.min(38, Math.max(0, (signal + 75) * 1.4))
  if (ccq != null) score += (ccq / 100) * 22
  if (snr != null) score += Math.min(12, snr * 0.6)
  return Math.min(100, Math.round(score))
}

export function linkTheme(score: number, online: boolean, hasWarning: boolean) {
  if (!online) {
    return {
      primary: '#64748b', secondary: '#475569', rx: '#64748b',
      glow: 'rgba(100,116,139,0.25)', ring: '#475569', label: 'Sin enlace',
    }
  }
  if (hasWarning || score < 45) {
    return {
      primary: '#fbbf24', secondary: '#fb923c', rx: '#f97316',
      glow: 'rgba(251,191,36,0.55)', ring: '#f59e0b', label: 'Requiere atención',
    }
  }
  if (score >= 80) {
    return {
      primary: '#22d3ee', secondary: '#4ade80', rx: '#86efac',
      glow: 'rgba(34,211,238,0.75)', ring: '#22d3ee', label: 'Enlace excelente',
    }
  }
  return {
    primary: '#38bdf8', secondary: '#22d3ee', rx: '#67e8f9',
    glow: 'rgba(56,189,248,0.6)', ring: '#38bdf8', label: 'Enlace estable',
  }
}

function LiteBeamSvg({ uid }: { uid: string }) {
  return (
    <g>
      <ellipse cx="70" cy="118" rx="34" ry="7" fill={`url(#${uid}-shadow)`} />
      <rect x="64" y="102" width="12" height="16" rx="2" fill="#d1d5db" />
      <rect x="58" y="114" width="24" height="5" rx="2" fill="#9ca3af" />
      <path d="M18 88 Q8 55 22 28 Q38 18 52 32 L58 88 Z" fill={`url(#${uid}-dish)`} stroke="#cbd5e1" strokeWidth="0.8" />
      {Array.from({ length: 8 }, (_, i) => (
        <line key={`l${i}`} x1="24" y1={36 + i * 6} x2="48" y2={32 + i * 5} stroke="#cbd5e1" strokeWidth="0.35" opacity="0.45" />
      ))}
      <path d="M122 88 Q132 55 118 28 Q102 18 88 32 L82 88 Z" fill={`url(#${uid}-dish)`} stroke="#cbd5e1" strokeWidth="0.8" />
      {Array.from({ length: 8 }, (_, i) => (
        <line key={`r${i}`} x1="116" y1={36 + i * 6} x2="92" y2={32 + i * 5} stroke="#cbd5e1" strokeWidth="0.35" opacity="0.45" />
      ))}
      <path d="M52 88 L58 32 Q70 24 82 32 L88 88 Z" fill="#fafafa" stroke="#cbd5e1" strokeWidth="0.8" />
      <ellipse cx="70" cy="72" rx="8" ry="5" fill="none" stroke="#94a3b8" strokeWidth="0.7" opacity="0.45" />
      <path d="M66 78 Q70 74 74 78 Q70 84 66 78" fill="none" stroke="#94a3b8" strokeWidth="1" opacity="0.5" />
      <rect x="67" y="38" width="6" height="28" rx="2" fill="#e5e7eb" stroke="#94a3b8" strokeWidth="0.7" />
      <ellipse cx="70" cy="32" rx="9" ry="10" fill="#fafafa" stroke="#94a3b8" strokeWidth="0.9" />
      <circle cx="70" cy="32" r="3" fill="#22d3ee">
        <animate attributeName="r" values="3;5.5;3" dur="2.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.45;1;0.45" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <circle cx="70" cy="32" r="7" fill="none" stroke="#22d3ee" strokeWidth="0.7" opacity="0.4">
        <animate attributeName="r" values="7;16;7" dur="2.6s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.45;0;0.45" dur="2.6s" repeatCount="indefinite" />
      </circle>
    </g>
  )
}

function SectorHornSvg({ uid }: { uid: string }) {
  return (
    <g>
      <ellipse cx="70" cy="118" rx="28" ry="6" fill={`url(#${uid}-shadow)`} />
      <path d="M48 95 L42 118 L52 118 L56 95 Z" fill="#9ca3af" stroke="#64748b" strokeWidth="0.7" />
      <path d="M92 95 L98 118 L88 118 L84 95 Z" fill="#9ca3af" stroke="#64748b" strokeWidth="0.7" />
      <rect x="54" y="108" width="32" height="8" rx="2" fill="#64748b" />
      <path d="M38 95 Q38 60 70 38 Q102 60 102 95 Z" fill={`url(#${uid}-horn)`} stroke="#cbd5e1" strokeWidth="0.8" />
      {[52, 64, 76, 88].map((cy, i) => (
        <ellipse key={cy} cx="70" cy={cy} rx={18 + i * 4} ry={6 + i} fill="none" stroke="#e2e8f0" strokeWidth="0.6" opacity="0.7" />
      ))}
      <ellipse cx="70" cy="40" rx="14" ry="12" fill="#fafafa" stroke="#94a3b8" strokeWidth="1" />
      <ellipse cx="70" cy="40" rx="6" ry="5" fill="#1e293b" opacity="0.12" />
      <circle cx="70" cy="40" r="2.5" fill="#4ade80" opacity="0.9">
        <animate attributeName="opacity" values="0.4;1;0.4" dur="1.8s" repeatCount="indefinite" />
      </circle>
      <ellipse cx="70" cy="96" rx="10" ry="4" fill="#ef4444" opacity="0.9" />
      <rect x="60" y="92" width="20" height="6" rx="2" fill="#dc2626" />
    </g>
  )
}

function QualityRing({ score, color, uid }: { score: number; color: string; uid: string }) {
  const r = 36
  const c = 2 * Math.PI * r
  const offset = c - (score / 100) * c
  return (
    <svg viewBox="0 0 96 96" className="w-20 h-20 sm:w-24 sm:h-24 shrink-0" aria-hidden>
      <defs>
        <linearGradient id={`${uid}-ringGrad`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor="#4ade80" stopOpacity="0.8" />
        </linearGradient>
      </defs>
      <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
      <circle
        cx="48" cy="48" r={r} fill="none"
        stroke={`url(#${uid}-ringGrad)`}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 48 48)"
        style={{ transition: 'stroke-dashoffset 1s ease-out' }}
      />
      <text x="48" y="44" textAnchor="middle" fill="white" fontSize="18" fontWeight="700" fontFamily="system-ui,sans-serif">{score}</text>
      <text x="48" y="58" textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="system-ui,sans-serif" letterSpacing="1">LINK</text>
    </svg>
  )
}

function SignalBeams({
  uid, online, strength, colors, txSpeed, rxSpeed,
}: {
  uid: string
  online: boolean
  strength: number
  colors: { primary: string; secondary: string; rx: string; glow: string }
  txSpeed: number
  rxSpeed: number
}) {
  if (!online) return null

  const beamCount = strength >= 75 ? 9 : strength >= 50 ? 6 : 4
  const txDur = Math.max(0.7, 2.8 - (txSpeed / 150))
  const rxDur = Math.max(0.7, 2.8 - (rxSpeed / 150))

  const paths = useMemo(() => Array.from({ length: beamCount }, (_, i) => {
    const t = (i - (beamCount - 1) / 2) / (beamCount - 1 || 1)
    const y = t * 26
    const curve = t * 10
    const d = `M 158 58 Q ${290 + curve} ${56 + y} 418 54`
    return { id: i, d, y, delay: i * 0.14, color: i % 2 === 0 ? colors.primary : colors.secondary }
  }), [beamCount, colors.primary, colors.secondary])

  return (
    <g filter={`url(#${uid}-beamGlow)`}>
      {paths.map((b) => (
        <g key={`tx-${b.id}`}>
          <path
            d={b.d}
            fill="none"
            stroke={b.color}
            strokeWidth={b.id === Math.floor(beamCount / 2) ? 2.2 : 1.4}
            strokeLinecap="round"
            strokeDasharray="5 12 2 16"
            opacity={0.25 + (strength / 100) * 0.5}
            className="beam-tx"
            style={{ animationDuration: `${txDur}s`, animationDelay: `${b.delay}s` }}
          />
        </g>
      ))}

      <path
        d="M 158 58 Q 290 56 418 54"
        fill="none"
        stroke={`url(#${uid}-beamTx)`}
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeDasharray="10 18 4 22"
        opacity={0.55 + (strength / 100) * 0.35}
        className="beam-tx beam-core"
        style={{ animationDuration: `${txDur * 0.9}s` }}
      />

      {paths.slice(0, Math.ceil(beamCount / 2)).map((b) => (
        <path
          key={`rx-${b.id}`}
          d={b.d}
          fill="none"
          stroke={colors.rx}
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeDasharray="4 14 2 18"
          opacity={0.2 + (strength / 100) * 0.35}
          className="beam-rx"
          style={{ animationDuration: `${rxDur}s`, animationDelay: `${b.delay + 0.3}s` }}
        />
      ))}

      {[0, 1, 2, 3].map((p) => (
        <circle key={`ptx-${p}`} r="2" fill={colors.primary} className="beam-particle">
          <animateMotion dur={`${txDur * 1.1}s`} repeatCount="indefinite" begin={`${p * 0.35}s`} path="M 158 58 Q 290 56 418 54" />
          <animate attributeName="opacity" values="0;1;1;0" dur={`${txDur * 1.1}s`} repeatCount="indefinite" begin={`${p * 0.35}s`} />
        </circle>
      ))}

      {[0, 1, 2].map((p) => (
        <circle key={`prx-${p}`} r="1.8" fill={colors.rx} className="beam-particle">
          <animateMotion dur={`${rxDur * 1.1}s`} repeatCount="indefinite" begin={`${p * 0.4}s`} path="M 418 54 Q 290 56 158 58" />
          <animate attributeName="opacity" values="0;0.9;0.9;0" dur={`${rxDur * 1.1}s`} repeatCount="indefinite" begin={`${p * 0.4}s`} />
        </circle>
      ))}
    </g>
  )
}

function MetricBar({ value, max, ok, color }: { value: number; max: number; ok: boolean; color: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${pct}%`, background: ok ? color : '#fbbf24' }}
      />
    </div>
  )
}

export default function CpeLinkVisualizer({
  equipment, siteName, immersive = false, onExpand, onRefresh, refreshing = false, className = '',
}: Props) {
  const uid = useId().replace(/:/g, '')

  if (!equipment) {
    return (
      <div className="rounded-3xl bg-[#070b14] p-10 text-center border border-white/[0.06]">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/[0.03] flex items-center justify-center">
          <Radio className="h-7 w-7 text-slate-600" />
        </div>
        <p className="text-sm text-slate-500">Sin antena CPE vinculada</p>
        <p className="text-xs text-slate-600 mt-1">Asigna una LiteBeam en la pestaña Equipos</p>
      </div>
    )
  }

  const online = equipment.status === 'online'
  const signal = equipment.wirelessSignal ?? equipment.wirelessRssi ?? null
  const beamStrength = signalStrengthPercent(signal)
  const ccq = equipment.wirelessCcq
  const snr = equipment.wirelessSnr
  const warnings = equipment.wirelessWarnings || []
  const apLabel = siteName || equipment.siteName || 'Torre sectorial'
  const linkScore = computeLinkScore(online, signal, ccq, snr)
  const theme = linkTheme(linkScore, online, warnings.length > 0)
  const txSpeed = equipment.wirelessTxRate || beamStrength * 1.2
  const rxSpeed = equipment.wirelessRxRate || beamStrength * 1.5

  return (
    <div className={`relative overflow-hidden rounded-3xl border border-white/[0.08] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.8)] cpe-viz ${immersive ? 'min-h-[70vh] flex flex-col' : ''} ${className}`}>
      <style>{`
        .cpe-viz {
          background: radial-gradient(120% 80% at 50% 0%, #0f1a2e 0%, #060a12 45%, #030508 100%);
        }
        @keyframes beam-tx-flow {
          to { stroke-dashoffset: -90; }
        }
        @keyframes beam-rx-flow {
          to { stroke-dashoffset: 90; }
        }
        @keyframes aurora-drift {
          0%, 100% { transform: translateX(0) scale(1); opacity: 0.4; }
          50% { transform: translateX(20px) scale(1.05); opacity: 0.65; }
        }
        @keyframes grid-fade {
          0%, 100% { opacity: 0.03; }
          50% { opacity: 0.06; }
        }
        @media (prefers-reduced-motion: no-preference) {
          .beam-tx { animation: beam-tx-flow linear infinite; }
          .beam-rx { animation: beam-rx-flow linear infinite; }
          .aurora-blob { animation: aurora-drift 8s ease-in-out infinite; }
          .floor-grid { animation: grid-fade 6s ease-in-out infinite; }
        }
        .beam-core { filter: drop-shadow(0 0 8px ${theme.glow}); }
      `}</style>

      {/* aurora atmosphere */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="aurora-blob absolute -top-20 left-1/4 w-72 h-72 rounded-full bg-cyan-500/[0.07] blur-3xl" />
        <div className="aurora-blob absolute top-10 right-1/4 w-56 h-56 rounded-full bg-emerald-500/[0.05] blur-3xl" style={{ animationDelay: '-3s' }} />
      </div>

      {/* header */}
      <div className="relative px-6 pt-6 pb-2 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <QualityRing score={linkScore} color={theme.ring} uid={uid} />
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-[0.25em] text-cyan-400/50 font-medium">Radio enlace</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.05] text-slate-400 border border-white/[0.06]">
                {theme.label}
              </span>
            </div>
            <h3 className="text-xl font-semibold text-white tracking-tight">{equipment.name || 'Antena CPE'}</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              {equipment.brand || 'Ubiquiti'} {equipment.model || 'LiteBeam M5'}
            </p>
            <p className="text-xs font-mono text-slate-600 mt-1">{equipment.ipAddress || 'sin IP'}</p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-1.5">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                title="Actualizar SNMP"
                className="p-2 rounded-xl bg-white/[0.05] border border-white/[0.08] text-slate-400 hover:text-cyan-300 hover:border-cyan-500/30 transition disabled:opacity-40"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            )}
            {onExpand && (
              <button
                type="button"
                onClick={onExpand}
                title="Pantalla completa"
                className="p-2 rounded-xl bg-white/[0.05] border border-white/[0.08] text-slate-400 hover:text-cyan-300 hover:border-cyan-500/30 transition"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            )}
          </div>
          <span className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold backdrop-blur-sm ${
            online
              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-400/20 shadow-[0_0_20px_-5px_rgba(52,211,153,0.4)]'
              : 'bg-red-500/10 text-red-300 border border-red-400/20'
          }`}>
            <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]' : 'bg-red-400'}`} />
            {online ? 'En línea' : 'Sin enlace'}
          </span>
          {equipment.snmpUptime && (
            <span className="text-[10px] text-slate-600 font-mono">uptime {equipment.snmpUptime}</span>
          )}
        </div>
      </div>

      {/* escena SVG */}
      <div className={`relative px-1 sm:px-3 pb-1 ${immersive ? 'flex-1 flex items-center' : ''}`}>
        <svg viewBox="0 0 580 230" className={`w-full h-auto ${immersive ? 'max-h-[min(52vh,520px)]' : ''}`} aria-label="Enlace LiteBeam a sectorial horn">
          <defs>
            <radialGradient id={`${uid}-shadow`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(0,0,0,0.5)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            <linearGradient id={`${uid}-dish`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#e2e8f0" />
            </linearGradient>
            <linearGradient id={`${uid}-horn`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#f8fafc" />
              <stop offset="100%" stopColor="#e2e8f0" />
            </linearGradient>
            <filter id={`${uid}-beamGlow`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <linearGradient id={`${uid}-beamTx`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={theme.primary} stopOpacity="0.1" />
              <stop offset="40%" stopColor={theme.primary} stopOpacity="1" />
              <stop offset="100%" stopColor={theme.secondary} stopOpacity="0.4" />
            </linearGradient>
            <linearGradient id={`${uid}-horizon`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="100%" stopColor="rgba(34,211,238,0.04)" />
            </linearGradient>
          </defs>

          {/* grid piso */}
          <g className="floor-grid" opacity="0.04">
            {Array.from({ length: 12 }, (_, i) => (
              <line key={`h${i}`} x1="0" y1={140 + i * 8} x2="580" y2={140 + i * 8} stroke="#94a3b8" strokeWidth="0.5" />
            ))}
            {Array.from({ length: 16 }, (_, i) => (
              <line key={`v${i}`} x1={i * 38} y1="130" x2={i * 38 - 80} y2="230" stroke="#94a3b8" strokeWidth="0.5" />
            ))}
          </g>

          <rect x="0" y="130" width="580" height="100" fill={`url(#${uid}-horizon)`} />

          {/* torre fondo */}
          <g opacity="0.08" transform="translate(440, 8)">
            <line x1="24" y1="0" x2="24" y2="160" stroke="#cbd5e1" strokeWidth="4" />
            <line x1="0" y1="35" x2="48" y2="35" stroke="#cbd5e1" strokeWidth="2.5" />
            <line x1="4" y1="70" x2="44" y2="70" stroke="#cbd5e1" strokeWidth="2.5" />
            <line x1="0" y1="105" x2="48" y2="105" stroke="#cbd5e1" strokeWidth="2.5" />
          </g>

          <SignalBeams uid={uid} online={online} strength={beamStrength} colors={theme} txSpeed={txSpeed} rxSpeed={rxSpeed} />

          {/* leader lines estilo Starlink */}
          {online && signal != null && (
            <g opacity="0.6">
              <line x1="148" y1="32" x2="200" y2="12" stroke="#475569" strokeWidth="0.6" strokeDasharray="2 3" />
              <rect x="200" y="2" width="90" height="18" rx="9" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
              <text x="245" y="14" textAnchor="middle" fill="#94a3b8" fontSize="8" fontFamily="system-ui,sans-serif">
                {signal} dBm
              </text>
            </g>
          )}

          <g transform="translate(12, 36) scale(0.98)">
            <LiteBeamSvg uid={uid} />
            <text x="70" y="134" textAnchor="middle" fill="#475569" fontSize="8.5" fontFamily="system-ui,sans-serif">CPE · Cliente</text>
          </g>

          <g transform="translate(418, 32) scale(0.98)">
            <SectorHornSvg uid={uid} />
            <text x="70" y="134" textAnchor="middle" fill="#475569" fontSize="8.5" fontFamily="system-ui,sans-serif">
              {apLabel.length > 16 ? `${apLabel.slice(0, 14)}…` : apLabel}
            </text>
          </g>

          {/* leyenda TX/RX */}
          {online && (
            <g transform="translate(248, 198)" fontFamily="system-ui,sans-serif" fontSize="8" fill="#64748b">
              <path d="M0 4 L6 0 L6 8 Z" fill="#22d3ee" opacity="0.8" transform="rotate(45 3 4)" />
              <text x="12" y="7">Subida</text>
              <path d="M72 4 L78 0 L78 8 Z" fill="#4ade80" opacity="0.8" transform="rotate(-135 75 4)" />
              <text x="84" y="7">Bajada</text>
            </g>
          )}
        </svg>
      </div>

      {/* métricas glass */}
      <div className="relative grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 pt-2 border-t border-white/[0.05]">
        {[
          {
            label: 'Señal', value: signal != null ? `${signal}` : '—', unit: 'dBm',
            ok: signal != null && signal >= -65, bar: signal != null ? Math.abs(signal) : 0, max: 90, color: theme.primary,
          },
          {
            label: 'CCQ', value: ccq != null ? `${ccq}` : '—', unit: '%',
            ok: ccq == null || ccq >= 70, bar: ccq ?? 0, max: 100, color: theme.secondary,
          },
          {
            label: 'SNR', value: snr != null ? `${snr}` : '—', unit: 'dB',
            ok: snr == null || snr >= 15, bar: snr ?? 0, max: 35, color: '#4ade80',
          },
          {
            label: 'Calidad', value: `${linkScore}`, unit: '/100',
            ok: linkScore >= 60, bar: linkScore, max: 100, color: theme.ring,
          },
        ].map((m) => (
          <div
            key={m.label}
            className="rounded-2xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] px-4 py-3 hover:bg-white/[0.05] transition-colors"
          >
            <p className="text-[10px] uppercase tracking-widest text-slate-500">{m.label}</p>
            <p className="mt-1 flex items-baseline gap-1">
              <span className={`text-lg font-bold tabular-nums ${m.ok ? 'text-white' : 'text-amber-300'}`}>{m.value}</span>
              <span className="text-[10px] text-slate-600">{m.unit}</span>
            </p>
            {m.bar > 0 && <MetricBar value={m.bar} max={m.max} ok={m.ok} color={m.color} />}
          </div>
        ))}
      </div>

      {warnings.length > 0 && (
        <div className="mx-4 mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.08] backdrop-blur-sm px-4 py-3 space-y-2">
          {warnings.map((w) => (
            <div key={w.label} className="flex items-start gap-2.5 text-sm text-amber-100/90">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
              <span>{w.label}</span>
            </div>
          ))}
        </div>
      )}

      {!signal && online && (
        <div className="mx-4 mb-4 flex flex-col gap-1 text-xs text-slate-500 rounded-xl bg-white/[0.02] border border-white/[0.04] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Wifi className="h-3.5 w-3.5 text-cyan-600/60 shrink-0" />
            <span>
              {equipment.wirelessDebugHint || (
                equipment.snmpPollMethod === 'router'
                  ? 'Antena online vía MikroTik (IP privada). Las métricas dBm/CCQ usan MIB Ubiquiti — pulsa ↻ para reintentar.'
                  : 'Antena online — habilita SNMP en airOS (Services → SNMP) con la misma community del equipo.'
              )}
            </span>
          </div>
          {equipment.snmpPollMethod === 'router' && (
            <p className="text-[10px] text-slate-600 pl-6">
              Poll enrutado: Render → túnel → MikroTik Torre → 172.16.x.x (no requiere IP pública en la antena).
            </p>
          )}
        </div>
      )}

      {equipment.snmpPolledAt && (
        <p className="px-6 pb-4 text-[10px] text-slate-700 font-mono">
          snmp · {new Date(equipment.snmpPolledAt).toLocaleString('es-CL')}
        </p>
      )}
    </div>
  )
}
