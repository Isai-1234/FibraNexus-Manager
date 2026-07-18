import { useEffect, useState } from 'react'
import axios from 'axios'
import { Plus, X, Loader2, UserPlus } from 'lucide-react'

type StaffUser = {
  id: number
  email: string
  fullName: string
  role: 'admin' | 'office' | 'technician'
  phone?: string | null
  isActive: boolean
  lastLogin?: string | null
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador',
  office: 'Administrativo',
  technician: 'Técnico',
}

export default function StaffManager({ API }: { API: string }) {
  const [rows, setRows] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'office' as StaffUser['role'],
    phone: '',
  })

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    })
  }

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await api().get('/staff')
      setRows(Array.isArray(res.data) ? res.data : [])
    } catch (err: any) {
      setError(err.response?.data?.error || err.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function createStaff(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api().post('/staff', {
        ...form,
        phone: form.phone || null,
      })
      setShowForm(false)
      setForm({ fullName: '', email: '', password: '', role: 'office', phone: '' })
      load()
    } catch (err: any) {
      alert(err.response?.data?.error || err.message)
    }
  }

  async function toggleActive(user: StaffUser) {
    if (!confirm(user.isActive ? `¿Desactivar a ${user.fullName}?` : `¿Reactivar a ${user.fullName}?`)) return
    try {
      await api().patch(`/staff/${user.id}`, { isActive: !user.isActive })
      load()
    } catch (err: any) {
      alert(err.response?.data?.error || err.message)
    }
  }

  async function changeRole(user: StaffUser, role: StaffUser['role']) {
    try {
      await api().patch(`/staff/${user.id}`, { role })
      load()
    } catch (err: any) {
      alert(err.response?.data?.error || err.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">{rows.length} usuario{rows.length !== 1 ? 's' : ''} interno{rows.length !== 1 ? 's' : ''}</p>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2"
        >
          <UserPlus className="h-4 w-4" /> Nuevo personal
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                {['Nombre', 'Email', 'Rol', 'Estado', 'Acciones'].map((h) => (
                  <th key={h} className="text-left p-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="p-4 font-medium">{u.fullName}</td>
                  <td className="p-4 text-sm text-gray-600">{u.email}</td>
                  <td className="p-4">
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u, e.target.value as StaffUser['role'])}
                      className="border rounded-lg px-2 py-1 text-sm"
                    >
                      <option value="admin">{ROLE_LABEL.admin}</option>
                      <option value="office">{ROLE_LABEL.office}</option>
                      <option value="technician">{ROLE_LABEL.technician}</option>
                    </select>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {u.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="p-4">
                    <button onClick={() => toggleActive(u)} className="text-sm text-blue-600 hover:underline">
                      {u.isActive ? 'Desactivar' : 'Reactivar'}
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">Sin personal registrado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <form onSubmit={createStaff} className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-lg flex items-center gap-2"><Plus className="h-5 w-5" /> Nuevo personal</h3>
              <button type="button" onClick={() => setShowForm(false)}><X className="h-5 w-5 text-gray-400" /></button>
            </div>
            {[
              { name: 'fullName', label: 'Nombre completo', type: 'text' },
              { name: 'email', label: 'Email', type: 'email' },
              { name: 'password', label: 'Contraseña', type: 'password' },
              { name: 'phone', label: 'Teléfono', type: 'text' },
            ].map((f) => (
              <label key={f.name} className="block text-sm">
                <span className="text-gray-600">{f.label}</span>
                <input
                  required={f.name !== 'phone'}
                  type={f.type}
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={(form as any)[f.name]}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                />
              </label>
            ))}
            <label className="block text-sm">
              <span className="text-gray-600">Rol</span>
              <select
                className="mt-1 w-full border rounded-lg px-3 py-2"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as StaffUser['role'] })}
              >
                <option value="office">Administrativo</option>
                <option value="technician">Técnico</option>
                <option value="admin">Administrador</option>
              </select>
            </label>
            <button type="submit" className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
              Crear
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
