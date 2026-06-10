import { useState, useEffect } from 'react'
import { Users, Wifi, DollarSign, LogOut, Server, Ticket, LayoutDashboard, FileText, Network, Plus, Search, X, CheckCircle, Clock, AlertCircle } from 'lucide-react'
import axios from 'axios'

const API = 'https://fibranexus-manager.onrender.com/api'

function api() {
  return axios.create({
    baseURL: API,
    headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
  })
}

export default function AdminDashboard({ user }: { user: any }) {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<any>({})

  useEffect(() => { loadData() }, [activeTab])

  async function loadData() {
    setLoading(true)
    try {
      const endpoints: Record<string, string> = {
        clients: '/clients', plans: '/plans', invoices: '/invoices',
        tickets: '/tickets', equipment: '/equipment'
      }
      if (endpoints[activeTab]) {
        const res = await api().get(endpoints[activeTab])
        setData(res.data || [])
      }
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  async function handleCreate() {
    try {
      const endpoints: Record<string, string> = {
        clients: '/clients', plans: '/plans', tickets: '/tickets', equipment: '/equipment'
      }
      await api().post(endpoints[activeTab], form)
      setShowForm(false)
      setForm({})
      loadData()
    } catch (err: any) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'clients', label: 'Clientes', icon: Users },
    { id: 'plans', label: 'Planes', icon: Wifi },
    { id: 'equipment', label: 'Equipos', icon: Network },
    { id: 'invoices', label: 'Facturación', icon: DollarSign },
    { id: 'tickets', label: 'Tickets', icon: Ticket },
  ]

  const stats = [
    { label: 'Clientes', value: activeTab === 'clients' ? data.length : '...', icon: Users, color: 'text-blue-600' },
    { label: 'Planes', value: activeTab === 'plans' ? data.length : '...', icon: Wifi, color: 'text-green-600' },
    { label: 'Equipos', value: activeTab === 'equipment' ? data.length : '...', icon: Server, color: 'text-purple-600' },
    { label: 'Tickets', value: activeTab === 'tickets' ? data.length : '...', icon: Ticket, color: 'text-yellow-600' },
  ]

  const logout = () => { localStorage.removeItem('token'); window.location.reload() }

  function renderForm() {
    const fields: Record<string, any[]> = {
      clients: [
        { name: 'fullName', label: 'Nombre', type: 'text' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'phone', label: 'Teléfono', type: 'text' },
        { name: 'password', label: 'Contraseña', type: 'password' },
        { name: 'clientType', label: 'Tipo', type: 'select', options: ['individual', 'business'] },
        { name: 'city', label: 'Ciudad', type: 'text' },
      ],
      plans: [
        { name: 'name', label: 'Nombre', type: 'text' },
        { name: 'type', label: 'Tipo', type: 'select', options: ['fiber', 'wisp', 'copper', 'wireless'] },
        { name: 'downloadSpeed', label: 'Descarga (Mbps)', type: 'number' },
        { name: 'uploadSpeed', label: 'Subida (Mbps)', type: 'number' },
        { name: 'price', label: 'Precio ($)', type: 'number' },
      ],
      equipment: [
        { name: 'name', label: 'Nombre', type: 'text' },
        { name: 'type', label: 'Tipo', type: 'select', options: ['router', 'switch', 'olt', 'ont', 'ap', 'cpe', 'server'] },
        { name: 'brand', label: 'Marca', type: 'text' },
        { name: 'model', label: 'Modelo', type: 'text' },
        { name: 'ipAddress', label: 'IP', type: 'text' },
        { name: 'location', label: 'Ubicación', type: 'text' },
      ],
      tickets: [
        { name: 'subject', label: 'Asunto', type: 'text' },
        { name: 'description', label: 'Descripción', type: 'textarea' },
        { name: 'priority', label: 'Prioridad', type: 'select', options: ['low', 'medium', 'high', 'critical'] },
      ],
    }

    const currentFields = fields[activeTab] || []
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6 w-full max-w-lg mx-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Nuevo {activeTab.slice(0, -1)}</h3>
            <button onClick={() => setShowForm(false)}><X className="h-5 w-5" /></button>
          </div>
          <div className="space-y-3">
            {currentFields.map(f => (
              <div key={f.name}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                {f.type === 'select' ? (
                  <select className="w-full border rounded-lg px-3 py-2" value={form[f.name] || ''} onChange={e => setForm({...form, [f.name]: e.target.value})}>
                    <option value="">Seleccionar...</option>
                    {f.options?.map((o: string) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea className="w-full border rounded-lg px-3 py-2" rows={3} value={form[f.name] || ''} onChange={e => setForm({...form, [f.name]: e.target.value})} />
                ) : (
                  <input type={f.type} className="w-full border rounded-lg px-3 py-2" value={form[f.name] || ''} onChange={e => setForm({...form, [f.name]: e.target.value})} />
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => setShowForm(false)} className="flex-1 py-2 border rounded-lg">Cancelar</button>
            <button onClick={handleCreate} className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Crear</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 flex">
      {showForm && renderForm()}
      
      <div className="w-64 bg-gray-900 text-white min-h-screen flex flex-col">
        <div className="p-6"><h2 className="text-xl font-bold">FibraNexus</h2><p className="text-gray-400 text-sm">Panel Admin</p></div>
        <nav className="flex-1 mt-4">
          {menuItems.map(item => (
            <button key={item.id} onClick={() => { setActiveTab(item.id); setData([]) }}
              className={`w-full flex items-center gap-3 px-6 py-3 text-left transition ${activeTab === item.id ? 'bg-blue-600' : 'hover:bg-gray-800'}`}>
              <item.icon className="h-5 w-5" /> {item.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium">{user?.fullName}</p><p className="text-xs text-gray-400">{user?.role}</p></div>
            <button onClick={logout} className="text-gray-400 hover:text-white"><LogOut className="h-5 w-5" /></button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <header className="bg-white shadow-sm px-8 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900 capitalize">{activeTab}</h1>
          <div className="flex gap-3">
            <button onClick={loadData} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Actualizar</button>
            {activeTab !== 'dashboard' && activeTab !== 'invoices' && (
              <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2">
                <Plus className="h-4 w-4" /> Nuevo
              </button>
            )}
          </div>
        </header>

        <main className="p-8">
          {activeTab === 'dashboard' && (
            <>
              <div className="grid grid-cols-4 gap-6 mb-8">
                {stats.map(s => (
                  <div key={s.label} className="bg-white p-6 rounded-xl shadow-sm">
                    <div className="flex items-center gap-4">
                      <s.icon className={`h-8 w-8 ${s.color}`} />
                      <div><p className="text-sm text-gray-500">{s.label}</p><p className="text-2xl font-bold">{s.value}</p></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl p-8 text-white">
                <h2 className="text-2xl font-bold mb-2">¡FibraNexus Manager!</h2>
                <p className="text-blue-100">Sistema de gestión ISP. Usa el menú lateral para gestionar clientes, planes, equipos, facturación y tickets.</p>
                <p className="text-blue-100 mt-2">Backend: Render + Supabase | Frontend: Vercel | Admin: admin@fibranexus.cl</p>
              </div>
            </>
          )}

          {activeTab === 'clients' && (
            <div className="bg-white rounded-xl shadow-sm p-6">
              {loading ? <p className="text-center py-8">Cargando...</p> : data.length === 0 ? (
                <p className="text-center py-8 text-gray-500">No hay clientes. ¡Crea el primero!</p>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50"><tr>
                    <th className="text-left p-3">Nombre</th><th className="text-left p-3">Email</th>
                    <th className="text-left p-3">Ciudad</th><th className="text-left p-3">Tipo</th>
                  </tr></thead>
                  <tbody>
                    {data.map((c: any) => (
                      <tr key={c.id} className="border-t hover:bg-gray-50">
                        <td className="p-3 font-medium">{c.user?.fullName || 'N/A'}</td>
                        <td className="p-3 text-gray-600">{c.user?.email || 'N/A'}</td>
                        <td className="p-3">{c.city || 'N/A'}</td>
                        <td className="p-3"><span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">{c.clientType}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === 'plans' && (
            <div className="bg-white rounded-xl shadow-sm p-6">
              {loading ? <p className="text-center py-8">Cargando...</p> : (
                <div className="grid grid-cols-3 gap-4">
                  {data.map((p: any) => (
                    <div key={p.id} className="border rounded-xl p-4 hover:shadow-lg transition">
                      <Wifi className="h-8 w-8 text-blue-600 mb-2" />
                      <h3 className="font-semibold text-lg">{p.name}</h3>
                      <p className="text-2xl font-bold text-blue-600">${Number(p.price).toLocaleString('es-CL')}</p>
                      <p className="text-sm text-gray-500">{p.downloadSpeed} Mbps / {p.uploadSpeed} Mbps</p>
                      <span className="inline-block mt-2 px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs">{p.type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'equipment' && (
            <div className="bg-white rounded-xl shadow-sm p-6">
              {loading ? <p className="text-center py-8">Cargando...</p> : data.length === 0 ? (
                <p className="text-center py-8 text-gray-500">No hay equipos registrados.</p>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {data.map((eq: any) => (
                    <div key={eq.id} className="border rounded-xl p-4">
                      <div className="flex items-center gap-3">
                        <Server className="h-8 w-8 text-gray-400" />
                        <div>
                          <h3 className="font-semibold">{eq.name}</h3>
                          <p className="text-sm text-gray-500">{eq.brand} {eq.model}</p>
                        </div>
                        <span className={`ml-auto px-2 py-1 rounded-full text-xs ${eq.status === 'online' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>{eq.status}</span>
                      </div>
                      {eq.ipAddress && <p className="text-sm text-gray-500 mt-2">IP: {eq.ipAddress}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'invoices' && (
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold mb-4">Facturación</h2>
              {loading ? <p>Cargando...</p> : data.length === 0 ? (
                <p className="text-gray-500">No hay facturas. Usa el botón para generar facturas del mes.</p>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50"><tr>
                    <th className="text-left p-3">Nº</th><th className="text-left p-3">Cliente</th>
                    <th className="text-left p-3">Total</th><th className="text-left p-3">Estado</th>
                  </tr></thead>
                  <tbody>
                    {data.map((inv: any) => (
                      <tr key={inv.id} className="border-t">
                        <td className="p-3">{inv.invoiceNumber}</td>
                        <td className="p-3">{inv.client?.fullName || 'N/A'}</td>
                        <td className="p-3 font-semibold">${Number(inv.total).toLocaleString('es-CL')}</td>
                        <td className="p-3"><span className={`px-2 py-1 rounded-full text-xs ${inv.status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{inv.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === 'tickets' && (
            <div className="bg-white rounded-xl shadow-sm p-6">
              {loading ? <p className="text-center py-8">Cargando...</p> : data.length === 0 ? (
                <p className="text-center py-8 text-gray-500">No hay tickets.</p>
              ) : (
                <div className="space-y-3">
                  {data.map((t: any) => (
                    <div key={t.id} className="border rounded-lg p-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-semibold">{t.subject}</h3>
                          <p className="text-sm text-gray-500">{t.ticketNumber} - {t.client?.fullName || 'N/A'}</p>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-xs ${t.status === 'open' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>{t.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
