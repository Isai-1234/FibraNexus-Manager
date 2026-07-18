import { useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || '/api'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const res = await axios.post(API + '/auth/password-reset/request', { email })
      let msg = res.data.message || 'Si el email existe, recibirás instrucciones.'
      if (res.data.resetUrl) msg += ` Enlace (dev): ${res.data.resetUrl}`
      setMessage(msg)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Error al solicitar recuperación')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 to-purple-700">
      <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Recuperar contraseña</h1>
          <p className="text-gray-500 mt-2">Te enviaremos un enlace a tu correo</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}
          {message && <div className="bg-green-50 text-green-800 p-3 rounded-lg text-sm break-all">{message}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email de tu cuenta</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {loading ? 'Enviando…' : 'Enviar enlace'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-500 mt-4">
          <Link to="/login" className="text-blue-600 hover:underline font-medium">Volver al login</Link>
        </p>
      </div>
    </div>
  )
}
