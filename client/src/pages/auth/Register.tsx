import { useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || '/api'

export default function Register({ onRegister }: { onRegister: (user: any) => void }) {
  const [form, setForm] = useState({
    companyName: '',
    fullName: '',
    email: '',
    phone: '',
    password: '',
    confirm: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm) {
      setError('Las contraseñas no coinciden')
      return
    }
    setLoading(true)
    try {
      const res = await axios.post(API + '/auth/register', {
        companyName: form.companyName,
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        password: form.password,
      })
      localStorage.setItem('token', res.data.token)
      onRegister(res.data.user)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Error al registrar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 to-purple-700 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Crear cuenta ISP</h1>
          <p className="text-gray-500 mt-2">Prueba FibraNexus gratis por 14 días</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de tu ISP</label>
            <input className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" required
              placeholder="ej: Internet Sur SpA" value={form.companyName}
              onChange={e => setForm({ ...form, companyName: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tu nombre</label>
            <input className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" required
              value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" required
              value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono (opcional)</label>
            <input className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
            <input type="password" minLength={6} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" required
              value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar contraseña</label>
            <input type="password" className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" required
              value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Creando cuenta...' : 'Empezar trial gratis'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-500 mt-4">
          ¿Ya tienes cuenta? <Link to="/login" className="text-blue-600 hover:underline">Iniciar sesión</Link>
        </p>
      </div>
    </div>
  )
}
