import { AlertCircle, CheckCircle2, Clock, Loader2, ShieldOff, WifiOff } from 'lucide-react'

export type SuspendNetworkMeta = {
  mode?: string
  clientIp?: string
  portalUrl?: string
  routerId?: number
  cmdId?: string
  status?: 'pending' | 'active' | 'removing' | 'error'
  queuedAt?: string
  appliedAt?: string
  removedAt?: string
}

type Props = {
  serviceStatus: string
  suspendState?: SuspendNetworkMeta | null
  compact?: boolean
}

function formatTs(iso?: string) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return null
  }
}

export function describeSuspendState(serviceStatus: string, suspendState?: SuspendNetworkMeta | null) {
  const suspended = serviceStatus === 'suspended' || serviceStatus === 'cut'
  if (!suspended && !suspendState) return null

  if (!suspendState) {
    return {
      tone: 'warning' as const,
      icon: WifiOff,
      title: 'Sin reglas en router',
      detail: 'Suspendido en la plataforma. Vincula router e IP del abonado para aplicar walled garden.',
    }
  }

  const ip = suspendState.clientIp ? `IP ${suspendState.clientIp}` : null

  switch (suspendState.status) {
    case 'pending':
      return {
        tone: 'pending' as const,
        icon: Loader2,
        title: 'Aplicando en EdgeRouter',
        detail: [ip, 'El agente heartbeat aplica en ~30 s'].filter(Boolean).join(' · '),
        spin: true,
      }
    case 'removing':
      return {
        tone: 'pending' as const,
        icon: Loader2,
        title: 'Reactivando en EdgeRouter',
        detail: [ip, 'Quitando reglas de suspensión…'].filter(Boolean).join(' · '),
        spin: true,
      }
    case 'error':
      return {
        tone: 'error' as const,
        icon: AlertCircle,
        title: 'Error en router',
        detail: ip || 'Revisa credenciales, heartbeat o API del router.',
      }
    case 'active':
    default:
      return {
        tone: 'active' as const,
        icon: ShieldOff,
        title: 'Walled garden activo',
        detail: [ip, suspendState.mode === 'walled-garden' ? 'Solo DNS y portal de pago' : null].filter(Boolean).join(' · '),
      }
  }
}

const toneStyles = {
  pending: 'bg-amber-50 border-amber-200 text-amber-900',
  active: 'bg-yellow-50 border-yellow-200 text-yellow-900',
  error: 'bg-red-50 border-red-200 text-red-900',
  warning: 'bg-surface border-line text-ink-soft',
}

const iconStyles = {
  pending: 'text-amber-600',
  active: 'text-yellow-700',
  error: 'text-red-600',
  warning: 'text-ink-muted',
}

export default function NetworkSuspendStatus({ serviceStatus, suspendState, compact = false }: Props) {
  const info = describeSuspendState(serviceStatus, suspendState)
  if (!info) return null

  const Icon = info.icon
  const applied = formatTs(suspendState?.appliedAt)
  const queued = formatTs(suspendState?.queuedAt)

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${toneStyles[info.tone]}`}>
        <Icon className={`h-3 w-3 ${info.spin ? 'animate-spin' : ''} ${iconStyles[info.tone]}`} />
        {info.title}
      </span>
    )
  }

  return (
    <div className={`rounded-xl border p-4 ${toneStyles[info.tone]}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 shrink-0 ${iconStyles[info.tone]}`}>
          <Icon className={`h-5 w-5 ${info.spin ? 'animate-spin' : ''}`} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold text-sm">{info.title}</p>
          <p className="text-xs opacity-90">{info.detail}</p>
          {suspendState?.portalUrl && (
            <p className="text-xs truncate">
              Portal mora:{' '}
              <a href={suspendState.portalUrl} target="_blank" rel="noreferrer" className="underline font-medium">
                {suspendState.portalUrl}
              </a>
            </p>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] opacity-75 pt-0.5">
            {suspendState?.routerId && <span>Router #{suspendState.routerId}</span>}
            {queued && suspendState?.status === 'pending' && <span>Encolado {queued}</span>}
            {applied && suspendState?.status === 'active' && (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Aplicado {applied}
              </span>
            )}
            {suspendState?.cmdId && suspendState.status === 'pending' && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> Cmd {suspendState.cmdId.slice(0, 8)}…
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function suspendToastMessage(network: Record<string, unknown> | null | undefined, action: 'suspend' | 'reactivate') {
  if (!network) return null
  if (network.error) return { type: 'error' as const, text: String(network.error) }
  if (network.skipped) return { type: 'warning' as const, text: String(network.reason || 'Sin cambios en router') }

  if (action === 'suspend') {
    if (network.queued) {
      return {
        type: 'info' as const,
        text: `Suspensión encolada en EdgeRouter (~30 s)${network.clientIp ? ` · IP ${network.clientIp}` : ''}`,
      }
    }
    if (network.success) {
      return {
        type: 'success' as const,
        text: `IP suspendida en MikroTik${network.clientIp ? ` (${network.clientIp})` : ''}`,
      }
    }
  }

  if (action === 'reactivate') {
    if (network.queued) return { type: 'info' as const, text: 'Reactivación encolada en EdgeRouter (~30 s)' }
    if (network.success) return { type: 'success' as const, text: 'Reglas de suspensión eliminadas en router' }
  }

  return null
}
