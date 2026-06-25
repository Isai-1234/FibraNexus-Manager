import { Link } from 'react-router-dom'
import { AlertTriangle, CreditCard, LogIn } from 'lucide-react'

const DEFAULT_PORTAL = 'https://app.fibranexus.cl/login'

export default function SuspendedNotice() {
  const loginUrl = import.meta.env.VITE_PORTAL_LOGIN_URL || DEFAULT_PORTAL

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-amber-500 px-8 py-6 flex items-center gap-4">
          <div className="bg-white/20 rounded-full p-3">
            <AlertTriangle className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Servicio suspendido</h1>
            <p className="text-amber-100 text-sm">Tu conexión está limitada por mora</p>
          </div>
        </div>

        <div className="px-8 py-8 space-y-5">
          <p className="text-gray-700 leading-relaxed">
            Detectamos que tu servicio de internet tiene facturas pendientes. Mientras tanto,
            solo puedes acceder a esta página y al portal de pagos para regularizar tu cuenta.
          </p>

          <ul className="text-sm text-gray-600 space-y-2 bg-gray-50 rounded-xl p-4 border">
            <li className="flex items-start gap-2">
              <CreditCard className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
              <span>Ingresa al portal de clientes para ver tus facturas y registrar el pago.</span>
            </li>
            <li className="flex items-start gap-2">
              <LogIn className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
              <span>Tras confirmar el pago, tu servicio se reactivará automáticamente.</span>
            </li>
          </ul>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <a
              href={loginUrl}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors"
            >
              <CreditCard className="h-4 w-4" />
              Ir a pagar mi servicio
            </a>
            <Link
              to="/login"
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
            >
              <LogIn className="h-4 w-4" />
              Iniciar sesión
            </Link>
          </div>

          <p className="text-xs text-gray-400 text-center pt-2">
            Si ya pagaste, espera unos minutos o contacta a soporte de tu proveedor.
          </p>
        </div>
      </div>
    </div>
  )
}
