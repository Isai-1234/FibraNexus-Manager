import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertTriangle, CreditCard, ArrowRight, LogIn } from 'lucide-react'
import { getStoredTheme, applyTheme } from '../../lib/theme'

const API = import.meta.env.VITE_API_URL || '/api'
const DEFAULT_LOGIN = 'https://app.fibranexus.cl/login'

type MoraBrand = {
  orgName: string
  slug: string
  logoUrl?: string
  primaryColor?: string
  accentColor?: string
  portalTitle?: string
  payUrl?: string
  portalUrl?: string
}

export default function SuspendedNotice() {
  const { slug } = useParams<{ slug?: string }>()
  const [brand, setBrand] = useState<MoraBrand | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('dark')
    root.classList.add('light')
    return () => { applyTheme(getStoredTheme()) }
  }, [])

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    fetch(`${API}/public/mora/${encodeURIComponent(slug)}`)
      .then((r) => {
        if (!r.ok) throw new Error('not found')
        return r.json()
      })
      .then((data) => {
        if (!cancelled) setBrand(data)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
    return () => { cancelled = true }
  }, [slug])

  const orgName = brand?.orgName || null
  const title = orgName || 'Servicio limitado'
  const primary = brand?.primaryColor || '#2563eb'
  const payUrl = brand?.payUrl || (slug ? `/portal/${slug}` : DEFAULT_LOGIN)

  useEffect(() => {
    document.title = orgName ? `${orgName} · Mora` : 'Servicio limitado'
    return () => { document.title = 'FibraNexus Manager' }
  }, [orgName])

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(180deg, #f7f2ea 0%, #efe6da 100%)' }}
    >
      <div className="max-w-lg w-full bg-[#fbf7f1] rounded-2xl shadow-xl overflow-hidden border border-[#e5d9c8]">
        <div className="px-8 py-6 flex items-center gap-4" style={{ backgroundColor: primary }}>
          {brand?.logoUrl ? (
            <img src={brand.logoUrl} alt={orgName || 'ISP'} className="h-12 w-12 rounded-lg bg-white object-contain p-1" />
          ) : (
            <div className="bg-white/20 rounded-full p-3">
              <AlertTriangle className="h-8 w-8 text-white" />
            </div>
          )}
          <div>
            <p className="text-white/80 text-xs font-medium uppercase tracking-wide">
              {orgName || 'Tu proveedor de internet'}
            </p>
            <h1 className="text-xl font-bold text-white">{title}</h1>
            <p className="text-white/90 text-sm">Internet limitado por mora</p>
          </div>
        </div>

        <div className="px-8 py-8 space-y-5">
          <p className="text-slate-700 leading-relaxed">
            {orgName
              ? `${orgName} limitó tu acceso por falta de pago. Entra a tu cuenta para pagar y reactivar el servicio.`
              : 'Por falta de pago el acceso está limitado. Entra al portal para regularizar.'}
          </p>

          {loadError && slug && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No se pudo cargar la marca del ISP. Puedes continuar al portal de pago.
            </p>
          )}

          <a
            href={payUrl}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-4 text-white text-lg font-semibold rounded-xl transition-opacity hover:opacity-90 shadow-lg"
            style={{ backgroundColor: primary }}
          >
            <CreditCard className="h-5 w-5" />
            Entrar y pagar
            <ArrowRight className="h-5 w-5 opacity-80" />
          </a>

          {slug && (
            <a
              href={`/portal/${slug}`}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium rounded-xl border border-[#e5d9c8] bg-white text-slate-700 hover:bg-[#f3eee6]"
            >
              <LogIn className="h-4 w-4" />
              Ya tengo cuenta
            </a>
          )}

          <p className="text-sm text-center text-slate-500">
            Al confirmarse el pago, el servicio se reactiva automáticamente.
          </p>
        </div>
      </div>
    </div>
  )
}
