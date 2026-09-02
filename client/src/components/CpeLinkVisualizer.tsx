import { useId, useMemo, useState } from 'react'
import { AlertTriangle, Maximize2, Radio, RefreshCw, Wifi } from 'lucide-react'
import cpeArt from '../assets/link/cpe-dish@3x.png'
import towerArt from '../assets/link/tower-sector@3x.png'
import { useThemeMode } from '../lib/useThemeMode'

/** Layout responsivo: viewBox 580×280; centros en % del ancho (hardware + etiquetas) */
type ImgBox = {
  x: number
  y: number
  w: number
  h: number
  align: 'xMaxYMax' | 'xMinYMax' | 'xMidYMax'
  srcAspect: number
  hornRel: { x: number; y: number }
}

const LINK_SCENE = {
  viewW: 580,
  viewH: 280,
  groundY: 248,
  /** 18% izquierda · 82% derecha — separación clara con espacio de enlace al centro */
  cpeCenterPct: 0.18,
  towerCenterPct: 0.82,
} as const

const LINK_SCENE_X = {
  cpe: LINK_SCENE.viewW * LINK_SCENE.cpeCenterPct,
  tower: LINK_SCENE.viewW * LINK_SCENE.towerCenterPct,
} as const

function boxFromCenter(centerX: number, groundY: number, w: number, h: number) {
  return { x: centerX - w / 2, y: groundY - h, w, h }
}

const LINK_LAYOUT = {
  viewW: LINK_SCENE.viewW,
  viewH: LINK_SCENE.viewH,
  useAssetFiles: true,
  cpeBox: {
    ...boxFromCenter(LINK_SCENE_X.cpe, LINK_SCENE.groundY, 92, 108),
    align: 'xMidYMax',
    srcAspect: 526 / 474,
    hornRel: { x: 0.82, y: 0.40 },
  } satisfies ImgBox,
  towerBox: {
    ...boxFromCenter(LINK_SCENE_X.tower, LINK_SCENE.groundY, 268, 210),
    align: 'xMidYMax',
    srcAspect: 586 / 426,
    hornRel: { x: 0.42, y: 0.26 },
  } satisfies ImgBox,
  vectorCpe: { tx: LINK_SCENE_X.cpe - 62, ty: 118, scale: 1.24, horn: { x: 70, y: 32 } },
  vectorTower: { tx: LINK_SCENE_X.tower - 62, ty: 58, scale: 1.42, horn: { x: 70, y: 40 } },
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
  const ox = box.align === 'xMaxYMax'
    ? box.x + box.w - rw
    : box.align === 'xMidYMax'
      ? box.x + (box.w - rw) / 2
      : box.x
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
  const cpe = useAssetFiles ? hornFromBox(LINK_LAYOUT.cpeBox) : hornFromVector(LINK_LAYOUT.vectorCpe)
  const tower = useAssetFiles ? hornFromBox(LINK_LAYOUT.towerBox) : hornFromVector(LINK_LAYOUT.vectorTower)
  return {
    cpe,
    tower,
    mid: {
      x: (cpe.x + tower.x) / 2,
      y: (cpe.y + tower.y) / 2,
    },
  }
}

function getLinkBeam(useAssetFiles = LINK_LAYOUT.useAssetFiles) {
  return {
    viewW: LINK_LAYOUT.viewW,
    viewH: LINK_LAYOUT.viewH,
    ...linkBeamEndpoints(useAssetFiles),
  }
}

/** SVG vectorial puro — sin filtro (trazos claros sobre fondo transparente) */
const LINK_ART_FILTER = 'none'

export const LINK_VISUAL_ASSETS = {
  cpe: cpeArt,
  tower: towerArt,
} as const

type WirelessWarning = { type: string; label: string; severity: string }

interface EquipmentMetrics {
    name?: string
    model?: string
    brand?: string
    ipAddress?: string
    displayIp?: string
    status?: string
    statusLabel?: string
    siteName?: string
    wirelessSignal?: number | null
    wirelessRssi?: number | null
    wirelessCcq?: number | null
    wirelessSnr?: number | null
    wirelessTxRate?: number | null
    wirelessRxRate?: number | null
    wirelessWarnings?: WirelessWarning[]
    apStationSignal?: number | null
    apStationCcq?: number | null
    apStationSnr?: number | null
    apStationTxRate?: number | null
    apStationRxRate?: number | null
    apStationWarnings?: WirelessWarning[]
    linkQuality?: number | null
    snmpPolledAt?: string | null
    snmpUptime?: string | null
    snmpPollMethod?: string | null
    wirelessDebugHint?: string | null
    linkDown?: boolean
    linkPeer?: EquipmentMetrics | null
  }

interface Props {
  equipment: EquipmentMetrics | null
  clientName?: string
  siteName?: string
  immersive?: boolean
  onExpand?: () => void
  onRefresh?: () => void
  refreshing?: boolean
  isStale?: boolean
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
        <g transform={`translate(${LINK_SCENE_X.cpe}, ${LINK_SCENE.groundY})`}>
          <image
            href={cpeSrc}
            x={-cpeBox.w / 2}
            y={-cpeBox.h}
            width={cpeBox.w}
            height={cpeBox.h}
            preserveAspectRatio="xMidYMax meet"
            style={artStyle}
            onError={() => setCpeImgOk(false)}
          />
        </g>
      ) : (
        <g transform={`translate(${vectorCpe.tx}, ${vectorCpe.ty}) scale(${vectorCpe.scale})`}>
          <LiteBeamSvg uid={uid} />
        </g>
      )}

      {showTowerImg ? (
        <g transform={`translate(${LINK_SCENE_X.tower}, ${LINK_SCENE.groundY})`}>
          <image
            href={towerSrc}
            x={-towerBox.w / 2}
            y={-towerBox.h}
            width={towerBox.w}
            height={towerBox.h}
            preserveAspectRatio="xMidYMax meet"
            style={artStyle}
            onError={() => setTowerImgOk(false)}
          />
        </g>
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

function LinkHardwareLabelsSvg({ cpeLabel, apLabel, labelFill = '#64748b' }: { cpeLabel: string; apLabel: string; labelFill?: string }) {
  const labelY = LINK_SCENE.viewH - 6
  const fit = (text: string, max = 22) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
  const labelProps = {
    y: labelY,
    textAnchor: 'middle' as const,
    fill: labelFill,
    fontSize: 10,
    fontFamily: 'system-ui,sans-serif',
  }

  return (
    <g aria-hidden pointerEvents="none">
      <text x={LINK_SCENE_X.cpe} {...labelProps}>
        <title>{cpeLabel}</title>
        {fit(cpeLabel)}
      </text>
      <text x={LINK_SCENE_X.tower} {...labelProps}>
        <title>{apLabel}</title>
        {fit(apLabel)}
      </text>
    </g>
  )
}

function QualityRing({ score, color, uid, isLight }: { score: number; color: string; uid: string; isLight?: boolean }) {
  const r = 36
  const c = 2 * Math.PI * r
  const offset = c - (score / 100) * c
  const trackStroke = isLight ? 'rgba(40,35,30,0.08)' : 'rgba(255,255,255,0.06)'
  const scoreFill = isLight ? '#28231e' : '#ffffff'
  const linkFill = isLight ? '#7a6e60' : '#64748b'
  return (
    <svg viewBox="0 0 96 96" className="w-20 h-20 sm:w-24 sm:h-24 shrink-0" aria-hidden>
      <defs>
        <linearGradient id={`${uid}-ringGrad`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor="#4ade80" stopOpacity="0.8" />
        </linearGradient>
      </defs>
      <circle cx="48" cy="48" r={r} fill="none" stroke={trackStroke} strokeWidth="6" />
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
      <text x="48" y="44" textAnchor="middle" fill={scoreFill} fontSize="18" fontWeight="700" fontFamily="system-ui,sans-serif">{score}</text>
      <text x="48" y="58" textAnchor="middle" fill={linkFill} fontSize="8" fontFamily="system-ui,sans-serif" letterSpacing="1">LINK</text>
    </svg>
  )
}

function SignalBeams({
  uid, online, strength, colors, txSpeed, rxSpeed, beam,
}: {
  uid: string
  online: boolean
  strength: number
  colors: { primary: string; secondary: string; rx: string; glow: string }
  txSpeed: number
  rxSpeed: number
  beam: ReturnType<typeof getLinkBeam>
}) {
  if (!online) return null

  const { cpe, tower, mid } = beam
  const txPath = `M ${cpe.x} ${cpe.y} L ${tower.x} ${tower.y}`
  const rxPath = `M ${tower.x} ${tower.y} L ${cpe.x} ${cpe.y}`
  const dx = tower.x - cpe.x
  const dy = tower.y - cpe.y
  const segLen = Math.hypot(dx, dy) || 1

  const beamCount = strength >= 75 ? 5 : strength >= 50 ? 4 : 3
  const txDur = Math.max(0.7, 2.8 - (txSpeed / 150))
  const rxDur = Math.max(0.7, 2.8 - (rxSpeed / 150))

  const paths = useMemo(() => Array.from({ length: beamCount }, (_, i) => {
    const t = (i - (beamCount - 1) / 2) / (beamCount - 1 || 1)
    const off = t * 10
    const ox = (-dy / segLen) * off
    const oy = (dx / segLen) * off
    const d = `M ${cpe.x + ox} ${cpe.y + oy} L ${tower.x + ox} ${tower.y + oy}`
    return { id: i, d, delay: i * 0.16, color: i % 2 === 0 ? colors.primary : colors.secondary }
  }), [beamCount, colors.primary, colors.secondary, cpe.x, cpe.y, tower.x, tower.y, dx, dy, segLen])

  return (
    <g filter={`url(#${uid}-beamGlow)`}>
      <circle cx={cpe.x} cy={cpe.y} r="6" fill={colors.primary} opacity="0.15">
        <animate attributeName="r" values="4;9;4" dur="2.2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.1;0.35;0.1" dur="2.2s" repeatCount="indefinite" />
      </circle>
      <circle cx={tower.x} cy={tower.y} r="5" fill={colors.rx} opacity="0.12">
        <animate attributeName="r" values="3;8;3" dur="2.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.08;0.3;0.08" dur="2.4s" repeatCount="indefinite" />
      </circle>

      {paths.map((b) => (
        <path
          key={`tx-${b.id}`}
          d={b.d}
          fill="none"
          stroke={b.color}
          strokeWidth={b.id === Math.floor(beamCount / 2) ? 2 : 1.2}
          strokeLinecap="round"
          strokeDasharray="6 14"
          opacity={0.22 + (strength / 100) * 0.45}
          className="beam-tx"
          style={{ animationDuration: `${txDur}s`, animationDelay: `${b.delay}s` }}
        />
      ))}

      <path
        d={txPath}
        fill="none"
        stroke={`url(#${uid}-beamTx)`}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray="8 16"
        opacity={0.55 + (strength / 100) * 0.35}
        className="beam-tx beam-core"
        style={{ animationDuration: `${txDur * 0.9}s` }}
      />

      <path
        d={rxPath}
        fill="none"
        stroke={colors.rx}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeDasharray="5 12"
        opacity={0.25 + (strength / 100) * 0.35}
        className="beam-rx"
        style={{ animationDuration: `${rxDur}s`, animationDelay: '0.25s' }}
      />

      {[0, 1, 2].map((p) => (
        <circle key={`ptx-${p}`} r="2" fill={colors.primary} className="beam-particle">
          <animateMotion dur={`${txDur * 1.1}s`} repeatCount="indefinite" begin={`${p * 0.4}s`} path={txPath} />
          <animate attributeName="opacity" values="0;1;1;0" dur={`${txDur * 1.1}s`} repeatCount="indefinite" begin={`${p * 0.4}s`} />
        </circle>
      ))}

      {[0, 1].map((p) => (
        <circle key={`prx-${p}`} r="1.8" fill={colors.rx} className="beam-particle">
          <animateMotion dur={`${rxDur * 1.1}s`} repeatCount="indefinite" begin={`${p * 0.45}s`} path={rxPath} />
          <animate attributeName="opacity" values="0;0.9;0.9;0" dur={`${rxDur * 1.1}s`} repeatCount="indefinite" begin={`${p * 0.45}s`} />
        </circle>
      ))}
    </g>
  )
}

function MetricBar({ value, max, ok, color }: { value: number; max: number; ok: boolean; color: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div className="mt-2 h-1 rounded-full bg-surface-raised overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${pct}%`, background: ok ? color : '#fbbf24' }}
      />
    </div>
  )
}

export default function CpeLinkVisualizer({
  equipment, clientName, siteName, immersive = false, onExpand, onRefresh, refreshing = false,
  isStale = false, className = '',
  cpeImageUrl = LINK_VISUAL_ASSETS.cpe,
  towerImageUrl = LINK_VISUAL_ASSETS.tower,
}: Props) {
  const uid = useId().replace(/:/g, '')
  const isLight = useThemeMode() === 'light'
  const svgLabelFill = isLight ? '#7a6e60' : '#64748b'
  const metricCardClass = 'rounded-2xl bg-surface-raised/80 border border-line px-3 py-2.5 hover:bg-surface-raised transition-colors'
  const metricValueOk = 'text-ink'
  const metricValueWarn = 'text-amber-700 dark:text-amber-300'

  if (!equipment) {
    return (
      <div className="fn-card-elevated p-10 text-center rounded-3xl">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-raised flex items-center justify-center">
          <Radio className="h-7 w-7 text-ink-muted" />
        </div>
        <p className="text-sm text-ink-muted">Sin antena CPE vinculada</p>
        <p className="text-xs text-ink-muted mt-1">Asigna una LiteBeam en la pestaña Equipos</p>
      </div>
    )
  }

  const online = equipment.status === 'online'
  const linkDown = Boolean(equipment.linkDown) || !online
  const signal = linkDown ? null : (equipment.wirelessSignal ?? equipment.wirelessRssi ?? null)
  const beamStrength = signalStrengthPercent(signal)
  const ccq = linkDown ? null : equipment.wirelessCcq
  const snr = linkDown ? null : equipment.wirelessSnr
  const warnings = linkDown
    ? []
    : [...(equipment.wirelessWarnings || []), ...(equipment.apStationWarnings || [])]
  const peer = equipment.linkPeer || null
  const peerOnline = peer?.status === 'online'
  // Sectorial: vista del AP hacia este CPE (ubntStaTable), no el auto-poll del AP.
  const peerSignal = linkDown ? null : (equipment.apStationSignal ?? null)
  const peerCcq = linkDown ? null : (equipment.apStationCcq ?? null)
  const peerSnr = linkDown ? null : (equipment.apStationSnr ?? null)
  const apLabel = siteName || equipment.siteName || peer?.name || 'Torre sectorial'
  const cpeOwner = (clientName || '').trim()
  const cpeLabel = cpeOwner ? `CPE de ${cpeOwner}` : 'CPE del abonado'
  const linkScore = computeLinkScore(online, signal, ccq, snr)
  const theme = linkTheme(linkScore, online, warnings.length > 0)
  const txSpeed = equipment.wirelessTxRate || beamStrength * 1.2
  const rxSpeed = equipment.wirelessRxRate || beamStrength * 1.5
  const linkBeam = useMemo(() => getLinkBeam(), [])

  const metricSide = (
    label: string,
    vals: { signal: number | null; ccq: number | null; snr: number | null; quality: number },
    note?: string | null,
  ) => (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-sky-700/70 dark:text-cyan-400/60 font-medium px-1">{label}</p>
      {note && <p className="text-[11px] text-ink-muted px-1 -mt-1">{note}</p>}
      <div className="grid grid-cols-2 gap-2">
        {[
          {
            label: 'Señal', value: vals.signal != null ? `${vals.signal}` : '—', unit: 'dBm',
            ok: vals.signal != null && vals.signal >= -65, bar: vals.signal != null ? Math.abs(vals.signal) : 0, max: 90, color: theme.primary,
          },
          {
            label: 'CCQ', value: vals.ccq != null ? `${vals.ccq}` : '—', unit: '%',
            ok: vals.ccq == null || vals.ccq >= 70, bar: vals.ccq ?? 0, max: 100, color: theme.secondary,
          },
          {
            label: 'SNR', value: vals.snr != null ? `${vals.snr}` : '—', unit: 'dB',
            ok: vals.snr == null || vals.snr >= 15, bar: vals.snr ?? 0, max: 35, color: '#4ade80',
          },
          {
            label: 'Calidad', value: `${vals.quality}`, unit: '/100',
            ok: vals.quality >= 60, bar: vals.quality, max: 100, color: theme.ring,
          },
        ].map((m) => (
          <div
            key={`${label}-${m.label}`}
            className={metricCardClass}
          >
            <p className="text-[10px] uppercase tracking-widest text-ink-muted">{m.label}</p>
            <p className="mt-0.5 flex items-baseline gap-1">
              <span className={`text-base font-bold tabular-nums ${m.ok ? metricValueOk : metricValueWarn}`}>{m.value}</span>
              <span className="text-[10px] text-ink-muted">{m.unit}</span>
            </p>
            {m.bar > 0 && <MetricBar value={m.bar} max={m.max} ok={m.ok} color={m.color} />}
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className={`relative overflow-hidden rounded-3xl cpe-viz ${immersive ? 'min-h-[70vh] flex flex-col' : ''} ${className}`}>
      <style>{`
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
      <div className="absolute inset-0 pointer-events-none overflow-hidden cpe-viz-aurora">
        <div className="aurora-blob absolute -top-20 left-1/4 w-72 h-72 rounded-full bg-cyan-500/[0.07] blur-3xl" />
        <div className="aurora-blob absolute top-10 right-1/4 w-56 h-56 rounded-full bg-emerald-500/[0.05] blur-3xl" style={{ animationDelay: '-3s' }} />
      </div>

      {/* header */}
      <div className="relative px-6 pt-6 pb-2 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <QualityRing score={linkScore} color={theme.ring} uid={uid} isLight={isLight} />
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-[0.25em] text-sky-700/60 dark:text-cyan-400/50 font-medium">Radio enlace</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-raised text-ink-muted border border-line">
                {theme.label}
              </span>
            </div>
            <h3 className="text-xl font-semibold text-ink tracking-tight">{equipment.name || 'Antena CPE'}</h3>
            <p className="text-sm text-ink-muted mt-0.5">
              {equipment.brand || 'Ubiquiti'} {equipment.model || 'LiteBeam M5'}
            </p>
            <p className="text-xs font-mono text-ink-muted mt-1">{equipment.displayIp || equipment.ipAddress || 'sin IP'}</p>
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
                className="p-2 rounded-xl bg-surface-card border border-line text-ink-muted hover:text-sky-600 dark:hover:text-cyan-300 hover:border-sky-500/30 transition disabled:opacity-40"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            )}
            {onExpand && (
              <button
                type="button"
                onClick={onExpand}
                title="Pantalla completa"
                className="p-2 rounded-xl bg-surface-card border border-line text-ink-muted hover:text-sky-600 dark:hover:text-cyan-300 hover:border-sky-500/30 transition"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            )}
          </div>
          <span className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold backdrop-blur-sm ${
            online
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 dark:border-emerald-400/20'
              : 'bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/25 dark:border-red-400/20'
          }`}>
            <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]' : 'bg-red-400'}`} />
            {online ? 'En línea' : 'Sin enlace'}
          </span>
          {equipment.snmpUptime && (
            <span className="text-[10px] text-ink-muted font-mono">uptime {equipment.snmpUptime}</span>
          )}
        </div>
      </div>

      {/* escena enlace */}
      <div className={`relative px-1 sm:px-3 pb-1 ${immersive ? 'flex-1 flex items-center' : ''}`}>
        <div className={`relative w-full ${immersive ? 'max-h-[min(58vh,560px)]' : 'max-h-[360px]'} aspect-[580/280]`}>
          <svg
            viewBox="0 0 580 280"
            className="absolute inset-0 w-full h-full"
            aria-hidden
          >
            <defs>
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
                <stop offset="100%" stopColor={isLight ? 'rgba(2,132,199,0.06)' : 'rgba(34,211,238,0.04)'} />
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

            <g className="floor-grid" opacity={isLight ? 0.08 : 0.04}>
              {Array.from({ length: 12 }, (_, i) => (
                <line key={`h${i}`} x1="0" y1={198 + i * 8} x2="580" y2={198 + i * 8} stroke="#94a3b8" strokeWidth="0.5" />
              ))}
              {Array.from({ length: 16 }, (_, i) => (
                <line key={`v${i}`} x1={i * 38} y1="188" x2={i * 38 - 80} y2="288" stroke="#94a3b8" strokeWidth="0.5" />
              ))}
            </g>

            <rect x="0" y="188" width="580" height="92" fill={`url(#${uid}-horizon)`} />

            <SignalBeams uid={uid} online={online} strength={beamStrength} colors={theme} txSpeed={txSpeed} rxSpeed={rxSpeed} beam={linkBeam} />

            <LinkHardwareSvg
              uid={uid}
              online={online}
              cpeSrc={cpeImageUrl}
              towerSrc={towerImageUrl}
            />

            {online && signal != null && (
              <g opacity="0.65">
                <line
                  x1={linkBeam.mid.x}
                  y1={linkBeam.mid.y}
                  x2={linkBeam.mid.x}
                  y2={linkBeam.mid.y - 18}
                  stroke="#475569"
                  strokeWidth="0.6"
                  strokeDasharray="2 3"
                />
                <rect
                  x={linkBeam.mid.x - 45}
                  y={linkBeam.mid.y - 32}
                  width="90"
                  height="18"
                  rx="9"
                  fill={isLight ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.06)'}
                  stroke={isLight ? 'rgba(40,35,30,0.12)' : 'rgba(255,255,255,0.1)'}
                  strokeWidth="0.5"
                />
                <text
                  x={linkBeam.mid.x}
                  y={linkBeam.mid.y - 20}
                  textAnchor="middle"
                  fill={svgLabelFill}
                  fontSize="8"
                  fontFamily="system-ui,sans-serif"
                >
                  {signal} dBm
                </text>
              </g>
            )}


            <LinkHardwareLabelsSvg cpeLabel={cpeLabel} apLabel={apLabel} labelFill={svgLabelFill} />
          </svg>
        </div>
      </div>

      {/* métricas: cliente + sectorial */}
      <div className="relative p-4 pt-2 border-t border-line">
        {peer ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {metricSide(
              `${cpeLabel}${equipment.displayIp || equipment.ipAddress ? ` · ${equipment.displayIp || equipment.ipAddress}` : ''}`,
              { signal, ccq: ccq ?? null, snr: snr ?? null, quality: linkScore },
              linkDown ? 'Sin enlace — CPE apagado o desconectado' : null,
            )}
            {metricSide(
              `Sectorial · ${peer.name || 'AP'}${peer.displayIp || peer.ipAddress ? ` · ${peer.displayIp || peer.ipAddress}` : ''}`,
              {
                signal: peerSignal,
                ccq: peerCcq,
                snr: peerSnr,
                quality: linkDown ? 0 : computeLinkScore(Boolean(peerOnline), peerSignal, peerCcq, peerSnr),
              },
              linkDown
                ? (peerOnline ? 'Sectorial en línea · este CPE no aparece en sus estaciones' : 'Sectorial sin respuesta')
                : null,
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
                className={`${metricCardClass} px-4 py-3`}
              >
                <p className="text-[10px] uppercase tracking-widest text-ink-muted">{m.label}</p>
                <p className="mt-1 flex items-baseline gap-1">
                  <span className={`text-lg font-bold tabular-nums ${m.ok ? metricValueOk : metricValueWarn}`}>{m.value}</span>
                  <span className="text-[10px] text-ink-muted">{m.unit}</span>
                </p>
                {m.bar > 0 && <MetricBar value={m.bar} max={m.max} ok={m.ok} color={m.color} />}
              </div>
            ))}
          </div>
        )}
      </div>

      {linkDown && (
        <div className="mx-4 mb-4 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 flex items-start gap-2.5 text-sm text-red-800 dark:text-red-100/90">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-500 dark:text-red-400" />
          <span>
            {peerOnline
              ? 'El CPE del cliente no está enlazado. La sectorial sigue en línea; este abonado ya no aparece en su tabla de estaciones.'
              : (equipment.wirelessDebugHint || 'Enlace caído o CPE apagado.')}
          </span>
        </div>
      )}

      {!linkDown && warnings.length > 0 && (
        <div className="mx-4 mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 space-y-2">
          {warnings.map((w) => (
            <div key={w.label} className="flex items-start gap-2.5 text-sm text-amber-900 dark:text-amber-100/90">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>{w.label}</span>
            </div>
          ))}
        </div>
      )}

      {!signal && online && (
        <div className="mx-4 mb-4 flex flex-col gap-1 text-xs text-ink-muted rounded-xl bg-surface-raised border border-line px-4 py-3">
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
            <p className="text-[10px] text-ink-muted pl-6">
              Poll enrutado: Render → túnel → MikroTik Torre → 172.16.x.x (no requiere IP pública en la antena).
            </p>
          )}
        </div>
      )}

      {equipment.snmpPolledAt && (
        <p className="px-6 pb-4 text-[10px] text-ink-muted font-mono flex items-center gap-2">
          <span>
            {(equipment.snmpPollMethod === 'heartbeat' ? 'heartbeat' : 'snmp')}
            {' · '}
            {new Date(equipment.snmpPolledAt).toLocaleString('es-CL')}
          </span>
          {(isStale || refreshing) && (
            <span className="text-cyan-500/70 animate-pulse">actualizando…</span>
          )}
        </p>
      )}
    </div>
  )
}
