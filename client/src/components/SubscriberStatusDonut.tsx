import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'

type Props = {
  online: number
  offline: number
  suspended: number
  className?: string
}

const COLORS = {
  online: '#34d399',
  offline: '#f87171',
  suspended: '#fbbf24',
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
    <div className={`rounded-2xl border border-slate-800 bg-[#0f172a] p-5 ${className}`}>
      <h3 className="text-sm font-semibold text-slate-100">Estado de suscriptores</h3>
      <p className="text-xs text-slate-500 mt-0.5">Presencia de servicio</p>

      <div className="flex items-center gap-4 mt-4">
        <div className="relative w-[130px] h-[130px] shrink-0">
          {total === 0 ? (
            <div className="w-full h-full rounded-full border-8 border-slate-800 flex items-center justify-center text-xs text-slate-500">
              —
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.length ? data : [{ name: 'empty', value: 1, color: '#1e293b' }]}
                    dataKey="value"
                    innerRadius={42}
                    outerRadius={58}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {(data.length ? data : [{ color: '#1e293b' }]).map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-xl font-bold text-slate-100 tabular-nums leading-none">{total}</span>
                <span className="text-[10px] text-slate-500 mt-0.5">total</span>
              </div>
            </>
          )}
        </div>

        <ul className="space-y-2.5 text-sm flex-1 min-w-0">
          <li className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400" /> Online
            </span>
            <span className="font-semibold tabular-nums text-slate-100">{online}</span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-slate-400">
              <span className="w-2 h-2 rounded-full bg-red-400" /> Offline
            </span>
            <span className="font-semibold tabular-nums text-slate-100">{offline}</span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-slate-400">
              <span className="w-2 h-2 rounded-full bg-amber-400" /> Suspensión
            </span>
            <span className="font-semibold tabular-nums text-slate-100">{suspended}</span>
          </li>
        </ul>
      </div>
    </div>
  )
}
