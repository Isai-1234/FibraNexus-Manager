import { useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || '/api'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    if (password !== confirm) {
      setError('Las contraseñas no coinciden')
      return
    }
    if (!token) {
      setError('Enlace inválido: falta el token')
      return
    }
    setLoading(true)
    try {
      const res = await axios.post(API + '/auth/password-reset/confirm', { token, password })
      setMessage(res.data.message || 'Contraseña actualizada')
      setTimeout(() => navigate('/login'), 1500)
    } catch (err: any) {
      setError(err.response?.data?.error || 'No se pudo actualizar la contraseña')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 to-purple-700">
      <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Nueva contraseña</h1>
          <p className="text-gray-500 mt-2">Mínimo 10 caracteres, con letras y números</p>
        </div>
        {!token && (
          <div className="bg-amber-50 text-amber-900 p-3 rounded-lg text-sm mb-4">
            Este enlace no trae token. Solicita uno nuevo desde recuperación.
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}
          {message && <div className="bg-green-50 text-green-800 p-3 rounded-lg text-sm">{message}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nueva contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              required
              minLength={10}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              required
              minLength={10}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !token}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {loading ? 'Guardando…' : 'Guardar contraseña'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-500 mt-4">
          <Link to="/login" className="text-blue-600 hover:underline font-medium">Volver al login</Link>
        </p>
      </div>
    </div>
  )
}
