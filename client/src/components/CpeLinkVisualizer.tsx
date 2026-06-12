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
  if (dbm == null) return 0
  return Math.min(100, Math.max(8, 100 + dbm))
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
  const apLabel = siteName || equipment.siteName || 'Torre / AP sectorial'

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0a0a12] via-[#0f1424] to-[#121a35] border border-white/10 shadow-2xl">
      <style>{`
        @keyframes cpe-beam-pulse {
          0%, 100% { opacity: 0.35; transform: scaleX(0.92); }
          50% { opacity: 1; transform: scaleX(1); }
        }
        @keyframes cpe-beam-flow {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        @keyframes cpe-glow {
          0%, 100% { filter: drop-shadow(0 0 8px rgba(96,165,250,0.4)); }
          50% { filter: drop-shadow(0 0 22px rgba(147,197,253,0.95)); }
        }
        @keyframes cpe-sector-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        .cpe-beam {
          animation: cpe-beam-pulse 2.4s ease-in-out infinite, cpe-beam-flow 3s linear infinite;
          background: linear-gradient(90deg,
            transparent 0%,
            rgba(59,130,246,0.15) 20%,
            rgba(147,197,253,0.85) 50%,
            rgba(59,130,246,0.15) 80%,
            transparent 100%);
          background-size: 200% 100%;
        }
        .cpe-dish-glow { animation: cpe-glow 2.4s ease-in-out infinite; }
        .cpe-sector-glow { animation: cpe-sector-pulse 2.4s ease-in-out infinite; }
      `}</style>

      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.08),transparent_70%)] pointer-events-none" />

      <div className="relative px-6 pt-6 pb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-blue-300/60 font-medium">Enlace inalámbrico</p>
          <h3 className="text-xl font-semibold text-white mt-1">{equipment.name || 'Antena CPE'}</h3>
          <p className="text-sm text-slate-400 mt-0.5">
            {equipment.brand || 'Ubiquiti'} {equipment.model || 'LiteBeam M5'} · {equipment.ipAddress || 'sin IP'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
            online ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' : 'bg-red-500/20 text-red-300 border border-red-400/30'
          }`}>
            <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            {online ? 'En línea' : 'Sin enlace'}
          </span>
          {equipment.snmpUptime && (
            <span className="text-xs text-slate-500">uptime {equipment.snmpUptime}</span>
          )}
        </div>
      </div>

      <div className="relative px-4 sm:px-8 pb-6 min-h-[220px] flex items-center justify-center">
        {/* CPE LiteBeam */}
        <div className="absolute left-[8%] sm:left-[12%] bottom-[28%] flex flex-col items-center z-10">
          <svg viewBox="0 0 120 100" className="w-24 sm:w-28 cpe-dish-glow" aria-hidden>
            <ellipse cx="60" cy="88" rx="28" ry="6" fill="rgba(0,0,0,0.35)" />
            <path d="M30 75 Q60 20 90 75 Z" fill="#e8edf5" stroke="#94a3b8" strokeWidth="1.5" />
            <path d="M38 72 Q60 35 82 72" fill="none" stroke="#cbd5e1" strokeWidth="1" />
            <circle cx="60" cy="58" r="6" fill="#1e293b" stroke="#64748b" strokeWidth="1" />
            <rect x="54" y="75" width="12" height="14" rx="2" fill="#334155" />
            <rect x="48" y="86" width="24" height="4" rx="1" fill="#475569" />
          </svg>
          <p className="text-[10px] text-slate-400 mt-2 text-center max-w-[90px]">CPE cliente</p>
        </div>

        {/* Wireless beam */}
        {online && (
          <div
            className="absolute left-[22%] sm:left-[26%] right-[22%] sm:right-[26%] top-1/2 -translate-y-1/2 h-3 sm:h-4 rounded-full cpe-beam"
            style={{ opacity: beamStrength / 100 }}
          />
        )}

        {/* Sector AP */}
        <div className="absolute right-[8%] sm:right-[12%] bottom-[30%] flex flex-col items-center z-10">
          <svg viewBox="0 0 100 110" className="w-20 sm:w-24 cpe-sector-glow" aria-hidden>
            <rect x="42" y="70" width="16" height="30" rx="2" fill="#475569" />
            <path d="M15 70 Q50 15 85 70 Z" fill="#334155" stroke="#64748b" strokeWidth="1.5" opacity="0.9" />
            <path d="M25 68 Q50 30 75 68" fill="none" stroke="#60a5fa" strokeWidth="1.5" opacity="0.7" />
            <line x1="50" y1="70" x2="50" y2="100" stroke="#64748b" strokeWidth="2" />
          </svg>
          <p className="text-[10px] text-slate-400 mt-2 text-center max-w-[100px] truncate">{apLabel}</p>
        </div>

        {/* Signal label on beam */}
        {signal != null && online && (
          <div className="absolute top-[38%] left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white/10 backdrop-blur border border-white/15 text-xs text-blue-100 font-mono">
            {signal} dBm {ccq != null ? `· CCQ ${ccq}%` : ''}
          </div>
        )}
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/5 border-t border-white/10">
        {[
          { label: 'Señal', value: signal != null ? `${signal} dBm` : '—', ok: signal != null && signal >= -65 },
          { label: 'RSSI', value: equipment.wirelessRssi != null ? `${equipment.wirelessRssi} dBm` : '—', ok: true },
          { label: 'CCQ', value: ccq != null ? `${ccq}%` : '—', ok: ccq == null || ccq >= 70 },
          { label: 'SNR', value: equipment.wirelessSnr != null ? `${equipment.wirelessSnr} dB` : '—', ok: equipment.wirelessSnr == null || equipment.wirelessSnr >= 15 },
        ].map((m) => (
          <div key={m.label} className="px-4 py-3 bg-black/20">
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
          Antena online — activa SNMP en airOS para ver señal, CCQ y alertas de alineación en tiempo real.
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
