import { useId, useMemo, useState } from 'react'
import { AlertTriangle, Maximize2, Radio, RefreshCw, Wifi } from 'lucide-react'
import cpeArt from '../assets/link/cpe-litebeam.svg'
import towerArt from '../assets/link/tower-sector.svg'

/** Layout unificado viewBox 580×250 — imágenes y haces comparten coordenadas */
type ImgBox = {
  x: number
  y: number
  w: number
  h: number
  align: 'xMaxYMax' | 'xMinYMax'
  srcAspect: number
  hornRel: { x: number; y: number }
}

const LINK_LAYOUT = {
  viewW: 580,
  viewH: 250,
  /** true = SVG en assets/link/; false = dibujo integrado fallback */
  useAssetFiles: true,
  cpeBox: {
    x: 6, y: 118, w: 192, h: 128,
    align: 'xMaxYMax',
    srcAspect: 1088 / 991,
    hornRel: { x: 0.95, y: 0.36 },
  } satisfies ImgBox,
  towerBox: {
    x: 390, y: 6, w: 184, h: 232,
    align: 'xMinYMax',
    srcAspect: 1088 / 991,
    hornRel: { x: 0.05, y: 0.50 },
  } satisfies ImgBox,
  vectorCpe: { tx: 74, ty: 96, scale: 1.38, horn: { x: 70, y: 32 } },
  vectorTower: { tx: 320, ty: 66, scale: 1.38, horn: { x: 70, y: 40 } },
} as const

function renderedImageRect(box: ImgBox) {
  const boxAspect = box.w / box.h
  const srcAspect = box.srcAspect
  let rw = box.w
  let rh = box.h
  if (srcAspect > boxAspect) {
    rh = box.w / srcAspect
  } else {
    rw = box.h * srcAspect
  }
  const ox = box.align === 'xMaxYMax' ? box.x + box.w - rw : box.x
  const oy = box.y + box.h - rh
  return { x: ox, y: oy, w: rw, h: rh }
}

function hornFromBox(box: ImgBox) {
  const rect = renderedImageRect(box)
  return {
    x: rect.x + rect.w * box.hornRel.x,
    y: rect.y + rect.h * box.hornRel.y,
  }
}

function hornFromVector(v: { tx: number; ty: number; scale: number; horn: { x: number; y: number } }) {
  return {
    x: v.tx + v.horn.x * v.scale,
    y: v.ty + v.horn.y * v.scale,
  }
}

function linkBeamEndpoints(useAssetFiles: boolean) {
  if (useAssetFiles) {
    return {
      cpe: hornFromBox(LINK_LAYOUT.cpeBox),
      tower: hornFromBox(LINK_LAYOUT.towerBox),
    }
  }
  return {
    cpe: hornFromVector(LINK_LAYOUT.vectorCpe),
    tower: hornFromVector(LINK_LAYOUT.vectorTower),
  }
}

const LINK_BEAM = {
  viewW: LINK_LAYOUT.viewW,
  viewH: LINK_LAYOUT.viewH,
  ...linkBeamEndpoints(LINK_LAYOUT.useAssetFiles),
} as const

/** SVG vectorial puro — sin filtro (trazos claros sobre fondo transparente) */
const LINK_ART_FILTER = 'none'

export const LINK_VISUAL_ASSETS = {
  cpe: cpeArt,
  tower: towerArt,
} as const

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
  isStale?: boolean
  onExpand?: () => void
  onRefresh?: () => void
  refreshing?: boolean
  className?: string
  cpeImageUrl?: string
  towerImageUrl?: string
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
    <g opacity="0.98">
      <ellipse cx="70" cy="118" rx="34" ry="7" fill={`url(#${uid}-shadow)`} />
      <rect x="64" y="102" width="12" height="16" rx="2" fill="#e2e8f0" />
      <rect x="58" y="114" width="24" height="5" rx="2" fill="#cbd5e1" />
      <path d="M18 88 Q8 55 22 28 Q38 18 52 32 L58 88 Z" fill={`url(#${uid}-dish)`} stroke="#e2e8f0" strokeWidth="1" />
      {Array.from({ length: 8 }, (_, i) => (
        <line key={`l${i}`} x1="24" y1={36 + i * 6} x2="48" y2={32 + i * 5} stroke="#e2e8f0" strokeWidth="0.45" opacity="0.55" />
      ))}
      <path d="M122 88 Q132 55 118 28 Q102 18 88 32 L82 88 Z" fill={`url(#${uid}-dish)`} stroke="#e2e8f0" strokeWidth="1" />
      {Array.from({ length: 8 }, (_, i) => (
        <line key={`r${i}`} x1="116" y1={36 + i * 6} x2="92" y2={32 + i * 5} stroke="#e2e8f0" strokeWidth="0.45" opacity="0.55" />
      ))}
      <path d="M52 88 L58 32 Q70 24 82 32 L88 88 Z" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1" />
      <ellipse cx="70" cy="72" rx="8" ry="5" fill="none" stroke="#cbd5e1" strokeWidth="0.8" opacity="0.55" />
      <path d="M66 78 Q70 74 74 78 Q70 84 66 78" fill="none" stroke="#cbd5e1" strokeWidth="1.1" opacity="0.6" />
      <rect x="67" y="38" width="6" height="28" rx="2" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="0.8" />
      <ellipse cx="70" cy="32" rx="9" ry="10" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
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
    <g opacity="0.98">
      <ellipse cx="70" cy="118" rx="28" ry="6" fill={`url(#${uid}-shadow)`} />
      <path d="M48 95 L42 118 L52 118 L56 95 Z" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="0.8" />
      <path d="M92 95 L98 118 L88 118 L84 95 Z" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="0.8" />
      <rect x="54" y="108" width="32" height="8" rx="2" fill="#94a3b8" />
      <path d="M38 95 Q38 60 70 38 Q102 60 102 95 Z" fill={`url(#${uid}-horn)`} stroke="#e2e8f0" strokeWidth="1" />
      {[52, 64, 76, 88].map((cy, i) => (
        <ellipse key={cy} cx="70" cy={cy} rx={18 + i * 4} ry={6 + i} fill="none" stroke="#f1f5f9" strokeWidth="0.7" opacity="0.75" />
      ))}
      <ellipse cx="70" cy="40" rx="14" ry="12" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
      <ellipse cx="70" cy="40" rx="6" ry="5" fill="#1e293b" opacity="0.15" />
      <circle cx="70" cy="40" r="2.5" fill="#4ade80" opacity="1">
        <animate attributeName="opacity" values="0.4;1;0.4" dur="1.8s" repeatCount="indefinite" />
      </circle>
      <ellipse cx="70" cy="96" rx="10" ry="4" fill="#ef4444" opacity="0.9" />
      <rect x="60" y="92" width="20" height="6" rx="2" fill="#dc2626" />
    </g>
  )
}

function LinkHardwareSvg({
  uid,
  online,
  cpeSrc,
  towerSrc,
}: {
  uid: string
  online: boolean
  cpeSrc: string
  towerSrc: string
}) {
  const [cpeImgOk, setCpeImgOk] = useState(true)
  const [towerImgOk, setTowerImgOk] = useState(true)
  const { cpeBox, towerBox, vectorCpe, vectorTower, useAssetFiles } = LINK_LAYOUT
  const beam = linkBeamEndpoints(useAssetFiles)
  const artStyle = { filter: LINK_ART_FILTER, opacity: 1 }
  const showCpeImg = useAssetFiles && Boolean(cpeSrc) && cpeImgOk
  const showTowerImg = useAssetFiles && Boolean(towerSrc) && towerImgOk

  return (
    <g aria-hidden>
      {showCpeImg ? (
        <image
          href={cpeSrc}
          x={cpeBox.x}
          y={cpeBox.y}
          width={cpeBox.w}
          height={cpeBox.h}
          preserveAspectRatio="xMaxYMax meet"
          style={artStyle}
          onError={() => setCpeImgOk(false)}
        />
      ) : (
        <g transform={`translate(${vectorCpe.tx}, ${vectorCpe.ty}) scale(${vectorCpe.scale})`}>
          <LiteBeamSvg uid={uid} />
        </g>
      )}

      {showTowerImg ? (
        <image
          href={towerSrc}
          x={towerBox.x}
          y={towerBox.y}
          width={towerBox.w}
          height={towerBox.h}
          preserveAspectRatio="xMinYMax meet"
          style={artStyle}
          onError={() => setTowerImgOk(false)}
        />
      ) : (
        <g transform={`translate(${vectorTower.tx}, ${vectorTower.ty}) scale(${vectorTower.scale})`}>
          <SectorHornSvg uid={uid} />
        </g>
      )}

      {online && (
        <>
          <circle cx={beam.cpe.x} cy={beam.cpe.y} r="5" fill="#22d3ee" opacity="0.95">
            <animate attributeName="r" values="4;6.5;4" dur="2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.7;1;0.7" dur="2s" repeatCount="indefinite" />
          </circle>
          <circle cx={beam.tower.x} cy={beam.tower.y} r="4" fill="#4ade80" opacity="0.95">
            <animate attributeName="r" values="3;5.5;3" dur="2.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.65;1;0.65" dur="2.2s" repeatCount="indefinite" />
          </circle>
        </>
      )}
    </g>
  )
}

function LinkHardwareLabels({ apLabel }: { apLabel: string }) {
  return (
    <>
      <p className="absolute left-[2%] bottom-[1%] z-10 text-[10px] sm:text-xs text-slate-500 text-center pointer-events-none">
        CPE · Cliente
      </p>
      <p className="absolute right-[2%] bottom-[1%] z-10 text-[10px] sm:text-xs text-slate-500 text-center truncate max-w-[38%] pointer-events-none">
        {apLabel.length > 18 ? `${apLabel.slice(0, 16)}…` : apLabel}
      </p>
    </>
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

  const { cpe, tower } = LINK_BEAM
  const midX = (cpe.x + tower.x) / 2
  // Arco suave hacia arriba: el control point desplazado -18px convierte la
  // bezier cuadrática en una parábola visible (en línea recta sería plana).
  const midY = (cpe.y + tower.y) / 2 - 18
  const corePath = `M ${cpe.x} ${cpe.y} Q ${midX} ${midY} ${tower.x} ${tower.y}`
  const rxPath = `M ${tower.x} ${tower.y} Q ${midX} ${midY} ${cpe.x} ${cpe.y}`

  const beamCount = strength >= 75 ? 9 : strength >= 50 ? 6 : 4
  const txDur = Math.max(0.7, 2.8 - (txSpeed / 150))
  const rxDur = Math.max(0.7, 2.8 - (rxSpeed / 150))

  const paths = useMemo(() => Array.from({ length: beamCount }, (_, i) => {
    const t = (i - (beamCount - 1) / 2) / (beamCount - 1 || 1)
    const yOff = t * 24
    const curve = t * 6
    const d = `M ${cpe.x} ${cpe.y} Q ${midX + curve} ${midY + yOff} ${tower.x} ${tower.y}`
    return { id: i, d, delay: i * 0.14, color: i % 2 === 0 ? colors.primary : colors.secondary }
  }), [beamCount, colors.primary, colors.secondary, cpe.x, cpe.y, tower.x, tower.y, midX, midY])

  return (
    <g>
      {/* ── Backbone: línea sólida permanente, visible con o sin animación ── */}
      <path
        d={corePath}
        fill="none"
        stroke={colors.primary}
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity={0.22}
      />

      {/* ── Halo de emisión — puntas CPE y torre ── */}
      <circle cx={cpe.x} cy={cpe.y} r="5" fill={colors.primary} opacity="0.2">
        <animate attributeName="r" values="4;11;4" dur="2.2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.12;0.32;0.12" dur="2.2s" repeatCount="indefinite" />
      </circle>
      <circle cx={tower.x} cy={tower.y} r="5" fill={colors.rx} opacity="0.15">
        <animate attributeName="r" values="3;10;3" dur="2.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.1;0.28;0.1" dur="2.4s" repeatCount="indefinite" />
      </circle>

      {/* ── Pulso en punto medio del arco ── */}
      <circle cx={midX} cy={midY} r="3" fill={colors.primary} opacity="0.3">
        <animate attributeName="r" values="2;14;2" dur="2.8s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.3;0;0.3" dur="2.8s" repeatCount="indefinite" />
      </circle>

      {/* ── Haces TX en abanico ── */}
      {paths.map((b) => (
        <path
          key={`tx-${b.id}`}
          d={b.d}
          fill="none"
          stroke={b.color}
          strokeWidth={b.id === Math.floor(beamCount / 2) ? 2.4 : 1.5}
          strokeLinecap="round"
          strokeDasharray="7 10 2 13"
          opacity={Math.max(0.32, 0.25 + (strength / 100) * 0.5)}
          className="beam-tx"
          style={{ animationDuration: `${txDur}s`, animationDelay: `${b.delay}s` }}
        />
      ))}

      {/* ── Core beam: gradiente + flujo + pulso de opacidad ── */}
      <path
        d={corePath}
        fill="none"
        stroke={`url(#${uid}-beamTx)`}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray="14 10 3 12"
        opacity={Math.max(0.72, 0.55 + (strength / 100) * 0.35)}
        className="beam-core"
        style={{ animationDuration: `${txDur * 0.9}s, 2.4s` }}
      />

      {/* ── Haces RX (retorno) ── */}
      {paths.slice(0, Math.ceil(beamCount / 2)).map((b) => (
        <path
          key={`rx-${b.id}`}
          d={b.d}
          fill="none"
          stroke={colors.rx}
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeDasharray="4 14 2 18"
          opacity={Math.max(0.22, 0.2 + (strength / 100) * 0.35)}
          className="beam-rx"
          style={{ animationDuration: `${rxDur}s`, animationDelay: `${b.delay + 0.3}s` }}
        />
      ))}

      {/* ── Partículas TX ── */}
      {[0, 1, 2, 3].map((p) => (
        <circle key={`ptx-${p}`} r="2.2" fill={colors.primary}>
          <animateMotion dur={`${txDur * 1.1}s`} repeatCount="indefinite" begin={`${p * 0.35}s`} path={corePath} />
          <animate attributeName="opacity" values="0;1;1;0" dur={`${txDur * 1.1}s`} repeatCount="indefinite" begin={`${p * 0.35}s`} />
        </circle>
      ))}

      {/* ── Partículas RX ── */}
      {[0, 1, 2].map((p) => (
        <circle key={`prx-${p}`} r="1.8" fill={colors.rx}>
          <animateMotion dur={`${rxDur * 1.1}s`} repeatCount="indefinite" begin={`${p * 0.4}s`} path={rxPath} />
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
  equipment, siteName, immersive = false, isStale = false, onExpand, onRefresh, refreshing = false,
  className = '',
  cpeImageUrl = LINK_VISUAL_ASSETS.cpe,
  towerImageUrl = LINK_VISUAL_ASSETS.tower,
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
          from { stroke-dashoffset: 0; }
          to   { stroke-dashoffset: -90; }
        }
        @keyframes beam-rx-flow {
          from { stroke-dashoffset: 0; }
          to   { stroke-dashoffset: 90; }
        }
        @keyframes beam-core-pulse {
          0%, 100% { opacity: 0.62; }
          50%       { opacity: 1; }
        }
        @keyframes aurora-drift {
          0%, 100% { transform: translateX(0) scale(1); opacity: 0.4; }
          50% { transform: translateX(20px) scale(1.05); opacity: 0.65; }
        }
        @keyframes grid-fade {
          0%, 100% { opacity: 0.03; }
          50% { opacity: 0.055; }
        }
        @media (prefers-reduced-motion: no-preference) {
          .beam-tx {
            animation-name: beam-tx-flow;
            animation-timing-function: linear;
            animation-iteration-count: infinite;
          }
          .beam-rx {
            animation-name: beam-rx-flow;
            animation-timing-function: linear;
            animation-iteration-count: infinite;
          }
          .beam-core {
            animation-name: beam-tx-flow, beam-core-pulse;
            animation-timing-function: linear, ease-in-out;
            animation-iteration-count: infinite, infinite;
          }
          .aurora-blob { animation: aurora-drift 8s ease-in-out infinite; }
          .floor-grid  { animation: grid-fade 6s ease-in-out infinite; }
        }
        .beam-core { filter: drop-shadow(0 0 10px ${theme.glow}); }
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
            online && !isStale
              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-400/20 shadow-[0_0_20px_-5px_rgba(52,211,153,0.4)]'
              : online && isStale
                ? 'bg-amber-500/10 text-amber-300 border border-amber-400/20'
                : 'bg-red-500/10 text-red-300 border border-red-400/20'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              online && !isStale ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]'
              : online && isStale ? 'bg-amber-400'
              : 'bg-red-400'
            }`} />
            {online && !isStale ? 'En línea' : online && isStale ? 'Datos desactualizados' : 'Desconectada'}
          </span>
          {isStale && (
            <span className="text-[10px] text-amber-600/80 font-mono flex items-center gap-1">
              Última lectura: {equipment.snmpPolledAt ? new Date(equipment.snmpPolledAt).toLocaleTimeString('es-CL') : 'desconocida'}
            </span>
          )}
          {!isStale && equipment.snmpUptime && (
            <span className="text-[10px] text-slate-600 font-mono">uptime {equipment.snmpUptime}</span>
          )}
        </div>
      </div>

      {/* banner offline — visible cuando CPE desconectada, sin animaciones */}
      {!online && (
        <div className="mx-4 mb-1 flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-red-300">Antena desconectada</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {isStale
                ? 'Sin datos recientes. Pulsa ↻ para verificar el estado actual.'
                : `Sin respuesta SNMP${equipment.snmpPolledAt ? ` — verificado ${new Date(equipment.snmpPolledAt).toLocaleString('es-CL')}` : ''}.`}
            </p>
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="ml-auto shrink-0 px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs hover:bg-red-500/20 transition disabled:opacity-40"
            >
              {refreshing ? '…' : '↻ Verificar'}
            </button>
          )}
        </div>
      )}

      {/* escena enlace */}
      <div className={`relative px-1 sm:px-3 pb-1 ${immersive ? 'flex-1 flex items-center justify-center' : ''}`}>
        <div className={`relative w-full mx-auto aspect-[580/250] overflow-hidden ${immersive ? 'max-w-[1300px]' : 'max-w-[742px]'}`}>
          <svg
            viewBox="0 0 580 250"
            className="absolute inset-0 w-full h-full"
            aria-hidden
          >
            <defs>
              <clipPath id={`${uid}-gridClip`}>
                <rect x="0" y="158" width="580" height="95" />
              </clipPath>
              <linearGradient id={`${uid}-beamTx`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%"   stopColor={theme.primary}   stopOpacity="0.55" />
                <stop offset="45%"  stopColor={theme.primary}   stopOpacity="1" />
                <stop offset="100%" stopColor={theme.secondary}  stopOpacity="0.65" />
              </linearGradient>
              <linearGradient id={`${uid}-horizon`} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="transparent" />
                <stop offset="100%" stopColor="rgba(34,211,238,0.04)" />
              </linearGradient>
              <radialGradient id={`${uid}-shadow`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#000" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#000" stopOpacity="0" />
              </radialGradient>
              <linearGradient id={`${uid}-dish`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f8fafc" />
                <stop offset="100%" stopColor="#cbd5e1" />
              </linearGradient>
              <linearGradient id={`${uid}-horn`} x1="50%" y1="0%" x2="50%" y2="100%">
                <stop offset="0%" stopColor="#f1f5f9" />
                <stop offset="100%" stopColor="#94a3b8" />
              </linearGradient>
            </defs>

            <g className="floor-grid" opacity="0.04" clipPath={`url(#${uid}-gridClip)`}>
              {Array.from({ length: 12 }, (_, i) => (
                <line key={`h${i}`} x1="0" y1={140 + i * 8} x2="580" y2={140 + i * 8} stroke="#94a3b8" strokeWidth="0.5" />
              ))}
              {Array.from({ length: 16 }, (_, i) => (
                <line key={`v${i}`} x1={i * 38} y1="130" x2={i * 38 - 80} y2="230" stroke="#94a3b8" strokeWidth="0.5" />
              ))}
            </g>

            <rect x="0" y="130" width="580" height="100" fill={`url(#${uid}-horizon)`} />

            <SignalBeams uid={uid} online={online} strength={beamStrength} colors={theme} txSpeed={txSpeed} rxSpeed={rxSpeed} />

            <LinkHardwareSvg
              uid={uid}
              online={online}
              cpeSrc={cpeImageUrl}
              towerSrc={towerImageUrl}
            />

            {online && signal != null && (
              <g opacity="0.65">
                <line
                  x1={LINK_BEAM.cpe.x}
                  y1={LINK_BEAM.cpe.y - 18}
                  x2={(LINK_BEAM.cpe.x + LINK_BEAM.tower.x) / 2}
                  y2={LINK_BEAM.cpe.y - 32}
                  stroke="#475569"
                  strokeWidth="0.6"
                  strokeDasharray="2 3"
                />
                <rect
                  x={(LINK_BEAM.cpe.x + LINK_BEAM.tower.x) / 2 - 45}
                  y={LINK_BEAM.cpe.y - 42}
                  width="90"
                  height="18"
                  rx="9"
                  fill="rgba(255,255,255,0.06)"
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth="0.5"
                />
                <text
                  x={(LINK_BEAM.cpe.x + LINK_BEAM.tower.x) / 2}
                  y={LINK_BEAM.cpe.y - 30}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="8"
                  fontFamily="system-ui,sans-serif"
                >
                  {signal} dBm
                </text>
              </g>
            )}

            {online && (
              <g
                transform={`translate(${(LINK_BEAM.cpe.x + LINK_BEAM.tower.x) / 2 - 40}, ${LINK_BEAM.viewH - 28})`}
                fontFamily="system-ui,sans-serif"
                fontSize="8"
                fill="#64748b"
              >
                <path d="M0 4 L6 0 L6 8 Z" fill="#22d3ee" opacity="0.8" transform="rotate(45 3 4)" />
                <text x="12" y="7">Subida</text>
                <path d="M72 4 L78 0 L78 8 Z" fill="#4ade80" opacity="0.8" transform="rotate(-135 75 4)" />
                <text x="84" y="7">Bajada</text>
              </g>
            )}
          </svg>

          <LinkHardwareLabels apLabel={apLabel} />
        </div>
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
