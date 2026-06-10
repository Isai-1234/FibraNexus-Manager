import { useState } from 'react'
import { Users, Wifi, DollarSign, LogOut, Server, Ticket, LayoutDashboard, FileText } from 'lucide-react'

export default function AdminDashboard({ user }: { user: any }) {
  const [activeTab, setActiveTab] = useState('dashboard')

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'clients', label: 'Clientes', icon: Users },
    { id: 'plans', label: 'Planes', icon: Wifi },
    { id: 'invoices', label: 'Facturación', icon: DollarSign },
    { id: 'tickets', label: 'Tickets', icon: Ticket },
  ]

  const stats = [
    { name: 'Clientes', value: '0', icon: Users, color: 'text-blue-600' },
    { name: 'Planes', value: '5', icon: Wifi, color: 'text-green-600' },
    { name: 'Equipos', value: '0', icon: Server, color: 'text-purple-600' },
    { name: 'Tickets', value: '0', icon: Ticket, color: 'text-yellow-600' },
  ]

  const logout = () => {
    localStorage.removeItem('token')
    window.location.reload()
  }

  return (
    <div className="min-h-screen bg-gray-100 flex">
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

      <div className="flex-1">
        <header className="bg-white shadow-sm px-8 py-4">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        </header>
        <main className="p-8">
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
            <p className="text-blue-100">Backend: Render + Supabase | Frontend: Vercel | Login: admin@fibranexus.cl / 123456</p>
          </div>
        </main>
      </div>
    </div>
  )
}
