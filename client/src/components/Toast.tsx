import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'info'

export type ToastState = {
  message: string
  type: ToastType
  leaving?: boolean
} | null

/**
 * Notificacion flotante centrada con animacion de entrada/salida.
 * Uso: const { toast, showToast, hideToast } = useToast()
 *      showToast('Guardado') / showToast('Fallo X', 'error')
 *      <Toast toast={toast} onHide={hideToast} />
 */
export function useToast(timeoutMs = 4200) {
  const [toast, setToast] = useState<ToastState>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hideToast = useCallback(() => {
    setToast((t) => (t ? { ...t, leaving: true } : null))
    if (timer.current) clearTimeout(timer.current)
    setTimeout(() => setToast(null), 250)
  }, [])

  const showToast = useCallback((message: string, type?: ToastType) => {
    if (timer.current) clearTimeout(timer.current)
    const inferred: ToastType = type || (
      /error|fallo|falló|inv[áa]lid|no se pudo|no configurad|rechazad/i.test(message) ? 'error' : 'success'
    )
    setToast({ message, type: inferred })
    timer.current = setTimeout(() => hideToast(), timeoutMs)
  }, [hideToast, timeoutMs])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return { toast, showToast, hideToast }
}

const STYLES: Record<ToastType, { border: string; iconBg: string; icon: typeof Info; iconColor: string }> = {
  success: { border: 'border-emerald-200 dark:border-emerald-900', iconBg: 'bg-emerald-100 dark:bg-emerald-950', icon: CheckCircle2, iconColor: 'text-emerald-600' },
  error: { border: 'border-red-200 dark:border-red-900', iconBg: 'bg-red-100 dark:bg-red-950', icon: AlertTriangle, iconColor: 'text-red-600' },
  info: { border: 'border-blue-200 dark:border-blue-900', iconBg: 'bg-blue-100 dark:bg-blue-950', icon: Info, iconColor: 'text-blue-600' },
}

export default function Toast({ toast, onHide }: { toast: ToastState; onHide: () => void }) {
  if (!toast) return null
  const s = STYLES[toast.type]
  const Icon = s.icon
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fn-toast ${toast.leaving ? 'fn-toast-out' : 'fn-toast-in'} fixed top-6 left-1/2 z-50 flex items-center gap-3 max-w-md w-[calc(100%-2rem)] px-4 py-3 rounded-2xl border ${s.border} bg-white/95 dark:bg-slate-900/95 backdrop-blur shadow-xl shadow-slate-900/10`}
      onAnimationEnd={toast.leaving ? onHide : undefined}
    >
      <span className={`shrink-0 w-9 h-9 rounded-full ${s.iconBg} flex items-center justify-center`}>
        <Icon className={`w-5 h-5 ${s.iconColor}`} />
      </span>
      <p className="flex-1 text-sm text-slate-800 dark:text-slate-100 leading-snug">{toast.message}</p>
      <button
        type="button"
        onClick={onHide}
        aria-label="Cerrar"
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
      <style>{`
        @keyframes fn-toast-in {
          0% { opacity: 0; transform: translate(-50%, -16px) scale(.96); }
          60% { opacity: 1; transform: translate(-50%, 4px) scale(1); }
          100% { opacity: 1; transform: translate(-50%, 0) scale(1); }
        }
        @keyframes fn-toast-out {
          0% { opacity: 1; transform: translate(-50%, 0) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -12px) scale(.97); }
        }
        .fn-toast-in { animation: fn-toast-in .38s cubic-bezier(.21,1.02,.73,1) both; }
        .fn-toast-out { animation: fn-toast-out .25s ease-in both; }
      `}</style>
    </div>
  )
}
