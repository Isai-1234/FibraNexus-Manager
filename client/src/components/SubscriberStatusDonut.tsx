import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'

type Props = {
  online: number
  offline: number
  suspended: number
  className?: string
}

const COLORS = {
  online: '#10b981',
  offline: '#ef4444',
  suspended: '#f59e0b',
}

export default function SubscriberStatusDonut({
  online, offline, suspended, className = '',
}: Props) {
  const total = online + offline + suspended
  const data = [
    { name: 'Online', value: online, color: COLORS.online },
    { name: 'Offline', value: offline, color: COLORS.offline },
    { name: 'Suspensión', value: suspended, color: COLORS.suspended },
  ].filter((d) => d.value > 0)

  return (
    <div className={`rounded-xl border border-line bg-surface-card p-5 ${className}`}>
      <h3 className="text-sm font-semibold text-ink">Estado de suscriptores</h3>
      <p className="text-xs text-ink-muted mt-0.5">Presencia de servicio / CRM</p>

      <div className="flex items-center gap-4 mt-3">
        <div className="relative w-[120px] h-[120px] shrink-0">
          {total === 0 ? (
            <div className="w-full h-full rounded-full border-8 border-line flex items-center justify-center text-xs text-ink-muted">
              —
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.length ? data : [{ name: 'empty', value: 1, color: '#e2e8f0' }]}
                    dataKey="value"
                    innerRadius={38}
                    outerRadius={54}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {(data.length ? data : [{ color: '#e2e8f0' }]).map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-xl font-bold text-ink tabular-nums leading-none">{total}</span>
                <span className="text-[10px] text-ink-muted mt-0.5">total</span>
              </div>
            </>
          )}
        </div>

        <ul className="space-y-2 text-sm flex-1 min-w-0">
          <li className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-ink-muted">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> Online
            </span>
            <span className="font-semibold tabular-nums text-ink">{online}</span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-ink-muted">
              <span className="w-2 h-2 rounded-full bg-red-500" /> Offline
            </span>
            <span className="font-semibold tabular-nums text-ink">{offline}</span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-ink-muted">
              <span className="w-2 h-2 rounded-full bg-amber-500" /> Suspensión
            </span>
            <span className="font-semibold tabular-nums text-ink">{suspended}</span>
          </li>
        </ul>
      </div>
    </div>
  )
}
