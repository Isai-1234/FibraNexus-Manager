import { ArrowDown, ArrowUp, Wifi } from 'lucide-react'
import { formatMbps, parseMikrotikMaxLimit } from '../lib/bandwidth'

type Props = {
  name: string
  target?: string
  maxLimit?: string
  comment?: string
  disabled?: boolean
}

export default function SubscriberQueueCard({ name, target, maxLimit, comment, disabled }: Props) {
  const { uploadMbps, downloadMbps } = parseMikrotikMaxLimit(maxLimit)
  const ip = target ? String(target).split('/')[0] : null

  return (
    <div className={`rounded-xl border p-4 transition ${disabled ? 'border-red-100 bg-red-50/40' : 'border-line bg-surface-card shadow-sm hover:shadow-md'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${disabled ? 'bg-red-100' : 'bg-blue-100'}`}>
              <Wifi className={`h-4 w-4 ${disabled ? 'text-red-600' : 'text-blue-600'}`} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-ink truncate">{name}</p>
              {ip && <p className="text-xs text-ink-muted font-mono">{ip}</p>}
            </div>
          </div>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${disabled ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {disabled ? 'Cortado' : 'Activo'}
        </span>
      </div>

      {(downloadMbps != null || uploadMbps != null) && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {downloadMbps != null && (
            <div className="rounded-lg bg-gradient-to-br from-sky-50 to-blue-50 border border-sky-100 px-3 py-2.5">
              <div className="flex items-center gap-1 text-sky-600 mb-0.5">
                <ArrowDown className="h-3.5 w-3.5" />
                <span className="text-[10px] font-semibold uppercase tracking-wide">Bajada</span>
              </div>
              <p className="text-xl font-bold text-sky-900 leading-tight">{formatMbps(downloadMbps)}</p>
            </div>
          )}
          {uploadMbps != null && (
            <div className="rounded-lg bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-100 px-3 py-2.5">
              <div className="flex items-center gap-1 text-violet-600 mb-0.5">
                <ArrowUp className="h-3.5 w-3.5" />
                <span className="text-[10px] font-semibold uppercase tracking-wide">Subida</span>
              </div>
              <p className="text-xl font-bold text-violet-900 leading-tight">{formatMbps(uploadMbps)}</p>
            </div>
          )}
        </div>
      )}

      {comment && (
        <p className="mt-3 text-xs text-ink-muted truncate" title={comment}>{comment}</p>
      )}
    </div>
  )
}
