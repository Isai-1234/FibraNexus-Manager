import { useState, useEffect } from 'react'
import { Users, Wifi, DollarSign, LogOut, Server, Ticket, LayoutDashboard, FileText, Network, Plus, Search } from 'lucide-react'
import axios from 'axios'

const API = 'https://fibranexus-manager.onrender.com/api'

function getToken() {
  return localStorage.getItem('token') || ''
}

function api() {
  return axios.create({
    baseURL: API,
    headers: { Authorization: `Bearer ${getToken()}` }
  })
}

export default function AdminDashboard({ user }: { user: any }) {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [clients, setClients] = useState([])
  const [plans, setPlans] = useState([])
  const [invoices, setInvoices] = useState([])
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadData()
  }, [activeTab])

  async function loadData() {
    setLoading(true)
    try {
      if (activeTab === 'clients') {
        const res = await api().get('/clients')
        setClients(res.data || [])
      } else if (activeTab === 'plans') {
        const res = await api().get('/plans')
        setPlans(res.data || [])
      } else if (activeTab === 'invoices') {
        const res = await api().get('/invoices')
        setInvoices(res.data || [])
      } else if (activeTab === 'tickets') {
        const res = await api().get('/tickets')
        setTickets(res.data || [])
      }
    } catch (err) {
      console.error('Error loading data:', err)
    }
    setLoading(false)
  }

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'clients', label: 'Clientes', icon: Users },
    { id: 'plans', label: 'Planes', icon: Wifi },
    { id: 'invoices', label: 'Facturación', icon: DollarSign },
    { id: 'tickets', label: 'Tickets', icon: Ticket },
    { id: 'equipment', label: 'Equipos', icon: Network },
  ]

  const stats = [
    { name: 'Clientes', value: clients.length || '...', icon: Users, color: 'text-blue-600' },
    { name: 'Planes', value: plans.length || '...', icon: Wifi, color: 'text-green-600' },
    { name: 'Facturas', value: invoices.length || '...', icon: DollarSign, color: 'text-yellow-600' },
    { name: 'Tickets', value: tickets.length || '...', icon: Ticket, color: 'text-red-600' },
  ]

  const logout = () => {
    localStorage.removeItem('token')
    window.location.reload()
  }

  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Sidebar */}
      <div className="w-64 bg-gray-900 text-white min-h-screen flex flex-col">
        <div className="p-6">
          <h2 className="text-xl font-bold">FibraNexus</h2>
          <p className="text-gray-400 text-sm">Panel Admin</p>
        </div>
        <nav className="flex-1 mt-4">
          {menuItems.map(item => (
            <button key={item.id} onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-6 py-3 text-left transition ${activeTab === item.id ? 'bg-blue-600' : 'hover:bg-gray-800'}`}>
              <item.icon className="h-5 w-5" /> {item.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{user?.fullName}</p>
              <p className="text-xs text-gray-400 capitalize">{user?.role}</p>
            </div>
            <button onClick={logout} className="text-gray-400 hover:text-white"><LogOut className="h-5 w-5" /></button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <header className="bg-white shadow-sm px-8 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900 capitalize">{activeTab}</h1>
          <button onClick={loadData} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
            Actualizar
          </button>
        </header>

        <main className="p-8">
          {/* Dashboard View */}
          {activeTab === 'dashboard' && (
            <>
              <div className="grid grid-cols-4 gap-6 mb-8">
                {stats.map(stat => (
                  <div key={stat.name} className="bg-white p-6 rounded-xl shadow-sm">
                    <div className="flex items-center gap-4">
                      <stat.icon className={`h-8 w-8 ${stat.color}`} />
                      <div><p className="text-sm text-gray-500">{stat.name}</p><p className="text-2xl font-bold">{stat.value}</p></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl p-8 text-white">
                <h2 className="text-2xl font-bold mb-2">¡FibraNexus Manager está vivo!</h2>
                <p className="text-blue-100">Backend: Render + Supabase | Frontend: Vercel</p>
                <p className="text-blue-100 mt-2">Usa el menú lateral para navegar entre secciones.</p>
              </div>
            </>
          )}

          {/* Clients View */}
          {activeTab === 'clients' && (
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold">Lista de Clientes</h2>
              </div>
              {loading ? <p>Cargando...</p> : clients.length === 0 ? (
                <p className="text-gray-500">No hay clientes registrados. ¡Próximamente podrás agregar clientes!</p>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-3">Nombre</th>
                      <th className="text-left p-3">Email</th>
                      <th className="text-left p-3">Ciudad</th>
                      <th className="text-left p-3">Tipo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((c: any) => (
                      <tr key={c.id} className="border-t hover:bg-gray-50">
                        <td className="p-3">{c.user?.fullName || 'N/A'}</td>
                        <td className="p-3">{c.user?.email || 'N/A'}</td>
                        <td className="p-3">{c.city || 'N/A'}</td>
                        <td className="p-3"><span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">{c.clientType}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Plans View */}
          {activeTab === 'plans' && (
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold mb-4">Planes de Internet</h2>
              {loading ? <p>Cargando...</p> : plans.length === 0 ? (
                <p className="text-gray-500">No hay planes registrados.</p>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  {plans.map((p: any) => (
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

          {/* Invoices View */}
          {activeTab === 'invoices' && (
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold mb-4">Facturación</h2>
              {loading ? <p>Cargando...</p> : (
                <p className="text-gray-500">Panel de facturación listo. Próximamente: generar facturas, registrar pagos.</p>
              )}
            </div>
          )}

          {/* Tickets View */}
          {activeTab === 'tickets' && (
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold mb-4">Tickets de Soporte</h2>
              {loading ? <p>Cargando...</p> : (
                <p className="text-gray-500">Sistema de tickets listo. Próximamente: crear y gestionar tickets.</p>
              )}
            </div>
          )}

          {/* Equipment View */}
          {activeTab === 'equipment' && (
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold mb-4">Equipos de Red</h2>
              <p className="text-gray-500">Gestión de equipos lista. Próximamente: inventario de routers, switches, OLTs.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
