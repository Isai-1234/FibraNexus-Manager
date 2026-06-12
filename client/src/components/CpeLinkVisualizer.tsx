import { AlertTriangle, Radio, Wifi } from 'lucide-react'

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
  } | null
  siteName?: string
}

function signalStrengthPercent(dbm: number | null | undefined) {
  if (dbm == null) return 55
  return Math.min(100, Math.max(12, 100 + dbm))
}

function linkColors(strength: number, online: boolean, hasWarning: boolean) {
  if (!online) return { primary: '#64748b', secondary: '#475569', glow: 'rgba(100,116,139,0.3)' }
  if (hasWarning || strength < 35) return { primary: '#fbbf24', secondary: '#f97316', glow: 'rgba(251,191,36,0.55)' }
  if (strength >= 70) return { primary: '#22d3ee', secondary: '#4ade80', glow: 'rgba(34,211,238,0.7)' }
  return { primary: '#38bdf8', secondary: '#22d3ee', glow: 'rgba(56,189,248,0.6)' }
}

function LiteBeamSvg() {
  return (
    <g transform="translate(0, 0)">
      <ellipse cx="70" cy="118" rx="34" ry="7" fill="rgba(0,0,0,0.45)" />
      {/* mount */}
      <rect x="64" y="102" width="12" height="16" rx="2" fill="#cbd5e1" />
      <rect x="58" y="114" width="24" height="5" rx="2" fill="#94a3b8" />
      {/* left wing - perforated */}
      <path d="M18 88 Q8 55 22 28 Q38 18 52 32 L58 88 Z" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="1" />
      <path d="M24 82 Q16 58 26 38 Q36 32 46 42" fill="none" stroke="#e2e8f0" strokeWidth="0.6" opacity="0.8" />
      {[38, 48, 58, 68, 78].map((y) => (
        <line key={y} x1="22" y1={y} x2="50" y2={y - 8} stroke="#cbd5e1" strokeWidth="0.4" opacity="0.5" />
      ))}
      {/* right wing */}
      <path d="M122 88 Q132 55 118 28 Q102 18 88 32 L82 88 Z" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="1" />
      {[38, 48, 58, 68, 78].map((y) => (
        <line key={y} x1="118" y1={y} x2="90" y2={y - 8} stroke="#cbd5e1" strokeWidth="0.4" opacity="0.5" />
      ))}
      {/* center panel */}
      <path d="M52 88 L58 32 Q70 24 82 32 L88 88 Z" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1" />
      <ellipse cx="70" cy="72" rx="8" ry="5" fill="none" stroke="#94a3b8" strokeWidth="0.8" opacity="0.5" />
      {/* Ubiquiti U mark */}
      <path d="M66 78 Q70 74 74 78 Q70 84 66 78" fill="none" stroke="#94a3b8" strokeWidth="1.2" opacity="0.6" />
      {/* feed arm + radio housing — origen señal */}
      <rect x="67" y="38" width="6" height="28" rx="2" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="0.8" />
      <ellipse cx="70" cy="32" rx="9" ry="10" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1" />
      <circle cx="70" cy="32" r="3" fill="#38bdf8">
        <animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="70" cy="32" r="6" fill="none" stroke="#38bdf8" strokeWidth="0.8" opacity="0.5">
        <animate attributeName="r" values="6;14;6" dur="2.2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;0;0.5" dur="2.2s" repeatCount="indefinite" />
      </circle>
    </g>
  )
}

function SectorHornSvg() {
  return (
    <g transform="translate(0, 0)">
      <ellipse cx="70" cy="118" rx="28" ry="6" fill="rgba(0,0,0,0.4)" />
      {/* mount bracket */}
      <path d="M48 95 L42 118 L52 118 L56 95 Z" fill="#94a3b8" stroke="#64748b" strokeWidth="0.8" />
      <path d="M92 95 L98 118 L88 118 L84 95 Z" fill="#94a3b8" stroke="#64748b" strokeWidth="0.8" />
      <rect x="54" y="108" width="32" height="8" rx="2" fill="#64748b" />
      {/* horn body - stepped rings */}
      <path d="M38 95 Q38 60 70 38 Q102 60 102 95 Z" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="1" />
      <ellipse cx="70" cy="52" rx="22" ry="8" fill="none" stroke="#e2e8f0" strokeWidth="0.8" />
      <ellipse cx="70" cy="64" rx="28" ry="10" fill="none" stroke="#e2e8f0" strokeWidth="0.8" />
      <ellipse cx="70" cy="78" rx="32" ry="12" fill="none" stroke="#e2e8f0" strokeWidth="0.8" />
      {/* front face */}
      <ellipse cx="70" cy="40" rx="14" ry="12" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1.2" />
      <ellipse cx="70" cy="40" rx="6" ry="5" fill="#1e293b" opacity="0.15" />
      {/* rear red cap */}
      <ellipse cx="70" cy="96" rx="10" ry="4" fill="#ef4444" opacity="0.85" />
      <rect x="60" y="92" width="20" height="6" rx="2" fill="#dc2626" />
    </g>
  )
}

function SignalBeams({
  online,
  strength,
  colors,
}: {
  online: boolean
  strength: number
  colors: { primary: string; secondary: string; glow: string }
}) {
  if (!online) return null

  const beamCount = strength >= 70 ? 7 : strength >= 45 ? 5 : 3
  const speed = strength >= 70 ? 1.1 : strength >= 45 ? 1.6 : 2.4

  const beams = Array.from({ length: beamCount }, (_, i) => {
    const t = (i - (beamCount - 1) / 2) / (beamCount - 1 || 1)
    const yOffset = t * 22
    const curve = t * 8
    const delay = i * 0.18
    const color = i % 3 === 0 ? colors.secondary : colors.primary
    return { yOffset, curve, delay, color, id: i }
  })

  return (
    <g className="signal-beams" filter="url(#beamGlow)">
      {beams.map((b) => (
        <path
          key={b.id}
          d={`M 148 52 Q ${280 + b.curve} ${50 + b.yOffset} 412 48`}
          fill="none"
          stroke={b.color}
          strokeWidth={b.id === Math.floor(beamCount / 2) ? 2.5 : 1.8}
          strokeLinecap="round"
          strokeDasharray="6 14 3 18"
          opacity={0.35 + (strength / 100) * 0.55}
          className="signal-beam-path"
          style={{
            animationDuration: `${speed}s`,
            animationDelay: `${b.delay}s`,
          }}
        />
      ))}
      {/* haz central más brillante */}
      <path
        d="M 148 52 Q 280 50 412 48"
        fill="none"
        stroke="url(#beamGradient)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="12 20 6 24"
        opacity={0.5 + (strength / 100) * 0.4}
        className="signal-beam-path signal-beam-core"
        style={{ animationDuration: `${speed * 0.85}s` }}
      />
      {/* partículas viajando */}
      {[0, 1, 2].map((p) => (
        <circle
          key={p}
          r="2.5"
          fill={colors.primary}
          opacity="0.9"
          className="signal-particle"
          style={{
            animationDuration: `${speed * 1.2}s`,
            animationDelay: `${p * 0.45}s`,
          }}
        >
          <animateMotion
            dur={`${speed * 1.2}s`}
            repeatCount="indefinite"
            begin={`${p * 0.45}s`}
            path="M 148 52 Q 280 50 412 48"
          />
        </circle>
      ))}
    </g>
  )
}

export default function CpeLinkVisualizer({ equipment, siteName }: Props) {
  if (!equipment) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-8 text-center text-slate-400 border border-white/5">
        <Radio className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">Sin antena CPE vinculada a este abonado</p>
      </div>
    )
  }

  const online = equipment.status === 'online'
  const signal = equipment.wirelessSignal ?? equipment.wirelessRssi ?? null
  const beamStrength = signalStrengthPercent(signal)
  const ccq = equipment.wirelessCcq
  const warnings = equipment.wirelessWarnings || []
  const apLabel = siteName || equipment.siteName || 'Torre / sectorial horn'
  const colors = linkColors(beamStrength, online, warnings.length > 0)

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#06080f] via-[#0a1020] to-[#0d1528] border border-white/10 shadow-2xl">
      <style>{`
        @keyframes signal-beam-flow {
          0% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -80; }
        }
        @keyframes signal-particle-fade {
          0%, 100% { opacity: 0; }
          15%, 85% { opacity: 0.95; }
        }
        .signal-beam-path {
          animation: signal-beam-flow linear infinite;
        }
        .signal-beam-core {
          filter: drop-shadow(0 0 6px ${colors.glow});
        }
        .signal-particle {
          animation: signal-particle-fade linear infinite;
        }
      `}</style>

      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_45%,rgba(34,211,238,0.07),transparent)] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_80%,rgba(59,130,246,0.06),transparent_50%)] pointer-events-none" />

      <div className="relative px-6 pt-6 pb-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-300/50 font-medium">Enlace inalámbrico PtP</p>
          <h3 className="text-xl font-semibold text-white mt-1">{equipment.name || 'Antena CPE'}</h3>
          <p className="text-sm text-slate-400 mt-0.5">
            {equipment.brand || 'Ubiquiti'} {equipment.model || 'LiteBeam M5'} · {equipment.ipAddress || 'sin IP'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
            online ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/25' : 'bg-red-500/15 text-red-300 border border-red-400/25'
          }`}>
            <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            {online ? 'En línea' : 'Sin enlace'}
          </span>
          {equipment.snmpUptime && (
            <span className="text-xs text-slate-500">uptime {equipment.snmpUptime}</span>
          )}
        </div>
      </div>

      {/* Escena principal SVG */}
      <div className="relative px-2 sm:px-4 pb-2">
        <svg
          viewBox="0 0 560 200"
          className="w-full h-auto max-h-[280px]"
          aria-label="Visualización enlace LiteBeam a sectorial horn"
        >
          <defs>
            <filter id="beamGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id="beamGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={colors.primary} stopOpacity="0.2" />
              <stop offset="35%" stopColor={colors.primary} stopOpacity="1" />
              <stop offset="65%" stopColor={colors.secondary} stopOpacity="1" />
              <stop offset="100%" stopColor={colors.secondary} stopOpacity="0.3" />
            </linearGradient>
            <radialGradient id="sceneGlow" cx="50%" cy="45%" r="50%">
              <stop offset="0%" stopColor="rgba(34,211,238,0.08)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>

          <rect width="560" height="200" fill="url(#sceneGlow)" />

          {/* torre difusa fondo */}
          <g opacity="0.12" transform="translate(420, 20)">
            <line x1="20" y1="0" x2="20" y2="140" stroke="#94a3b8" strokeWidth="3" />
            <line x1="0" y1="30" x2="40" y2="30" stroke="#94a3b8" strokeWidth="2" />
            <line x1="5" y1="60" x2="35" y2="60" stroke="#94a3b8" strokeWidth="2" />
            <line x1="0" y1="90" x2="40" y2="90" stroke="#94a3b8" strokeWidth="2" />
          </g>

          <SignalBeams online={online} strength={beamStrength} colors={colors} />

          {/* LiteBeam CPE — izquierda */}
          <g transform="translate(8, 28) scale(0.95)">
            <LiteBeamSvg />
            <text x="70" y="132" textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="system-ui,sans-serif">CPE cliente</text>
          </g>

          {/* Sector horn — derecha */}
          <g transform="translate(412, 24) scale(0.95)">
            <SectorHornSvg />
            <text x="70" y="132" textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="system-ui,sans-serif">
              {apLabel.length > 18 ? `${apLabel.slice(0, 16)}…` : apLabel}
            </text>
          </g>

          {/* etiqueta señal flotante */}
          {signal != null && online && (
            <g transform="translate(230, 18)">
              <rect x="0" y="0" width="100" height="26" rx="13" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.15)" />
              <text x="50" y="17" textAnchor="middle" fill="#e0f2fe" fontSize="11" fontFamily="ui-monospace,monospace" fontWeight="600">
                {signal} dBm{ccq != null ? ` · ${ccq}%` : ''}
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/5 border-t border-white/10">
        {[
          { label: 'Señal', value: signal != null ? `${signal} dBm` : '—', ok: signal != null && signal >= -65 },
          { label: 'RSSI', value: equipment.wirelessRssi != null ? `${equipment.wirelessRssi} dBm` : '—', ok: true },
          { label: 'CCQ', value: ccq != null ? `${ccq}%` : '—', ok: ccq == null || ccq >= 70 },
          { label: 'SNR', value: equipment.wirelessSnr != null ? `${equipment.wirelessSnr} dB` : '—', ok: equipment.wirelessSnr == null || equipment.wirelessSnr >= 15 },
        ].map((m) => (
          <div key={m.label} className="px-4 py-3 bg-black/25">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">{m.label}</p>
            <p className={`text-sm font-semibold mt-0.5 ${m.ok ? 'text-white' : 'text-amber-300'}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {warnings.length > 0 && (
        <div className="px-4 py-3 border-t border-amber-500/20 bg-amber-500/10 space-y-2">
          {warnings.map((w) => (
            <div key={w.label} className="flex items-start gap-2 text-sm text-amber-100">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
              <span>{w.label}</span>
            </div>
          ))}
        </div>
      )}

      {!signal && online && (
        <div className="px-4 py-3 border-t border-white/5 flex items-center gap-2 text-xs text-slate-500">
          <Wifi className="h-3.5 w-3.5" />
          Enlace activo — activa SNMP en airOS para ver dBm, CCQ y alertas de alineación en tiempo real.
        </div>
      )}

      {equipment.snmpPolledAt && (
        <p className="px-4 pb-3 text-[10px] text-slate-600">
          Última lectura SNMP: {new Date(equipment.snmpPolledAt).toLocaleString('es-CL')}
        </p>
      )}
    </div>
  )
}
