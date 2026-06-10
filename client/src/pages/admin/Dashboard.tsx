import { useState, useEffect } from 'react'
import { Users, Wifi, DollarSign, LogOut, Server, Ticket, LayoutDashboard, Network, Plus, X, MapPin, Power, PowerOff, CreditCard, TrendingUp, AlertTriangle, CheckCircle, Clock, Wrench } from 'lucide-react'
import axios from 'axios'

export default function AdminDashboard({ user, API }: { user: any, API: string }) {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<any>({})
  const [stats, setStats] = useState<any>({})
  const [error, setError] = useState('')

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
    })
  }

  useEffect(() => { loadData() }, [activeTab])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      if (activeTab === 'dashboard') {
        const res = await api().get('/dashboard/admin')
        setStats(res.data.stats || {})
      } else {
        const endpoints: Record<string, string> = {
          clients: '/clients', plans: '/plans', services: '/services',
          invoices: '/invoices', tickets: '/tickets', equipment: '/equipment', ips: '/ip-management'
        }
        if (endpoints[activeTab]) {
          const res = await api().get(endpoints[activeTab])
          setData(Array.isArray(res.data) ? res.data : [])
        }
      }
    } catch (err: any) {
      console.error('Load error:', err)
      setError('Error al cargar datos: ' + (err.response?.data?.error || err.message))
    }
    setLoading(false)
  }

  async function handleCreate() {
    try {
      const endpoints: Record<string, string> = {
        clients: '/clients', plans: '/plans', services: '/services',
        tickets: '/tickets', equipment: '/equipment', ips: '/ip-management'
      }
      await api().post(endpoints[activeTab], form)
      setShowForm(false)
      setForm({})
      loadData()
      alert('¡Creado exitosamente!')
    } catch (err: any) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  async function handleAction(action: string, id: number, extra?: any) {
    try {
      if (action === 'suspend') await api().put(`/services/${id}/suspend`)
      else if (action === 'reactivate') await api().put(`/services/${id}/reactivate`)
      else if (action === 'pay') await api().post('/payments', extra)
      loadData()
      alert('¡Acción realizada!')
    } catch (err: any) { alert('Error: ' + (err.response?.data?.error || err.message)) }
  }

  async function handleGenerateInvoices() {
    const month = prompt('Período (YYYY-MM):', new Date().toISOString().slice(0, 7))
    const due = prompt('Fecha vencimiento (YYYY-MM-DD):', new Date(new Date().getFullYear(), new Date().getMonth() + 2, 5).toISOString().slice(0, 10))
    if (month && due) {
      try {
        const res = await api().post('/invoices/generate', { billingPeriod: month, dueDate: due })
        alert(res.data.message || 'Facturas generadas')
        loadData()
      } catch (err: any) { alert('Error: ' + (err.response?.data?.error || err.message)) }
    }
  }

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'clients', label: 'Clientes', icon: Users },
    { id: 'services', label: 'Servicios', icon: Wifi },
    { id: 'plans', label: 'Planes', icon: TrendingUp },
    { id: 'equipment', label: 'Equipos', icon: Server },
    { id: 'ips', label: 'Gestión IP', icon: MapPin },
    { id: 'invoices', label: 'Facturación', icon: DollarSign },
    { id: 'tickets', label: 'Tickets', icon: Ticket },
  ]

  const logout = () => { localStorage.removeItem('token'); window.location.href = '/login' }

  const formFields: Record<string, any[]> = {
    clients: [
      { name: 'fullName', label: 'Nombre completo', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'phone', label: 'Teléfono', type: 'text' },
      { name: 'password', label: 'Contraseña', type: 'password' },
      { name: 'clientType', label: 'Tipo', type: 'select', options: ['individual', 'business'] },
      { name: 'rut', label: 'RUT (ej: 12345678-9)', type: 'text' },
      { name: 'city', label: 'Ciudad', type: 'text' },
      { name: 'region', label: 'Región', type: 'text' },
      { name: 'address', label: 'Dirección', type: 'text' },
    ],
    services: [
      { name: 'clientId', label: 'ID del Cliente', type: 'number', required: true },
      { name: 'planId', label: 'ID del Plan', type: 'number', required: true },
      { name: 'ipAddress', label: 'Dirección IP', type: 'text' },
      { name: 'macAddress', label: 'Dirección MAC', type: 'text' },
    ],
    plans: [
      { name: 'name', label: 'Nombre del plan', type: 'text', required: true },
      { name: 'type', label: 'Tecnología', type: 'select', options: ['fiber', 'wisp', 'copper', 'wireless'] },
      { name: 'downloadSpeed', label: 'Velocidad descarga (Mbps)', type: 'number', required: true },
      { name: 'uploadSpeed', label: 'Velocidad subida (Mbps)', type: 'number', required: true },
      { name: 'price', label: 'Precio mensual ($)', type: 'number', required: true },
      { name: 'description', label: 'Descripción', type: 'textarea' },
    ],
    equipment: [
      { name: 'name', label: 'Nombre del equipo', type: 'text', required: true },
      { name: 'type', label: 'Tipo', type: 'select', options: ['router', 'switch', 'olt', 'ont', 'ap', 'cpe', 'server', 'other'] },
      { name: 'brand', label: 'Marca', type: 'text', required: true },
      { name: 'model', label: 'Modelo', type: 'text', required: true },
      { name: 'ipAddress', label: 'Dirección IP', type: 'text' },
      { name: 'macAddress', label: 'MAC Address', type: 'text' },
      { name: 'serialNumber', label: 'Número de serie', type: 'text' },
      { name: 'location', label: 'Ubicación', type: 'text' },
    ],
    ips: [
      { name: 'address', label: 'Dirección IP', type: 'text', required: true },
      { name: 'subnet', label: 'Máscara de subred', type: 'text' },
      { name: 'gateway', label: 'Gateway', type: 'text' },
      { name: 'vlan', label: 'VLAN ID', type: 'number' },
    ],
    tickets: [
      { name: 'clientId', label: 'ID del Cliente', type: 'number', required: true },
      { name: 'subject', label: 'Asunto', type: 'text', required: true },
      { name: 'description', label: 'Descripción del problema', type: 'textarea', required: true },
      { name: 'priority', label: 'Prioridad', type: 'select', options: ['low', 'medium', 'high', 'critical'] },
      { name: 'category', label: 'Categoría', type: 'select', options: ['technical', 'billing', 'installation', 'speed', 'other'] },
    ],
  }

  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Modal Form */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4 border-b pb-3">
              <h3 className="text-lg font-bold">➕ Nuevo {activeTab === 'ips' ? 'IP' : activeTab.slice(0, -1)}</h3>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              {(formFields[activeTab] || []).map(f => (
                <div key={f.name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{f.label} {f.required && <span className="text-red-500">*</span>}</label>
                  {f.type === 'select' ? (
                    <select className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" value={form[f.name] || ''} onChange={e => setForm({...form, [f.name]: e.target.value})}>
                      <option value="">Seleccionar...</option>
                      {f.options?.map((o: string) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" rows={3} value={form[f.name] || ''} onChange={e => setForm({...form, [f.name]: e.target.value})} />
                  ) : (
                    <input type={f.type} className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" value={form[f.name] || ''} onChange={e => setForm({...form, [f.name]: f.type === 'number' ? e.target.value : e.target.value})} />
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 border rounded-lg hover:bg-gray-50 font-medium">Cancelar</button>
              <button onClick={handleCreate} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">✅ Crear</button>
            </div>
          </div>
        </div>
      )}
      
      {/* Sidebar */}
      <div className="w-64 bg-gray-900 text-white min-h-screen flex flex-col flex-shrink-0">
        <div className="p-6 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center"><Wifi className="h-6 w-6" /></div>
            <div><h2 className="text-lg font-bold">FibraNexus</h2><p className="text-gray-400 text-xs">ISP Manager Pro</p></div>
          </div>
        </div>
        <nav className="flex-1 mt-2 overflow-y-auto">
          {menuItems.map(item => (
            <button key={item.id} onClick={() => { setActiveTab(item.id); setData([]); setError('') }}
              className={`w-full flex items-center gap-3 px-6 py-2.5 text-left text-sm transition ${activeTab === item.id ? 'bg-blue-600 border-r-4 border-blue-300' : 'hover:bg-gray-800 text-gray-300'}`}>
              <item.icon className="h-4 w-4" /> {item.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-800 bg-gray-950">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-sm font-bold">{user?.fullName?.charAt(0) || 'A'}</div>
              <div><p className="text-xs font-medium">{user?.fullName}</p><p className="text-xs text-gray-400 capitalize">{user?.role}</p></div>
            </div>
            <button onClick={logout} className="text-gray-400 hover:text-red-400 transition p-1"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto bg-gray-50">
        <header className="bg-white shadow-sm px-8 py-4 flex justify-between items-center sticky top-0 z-10">
          <div>
            <h1 className="text-xl font-bold text-gray-900 capitalize">{activeTab === 'ips' ? 'Gestión de IPs' : activeTab}</h1>
            {activeTab === 'dashboard' && <p className="text-sm text-gray-500">Resumen general del sistema</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={loadData} className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm font-medium flex items-center gap-2">
              🔄 Actualizar
            </button>
            {activeTab === 'invoices' && (
              <button onClick={handleGenerateInvoices} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium flex items-center gap-2">
                📄 Generar Facturas
              </button>
            )}
            {activeTab !== 'dashboard' && activeTab !== 'invoices' && (
              <button onClick={() => { setForm({}); setShowForm(true) }} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2">
                <Plus className="h-4 w-4" /> Nuevo
              </button>
            )}
          </div>
        </header>

        <main className="p-8">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> {error}
            </div>
          )}

          {/* DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                {[
                  { label: 'Clientes', value: stats?.totalClients || 0, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
                  { label: 'Servicios Activos', value: stats?.activeServices || 0, icon: Wifi, color: 'text-green-600', bg: 'bg-green-50' },
                  { label: 'Planes', value: stats?.totalPlans || 0, icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-50' },
                  { label: 'Equipos', value: stats?.totalEquipment || 0, icon: Server, color: 'text-indigo-600', bg: 'bg-indigo-50' },
                  { label: 'Tickets Abiertos', value: stats?.openTickets || 0, icon: AlertTriangle, color: 'text-yellow-600', bg: 'bg-yellow-50' },
                  { label: 'Por Cobrar', value: '$' + (stats?.pendingAmount || 0).toLocaleString('es-CL'), icon: DollarSign, color: 'text-red-600', bg: 'bg-red-50' },
                ].map(s => (
                  <div key={s.label} className="bg-white p-5 rounded-xl shadow-sm hover:shadow-md transition cursor-pointer" onClick={() => setActiveTab(s.label === 'Clientes' ? 'clients' : s.label === 'Servicios Activos' ? 'services' : s.label === 'Planes' ? 'plans' : s.label === 'Equipos' ? 'equipment' : s.label === 'Tickets Abiertos' ? 'tickets' : 'invoices')}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`p-2 rounded-lg ${s.bg}`}><s.icon className={`h-5 w-5 ${s.color}`} /></div>
                      <p className="text-xs text-gray-500 font-medium">{s.label}</p>
                    </div>
                    <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl p-8 text-white">
                <h2 className="text-2xl font-bold mb-2">🚀 FibraNexus Manager v1.0</h2>
                <p className="text-blue-100 text-lg">Sistema de gestión integral para ISPs chilenos</p>
                <div className="grid grid-cols-3 gap-4 mt-4 text-sm text-blue-50">
                  <div className="bg-white/10 rounded-lg p-3">✅ CRM Completo</div>
                  <div className="bg-white/10 rounded-lg p-3">✅ Facturación + IVA</div>
                  <div className="bg-white/10 rounded-lg p-3">✅ Gestión de Red</div>
                  <div className="bg-white/10 rounded-lg p-3">✅ Tickets de Soporte</div>
                  <div className="bg-white/10 rounded-lg p-3">✅ Panel Admin</div>
                  <div className="bg-white/10 rounded-lg p-3">✅ Multi-Router</div>
                </div>
              </div>
            </div>
          )}

          {/* Data Tables */}
          {activeTab !== 'dashboard' && (
            <div className="bg-white rounded-xl shadow-sm">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4"></div>
                  <p className="text-gray-500">Cargando datos...</p>
                </div>
              ) : data.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                  <div className="text-5xl mb-4">📭</div>
                  <p className="text-lg font-medium">No hay {activeTab === 'ips' ? 'IPs' : activeTab} registrados</p>
                  <p className="text-sm mt-1">Usa el botón "Nuevo" para agregar</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        {activeTab === 'clients' && <><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Cliente</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Email</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Teléfono</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Ciudad</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Tipo</th></>}
                        {activeTab === 'services' && <><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Cliente</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Plan</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">IP</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Estado</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Acción</th></>}
                        {activeTab === 'plans' && <><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Plan</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Tipo</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Velocidad</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Precio</th></>}
                        {activeTab === 'equipment' && <><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Equipo</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Tipo</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">IP</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Ubicación</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Estado</th></>}
                        {activeTab === 'ips' && <><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Dirección IP</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Subred</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Gateway</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">VLAN</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Asignado</th></>}
                        {activeTab === 'invoices' && <><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Nº Factura</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Cliente</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Período</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Neto</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">IVA</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Total</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Estado</th></>}
                        {activeTab === 'tickets' && <><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Ticket</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Cliente</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Prioridad</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Estado</th><th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase">Fecha</th></>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.map((item: any) => (
                        <tr key={item.id} className="hover:bg-blue-50/50 transition">
                          {activeTab === 'clients' && <><td className="p-4 font-medium">{item.user?.fullName || 'N/A'}</td><td className="p-4 text-gray-600">{item.user?.email || 'N/A'}</td><td className="p-4">{item.user?.phone || '-'}</td><td className="p-4">{item.city || '-'}, {item.region || ''}</td><td className="p-4"><span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">{item.clientType}</span></td></>}
                          {activeTab === 'services' && <><td className="p-4 font-medium">{item.client?.fullName || 'N/A'}</td><td className="p-4">{item.plan?.name || 'N/A'}</td><td className="p-4 font-mono text-sm">{item.ipAddress || '-'}</td><td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${item.status === 'active' ? 'bg-green-100 text-green-700' : item.status === 'suspended' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{item.status}</span></td><td className="p-4">{item.status === 'active' ? <button onClick={() => handleAction('suspend', item.id)} className="text-yellow-600 hover:text-yellow-800 text-xs font-medium">⏸ Suspender</button> : <button onClick={() => handleAction('reactivate', item.id)} className="text-green-600 hover:text-green-800 text-xs font-medium">▶ Reactivar</button>}</td></>}
                          {activeTab === 'plans' && <><td className="p-4 font-medium">{item.name}</td><td className="p-4"><span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">{item.type}</span></td><td className="p-4">{item.downloadSpeed}/{item.uploadSpeed} Mbps</td><td className="p-4 font-bold text-blue-600">${Number(item.price).toLocaleString('es-CL')}</td></>}
                          {activeTab === 'equipment' && <><td className="p-4 font-medium">{item.name}<br/><span className="text-xs text-gray-400">{item.brand} {item.model}</span></td><td className="p-4"><span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs">{item.type}</span></td><td className="p-4 font-mono text-sm">{item.ipAddress || '-'}</td><td className="p-4">{item.location || '-'}</td><td className="p-4"><span className={`inline-block w-2 h-2 rounded-full mr-2 ${item.status === 'online' ? 'bg-green-500' : 'bg-gray-400'}`}></span>{item.status}</td></>}
                          {activeTab === 'ips' && <><td className="p-4 font-mono font-medium">{item.address}</td><td className="p-4">{item.subnet || '-'}</td><td className="p-4">{item.gateway || '-'}</td><td className="p-4">{item.vlan || '-'}</td><td className="p-4">{item.assignedTo?.fullName || <span className="text-gray-400">Disponible</span>}</td></>}
                          {activeTab === 'invoices' && <><td className="p-4 font-medium text-indigo-600 font-mono text-sm">{item.invoiceNumber}</td><td className="p-4">{item.client?.fullName || 'N/A'}</td><td className="p-4">{item.billingPeriod}</td><td className="p-4">${Number(item.amount).toLocaleString('es-CL')}</td><td className="p-4">${Number(item.tax).toLocaleString('es-CL')}</td><td className="p-4 font-bold">${Number(item.total).toLocaleString('es-CL')}</td><td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${item.status === 'paid' ? 'bg-green-100 text-green-700' : item.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{item.status === 'paid' ? 'Pagada' : item.status === 'pending' ? 'Pendiente' : 'Vencida'}</span></td></>}
                          {activeTab === 'tickets' && <><td className="p-4"><span className="font-medium">{item.subject}</span><br/><span className="text-xs text-gray-400">{item.ticketNumber}</span></td><td className="p-4">{item.client?.fullName || item.client?.email || 'N/A'}</td><td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${item.priority === 'critical' ? 'bg-red-100 text-red-700' : item.priority === 'high' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{item.priority}</span></td><td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${item.status === 'open' ? 'bg-yellow-100 text-yellow-700' : item.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>{item.status}</span></td><td className="p-4 text-sm text-gray-500">{new Date(item.createdAt).toLocaleDateString('es-CL')}</td></>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
