import { Link } from 'react-router-dom'
import { AlertTriangle, CreditCard, LogIn, ExternalLink } from 'lucide-react'

const DEFAULT_LOGIN = 'https://app.fibranexus.cl/login'
const payUrl = import.meta.env.VITE_PORTAL_LOGIN_URL || DEFAULT_LOGIN

export default function SuspendedNotice() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-amber-500 px-8 py-6 flex items-center gap-4">
          <div className="bg-white/20 rounded-full p-3">
            <AlertTriangle className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Servicio suspendido</h1>
            <p className="text-amber-100 text-sm">Tu internet está limitado por mora</p>
          </div>
        </div>

        <div className="px-8 py-8 space-y-5">
          <p className="text-gray-700 leading-relaxed">
            Por falta de pago, solo puedes usar esta página y el portal para regularizar.
            El resto de sitios (YouTube, redes, etc.) están bloqueados hasta que pagues.
          </p>

          <a
            href={payUrl}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-4 bg-blue-600 text-white text-lg font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/30"
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
            Si el celular no abre solo esta página, escribe en el navegador:{' '}
            <span className="font-mono text-gray-500">app.fibranexus.cl/suspended</span>
          </p>
        </div>
      </div>
    </div>
  )
}
