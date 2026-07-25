import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, CreditCard, LogIn, ExternalLink } from 'lucide-react'

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
}

export default function SuspendedNotice() {
  const { slug } = useParams<{ slug?: string }>()
  const [brand, setBrand] = useState<MoraBrand | null>(null)
  const [loadError, setLoadError] = useState(false)

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

  const orgName = brand?.orgName || (slug ? null : null)
  const title = brand?.portalTitle || orgName || 'Servicio suspendido'
  const primary = brand?.primaryColor || '#2563eb'
  const payUrl = brand?.payUrl || DEFAULT_LOGIN

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
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
          <p className="text-gray-700 leading-relaxed">
            {orgName
              ? `${orgName} limitó tu acceso por falta de pago. Solo puedes usar esta página y el portal para regularizar.`
              : 'Por falta de pago, solo puedes usar esta página y el portal para regularizar. El resto de sitios están bloqueados hasta que pagues.'}
          </p>

          {loadError && slug && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No se pudo cargar la marca del ISP. Puedes pagar igual desde el portal.
            </p>
          )}

          <a
            href={payUrl}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-4 text-white text-lg font-semibold rounded-xl transition-opacity hover:opacity-90 shadow-lg"
            style={{ backgroundColor: primary }}
          >
            <CreditCard className="h-5 w-5" />
            Pagar aquí
            <ExternalLink className="h-4 w-4 opacity-80" />
          </a>

          <ul className="text-sm text-gray-600 space-y-2 bg-gray-50 rounded-xl p-4 border">
            <li>1. Entra con tu usuario de abonado.</li>
            <li>2. Revisa la factura pendiente y registra el pago.</li>
            <li>3. Al confirmarse, el servicio se reactiva solo.</li>
          </ul>

          <Link
            to="/login"
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
          >
            <LogIn className="h-4 w-4" />
            Ir al portal de clientes
          </Link>

          <p className="text-xs text-gray-400 text-center pt-1">
            Apps como YouTube no muestran este aviso (usan HTTPS). Abre el navegador en una página HTTP
            (p. ej. neverssl.com) o usa el aviso de Wi‑Fi del teléfono.
          </p>
        </div>
      </div>
    </div>
  )
}
