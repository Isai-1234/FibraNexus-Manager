import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Wifi } from 'lucide-react'
import { getStoredTheme, applyTheme } from '../../lib/theme'

const API = import.meta.env.VITE_API_URL || '/api'

type IspBrand = {
  orgName: string
  slug: string
  logoUrl?: string
  primaryColor?: string
  accentColor?: string
  portalTitle?: string
}

/** Login con marca del ISP (portal de abonados): /portal/:slug */
export default function IspLogin({ onLogin }: { onLogin: (e: string, p: string) => Promise<void> }) {
  const { slug } = useParams<{ slug: string }>()
  const [brand, setBrand] = useState<IspBrand | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data) setBrand(data) })
      .catch(() => { /* marca por defecto */ })
    return () => { cancelled = true }
  }, [slug])

  const orgName = brand?.orgName || 'Portal de abonados'
  const primary = brand?.primaryColor || '#2563eb'
  const subtitle = brand?.portalTitle && brand.portalTitle !== orgName
    ? brand.portalTitle
    : 'Entra a tu cuenta'

  useEffect(() => {
    document.title = `${orgName} · Portal`
    return () => { document.title = 'FibraNexus Manager' }
  }, [orgName])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try { await onLogin(email, password) }
    catch (err: any) { setError(err.response?.data?.error || 'Correo o contraseña incorrectos') }
    finally { setLoading(false) }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(180deg, #f7f2ea 0%, #efe6da 100%)' }}
    >
      <div className="bg-[#fbf7f1] rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-[#e5d9c8]">
        <div className="px-8 py-6 flex items-center gap-4" style={{ backgroundColor: primary }}>
          {brand?.logoUrl ? (
            <img src={brand.logoUrl} alt={orgName} className="h-12 w-12 rounded-lg bg-white object-contain p-1" />
          ) : (
            <div className="bg-white/20 rounded-full p-3">
              <Wifi className="h-7 w-7 text-white" />
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold text-white">{orgName}</h1>
            <p className="text-white/90 text-sm">{subtitle}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-5">
          {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm border border-red-100">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Correo</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="username" inputMode="email"
              className="w-full px-4 py-3 border border-[#e5d9c8] rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:outline-none"
              style={{ ['--tw-ring-color' as any]: primary }}
              required />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full px-4 py-3 border border-[#e5d9c8] rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:outline-none"
              style={{ ['--tw-ring-color' as any]: primary }}
              required />
            <p className="mt-1 text-right">
              <Link to="/forgot-password" className="text-sm hover:underline" style={{ color: primary }}>
                ¿Olvidaste tu contraseña?
              </Link>
            </p>
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-3.5 text-white rounded-xl font-semibold disabled:opacity-50 transition-opacity hover:opacity-90"
            style={{ backgroundColor: primary }}>
            {loading ? 'Entrando…' : 'Entrar a mi cuenta'}
          </button>
          <p className="text-center text-xs text-slate-500">
            Si no tienes tu clave, contacta a {orgName}.
          </p>
        </form>
      </div>
    </div>
  )
}
