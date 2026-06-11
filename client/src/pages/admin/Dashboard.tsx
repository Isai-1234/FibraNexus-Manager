import { useState, useEffect } from 'react'
import { Users, Wifi, DollarSign, LogOut, Server, Ticket, LayoutDashboard, TrendingUp, AlertTriangle, Plus, X, Edit2, Trash2, CheckCircle, MapPin, Eye } from 'lucide-react'
import axios from 'axios'
import ClientDetail from './ClientDetail'
import RouterManager from './RouterManager'

export default function AdminDashboard({ user, API }: { user: any, API: string }) {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null)
  const [showRouters, setShowRouters] = useState(false)
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<any>(null)
  const [form, setForm] = useState<any>({})
  const [stats, setStats] = useState<any>({})
  const [error, setError] = useState('')
  const [clients, setClients] = useState<any[]>([])
  const [plans, setPlans] = useState<any[]>([])

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
    })
  }

  useEffect(() => { loadData() }, [activeTab])

  // Preload clients and plans for selectors
  useEffect(() => {
    api().get('/clients').then(r => setClients(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    api().get('/plans').then(r => setPlans(Array.isArray(r.data) ? r.data : [])).catch(() => {})
  }, [])

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
      setError('Error al cargar datos: ' + (err.response?.data?.error || err.message))
    }
    setLoading(false)
  }

  async function handleSave() {
    try {
      const endpoints: Record<string, string> = {
        clients: '/clients', plans: '/plans', services: '/services',
        tickets: '/tickets', equipment: '/equipment', ips: '/ip-management'
      }
      const endpoint = endpoints[activeTab]
      if (editingItem) {
        await api().put(`${endpoint}/${editingItem.id}`, form)
      } else {
        await api().post(endpoint, form)
      }
      setShowForm(false)
      setForm({})
      setEditingItem(null)
      loadData()
    } catch (err: any) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('¿Eliminar este registro?')) return
    try {
      const endpoints: Record<string, string> = {
        clients: '/clients', plans: '/plans', services: '/services',
        tickets: '/tickets', equipment: '/equipment', ips: '/ip-management'
      }
      await api().delete(`${endpoints[activeTab]}/${id}`)
      loadData()
    } catch (err: any) {
      alert('Error al eliminar: ' + (err.response?.data?.error || err.message))
    }
  }

  function openEdit(item: any) {
    setEditingItem(item)
    // Flatten nested fields for editing
    const flat: any = { ...item }
    if (item.user) {
      flat.fullName = item.user.fullName
      flat.email = item.user.email
      flat.phone = item.user.phone
    }
    setForm(flat)
    setShowForm(true)
  }

  function openNew() {
    setEditingItem(null)
    setForm({})
    setShowForm(true)
  }

  async function handleAction(action: string, id: number) {
    try {
      if (action === 'suspend') await api().put(`/services/${id}/suspend`)
      else if (action === 'reactivate') await api().put(`/services/${id}/reactivate`)
      else if (action === 'pay') {
        const method = prompt('Método de pago:', 'transfer')
        if (method) await api().post('/payments', { invoiceId: id, method })
      }
      loadData()
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
    { id: 'routers', label: 'Routers', icon: Server },
  ]

  const formFields: Record<string, any[]> = {
    clients: [
      { name: 'fullName', label: 'Nombre completo', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'password', label: 'Contraseña', type: 'password', required: !editingItem },
      { name: 'phone', label: 'Teléfono', type: 'text' },
      { name: 'clientType', label: 'Tipo', type: 'select', options: ['individual', 'business'] },
      { name: 'rut', label: 'RUT (ej: 12345678-9)', type: 'text' },
      { name: 'city', label: 'Ciudad', type: 'text' },
      { name: 'region', label: 'Región', type: 'select', options: ['Arica y Parinacota','Tarapacá','Antofagasta','Atacama','Coquimbo','Valparaíso','Metropolitana','O\'Higgins','Maule','Ñuble','Biobío','La Araucanía','Los Ríos','Los Lagos','Aysén','Magallanes'] },
      { name: 'address', label: 'Dirección', type: 'text' },
    ],
    services: [
      { name: 'clientId', label: 'Cliente', type: 'client-select', required: true },
      { name: 'planId', label: 'Plan', type: 'plan-select', required: true },
      { name: 'ipAddress', label: 'Dirección IP', type: 'text' },
      { name: 'macAddress', label: 'MAC Address (AA:BB:CC:DD:EE:FF)', type: 'text' },
      { name: 'status', label: 'Estado', type: 'select', options: ['active', 'suspended', 'pending', 'cancelled', 'cut'] },
    ],
    plans: [
      { name: 'name', label: 'Nombre del plan', type: 'text', required: true },
      { name: 'type', label: 'Tecnología', type: 'select', options: ['fiber', 'wisp', 'copper', 'wireless'] },
      { name: 'downloadSpeed', label: 'Velocidad descarga (Mbps)', type: 'number', required: true },
      { name: 'uploadSpeed', label: 'Velocidad subida (Mbps)', type: 'number', required: true },
      { name: 'price', label: 'Precio mensual (CLP)', type: 'number', required: true },
      { name: 'setupPrice', label: 'Precio instalación (CLP)', type: 'number' },
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
      { name: 'location', label: 'Ubicación/Nodo', type: 'text' },
      { name: 'status', label: 'Estado', type: 'select', options: ['online', 'offline', 'maintenance', 'error', 'installing'] },
      { name: 'snmpCommunity', label: 'SNMP Community', type: 'text' },
    ],
    ips: [
      { name: 'address', label: 'Dirección IP', type: 'text', required: true },
      { name: 'subnet', label: 'Máscara de subred', type: 'text' },
      { name: 'gateway', label: 'Gateway', type: 'text' },
      { name: 'vlan', label: 'VLAN ID', type: 'number' },
      { name: 'status', label: 'Estado', type: 'select', options: ['available', 'assigned', 'reserved'] },
    ],
    tickets: [
      { name: 'clientId', label: 'Cliente', type: 'client-select', required: true },
      { name: 'subject', label: 'Asunto', type: 'text', required: true },
      { name: 'description', label: 'Descripción del problema', type: 'textarea', required: true },
      { name: 'priority', label: 'Prioridad', type: 'select', options: ['low', 'medium', 'high', 'critical'] },
      { name: 'category', label: 'Categoría', type: 'select', options: ['technical', 'billing', 'installation', 'speed', 'other'] },
      { name: 'status', label: 'Estado', type: 'select', options: ['open', 'in_progress', 'waiting_client', 'resolved', 'closed'] },
    ],
  }

  const statusColor: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    suspended: 'bg-yellow-100 text-yellow-700',
    cancelled: 'bg-red-100 text-red-700',
    pending: 'bg-blue-100 text-blue-700',
    cut: 'bg-red-100 text-red-700',
    paid: 'bg-green-100 text-green-700',
    overdue: 'bg-red-100 text-red-700',
    open: 'bg-yellow-100 text-yellow-700',
    in_progress: 'bg-blue-100 text-blue-700',
    resolved: 'bg-green-100 text-green-700',
    closed: 'bg-gray-100 text-gray-600',
    online: 'bg-green-100 text-green-700',
    offline: 'bg-gray-100 text-gray-600',
    maintenance: 'bg-yellow-100 text-yellow-700',
    error: 'bg-red-100 text-red-700',
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-blue-100 text-blue-700',
    low: 'bg-gray-100 text-gray-600',
  }

  const statusLabel: Record<string, string> = {
    active: 'Activo', suspended: 'Suspendido', cancelled: 'Cancelado',
    pending: 'Pendiente', cut: 'Cortado', paid: 'Pagada', overdue: 'Vencida',
    open: 'Abierto', in_progress: 'En proceso', resolved: 'Resuelto', closed: 'Cerrado',
    online: 'Online', offline: 'Offline', maintenance: 'Mantenimiento', error: 'Error',
    critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja',
    individual: 'Individual', business: 'Empresa',
    fiber: 'Fibra', wisp: 'WISP', copper: 'Cobre', wireless: 'Inalámbrico',
    router: 'Router', switch: 'Switch', olt: 'OLT', ont: 'ONT',
    ap: 'AP', cpe: 'CPE', server: 'Servidor', other: 'Otro',
  }

  const logout = () => { localStorage.removeItem('token'); window.location.href = '/login' }

  if (selectedClientId) {
    return (
      <div className="min-h-screen bg-gray-100 flex">
        <div className="w-64 bg-gray-900 text-white min-h-screen flex flex-col flex-shrink-0">
          <div className="p-6 border-b border-gray-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center"><Wifi className="h-6 w-6" /></div>
              <div><h2 className="text-lg font-bold">FibraNexus</h2><p className="text-gray-400 text-xs">ISP Manager Pro</p></div>
            </div>
          </div>
          <nav className="flex-1 mt-2">
            {menuItems.map(item => (
              <button key={item.id} onClick={() => { setSelectedClientId(null); setActiveTab(item.id) }}
                className="w-full flex items-center gap-3 px-6 py-3 text-left text-sm hover:bg-gray-800 text-gray-300 transition">
                <item.icon className="h-4 w-4 flex-shrink-0" /> {item.label}
              </button>
            ))}
          </nav>
          <div className="p-4 border-t border-gray-800 bg-gray-950">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-sm font-bold">{user?.fullName?.charAt(0) || 'A'}</div>
                <div><p className="text-xs font-medium truncate max-w-[100px]">{user?.fullName}</p><p className="text-xs text-gray-400 capitalize">{user?.role}</p></div>
              </div>
              <button onClick={logout} className="text-gray-400 hover:text-red-400 transition p-1"><LogOut className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
        <ClientDetail clientId={selectedClientId} API={API} onBack={() => { setSelectedClientId(null); setActiveTab('clients') }} />
      if (showRouters) return (
        <div className="min-h-screen bg-gray-100 flex">
          <RouterManager API={API} onBack={() => setShowRouters(false)} />
        </div>
      )
      </div>
    )
  }

  const canDelete = ['clients', 'plans', 'equipment', 'ips', 'tickets']
  const canEdit = ['clients', 'plans', 'services', 'equipment', 'ips', 'tickets']

  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Modal Form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5 border-b pb-4">
              <h3 className="text-lg font-bold text-gray-900">
                {editingItem ? '✏️ Editar' : '➕ Nuevo'} {activeTab === 'ips' ? 'IP' : activeTab.slice(0, -1)}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              {(formFields[activeTab] || []).map(f => (
                <div key={f.name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {f.label} {f.required && <span className="text-red-500">*</span>}
                  </label>
                  {f.type === 'client-select' ? (
                    <select className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 bg-white" value={form[f.name] || ''} onChange={e => setForm({...form, [f.name]: e.target.value})}>
                      <option value="">Seleccionar cliente...</option>
                      {clients.map((c: any) => <option key={c.id} value={c.id}>{c.user?.fullName || c.id} — {c.city || ''}</option>)}
                    </select>
                  ) : f.type === 'plan-select' ? (
                    <select className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 bg-white" value={form[f.name] || ''} onChange={e => setForm({...form, [f.name]: e.target.value})}>
                      <option value="">Seleccionar plan...</option>
                      {plans.map((p: any) => <option key={p.id} value={p.id}>{p.name} — ${Number(p.price).toLocaleString('es-CL')}/mes</option>)}
                    </select>
                  ) : f.type === 'select' ? (
                    <select className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 bg-white" value={form[f.name] || ''} onChange={e => setForm({...form, [f.name]: e.target.value})}>
                      <option value="">Seleccionar...</option>
                      {f.options?.map((o: string) => <option key={o} value={o}>{statusLabel[o] || o}</option>)}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" rows={3} value={form[f.name] || ''} onChange={e => setForm({...form, [f.name]: e.target.value})} />
                  ) : (
                    <input type={f.type} className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" value={form[f.name] || ''} onChange={e => setForm({...form, [f.name]: e.target.value})} placeholder={f.type === 'number' ? '0' : ''} />
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 border rounded-lg hover:bg-gray-50 font-medium">Cancelar</button>
              <button onClick={handleSave} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
                {editingItem ? '💾 Guardar cambios' : '✅ Crear'}
              </button>
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
            <button key={item.id} onClick={() => { if (item.id === 'routers') { setShowRouters(true) } else { setActiveTab(item.id); setData([]); setError('') } }}
              className={`w-full flex items-center gap-3 px-6 py-3 text-left text-sm transition ${activeTab === item.id ? 'bg-blue-600 border-r-4 border-blue-300 text-white' : 'hover:bg-gray-800 text-gray-300'}`}>
              <item.icon className="h-4 w-4 flex-shrink-0" /> {item.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-800 bg-gray-950">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-sm font-bold">{user?.fullName?.charAt(0) || 'A'}</div>
              <div><p className="text-xs font-medium truncate max-w-[100px]">{user?.fullName}</p><p className="text-xs text-gray-400 capitalize">{user?.role}</p></div>
            </div>
            <button onClick={logout} title="Cerrar sesión" className="text-gray-400 hover:text-red-400 transition p-1"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto bg-gray-50">
        <header className="bg-white shadow-sm px-8 py-4 flex justify-between items-center sticky top-0 z-10 border-b">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{activeTab === 'ips' ? 'Gestión de IPs' : menuItems.find(m => m.id === activeTab)?.label || activeTab}</h1>
            {activeTab === 'dashboard' && <p className="text-sm text-gray-500">Resumen general del sistema</p>}
            {activeTab !== 'dashboard' && <p className="text-sm text-gray-500">{data.length} registro{data.length !== 1 ? 's' : ''}</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={loadData} className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm font-medium">🔄 Actualizar</button>
            {activeTab === 'invoices' && (
              <button onClick={handleGenerateInvoices} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium flex items-center gap-2">
                📄 Generar Facturas
              </button>
            )}
            {activeTab !== 'dashboard' && activeTab !== 'invoices' && (
              <button onClick={openNew} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2">
                <Plus className="h-4 w-4" /> Nuevo
              </button>
            )}
          </div>
        </header>

        <main className="p-8">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" /> {error}
            </div>
          )}

          {/* DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                {[
                  { label: 'Clientes', value: stats?.totalClients || 0, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50', tab: 'clients' },
                  { label: 'Servicios Activos', value: stats?.activeServices || 0, icon: Wifi, color: 'text-green-600', bg: 'bg-green-50', tab: 'services' },
                  { label: 'Planes', value: stats?.totalPlans || 0, icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-50', tab: 'plans' },
                  { label: 'Equipos', value: stats?.totalEquipment || 0, icon: Server, color: 'text-indigo-600', bg: 'bg-indigo-50', tab: 'equipment' },
                  { label: 'Tickets Abiertos', value: stats?.openTickets || 0, icon: AlertTriangle, color: 'text-yellow-600', bg: 'bg-yellow-50', tab: 'tickets' },
                  { label: 'Por Cobrar', value: '$' + (stats?.pendingAmount || 0).toLocaleString('es-CL'), icon: DollarSign, color: 'text-red-600', bg: 'bg-red-50', tab: 'invoices' },
                ].map(s => (
                  <div key={s.label} className="bg-white p-5 rounded-xl shadow-sm hover:shadow-md transition cursor-pointer border border-gray-100" onClick={() => setActiveTab(s.tab)}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`p-2 rounded-lg ${s.bg}`}><s.icon className={`h-5 w-5 ${s.color}`} /></div>
                      <p className="text-xs text-gray-500 font-medium">{s.label}</p>
                    </div>
                    <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gradient-to-br from-blue-600 to-purple-700 rounded-xl p-6 text-white">
                  <h2 className="text-xl font-bold mb-1">🚀 FibraNexus Manager v1.0</h2>
                  <p className="text-blue-100 text-sm mb-4">Sistema de gestión integral para ISPs chilenos</p>
                  <div className="grid grid-cols-2 gap-2 text-xs text-blue-50">
                    {['CRM Completo', 'Facturación + IVA', 'Gestión de Red', 'Tickets de Soporte', 'Panel Admin', 'Multi-Router'].map(f => (
                      <div key={f} className="bg-white/10 rounded-lg px-3 py-2 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> {f}</div>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                  <h3 className="font-semibold text-gray-900 mb-4">📊 Resumen financiero</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-sm text-gray-600">Facturas pendientes</span>
                      <span className="font-bold text-yellow-600">${(stats?.pendingAmount || 0).toLocaleString('es-CL')}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-sm text-gray-600">Servicios activos</span>
                      <span className="font-bold text-green-600">{stats?.activeServices || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-sm text-gray-600">Tickets abiertos</span>
                      <span className="font-bold text-red-600">{stats?.openTickets || 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* DATA TABLES */}
          {activeTab !== 'dashboard' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4"></div>
                  <p className="text-gray-500">Cargando datos...</p>
                </div>
              ) : data.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                  <div className="text-6xl mb-4">📭</div>
                  <p className="text-lg font-medium text-gray-500">No hay {activeTab === 'ips' ? 'IPs' : activeTab} registrados</p>
                  <p className="text-sm mt-1">Usa el botón "+ Nuevo" para agregar</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        {activeTab === 'clients' && ['Cliente', 'Email', 'Teléfono', 'Ciudad', 'Tipo', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}
                        {activeTab === 'services' && ['Cliente', 'Plan', 'IP', 'MAC', 'Estado', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}
                        {activeTab === 'plans' && ['Plan', 'Tipo', 'Velocidad', 'Precio', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}
                        {activeTab === 'equipment' && ['Equipo', 'Tipo', 'IP', 'Ubicación', 'Estado', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}
                        {activeTab === 'ips' && ['Dirección IP', 'Subred', 'Gateway', 'VLAN', 'Estado', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}
                        {activeTab === 'invoices' && ['Nº Factura', 'Cliente', 'Período', 'Neto', 'IVA', 'Total', 'Estado', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}
                        {activeTab === 'tickets' && ['Ticket', 'Cliente', 'Categoría', 'Prioridad', 'Estado', 'Fecha', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.map((item: any) => (
                        <tr key={item.id} className="hover:bg-blue-50/30 transition">
                          {activeTab === 'clients' && <>
                            <td className="p-4 font-medium text-gray-900">{item.user?.fullName || 'N/A'}</td>
                            <td className="p-4 text-gray-600 text-sm">{item.user?.email || 'N/A'}</td>
                            <td className="p-4 text-sm">{item.user?.phone || <span className="text-gray-400">—</span>}</td>
                            <td className="p-4 text-sm">{item.city ? `${item.city}` : <span className="text-gray-400">—</span>}</td>
                            <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[item.clientType] || 'bg-gray-100 text-gray-600'}`}>{statusLabel[item.clientType] || item.clientType}</span></td>
                          </>}
                          {activeTab === 'services' && <>
                            <td className="p-4 font-medium">{item.client?.fullName || 'N/A'}</td>
                            <td className="p-4 text-sm">{item.plan?.name || 'N/A'}<br/><span className="text-xs text-gray-400">{item.plan?.downloadSpeed}/{item.plan?.uploadSpeed} Mbps</span></td>
                            <td className="p-4 font-mono text-sm">{item.ipAddress || <span className="text-gray-400">—</span>}</td>
                            <td className="p-4 font-mono text-xs text-gray-500">{item.macAddress || <span className="text-gray-400">—</span>}</td>
                            <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[item.status] || 'bg-gray-100 text-gray-600'}`}>{statusLabel[item.status] || item.status}</span></td>
                          </>}
                          {activeTab === 'plans' && <>
                            <td className="p-4 font-medium">{item.name}</td>
                            <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700`}>{statusLabel[item.type] || item.type}</span></td>
                            <td className="p-4 text-sm font-mono">{item.downloadSpeed}/{item.uploadSpeed} Mbps</td>
                            <td className="p-4 font-bold text-blue-600">${Number(item.price).toLocaleString('es-CL')}</td>
                          </>}
                          {activeTab === 'equipment' && <>
                            <td className="p-4 font-medium">{item.name}<br/><span className="text-xs text-gray-400">{item.brand} {item.model}</span></td>
                            <td className="p-4"><span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs">{statusLabel[item.type] || item.type}</span></td>
                            <td className="p-4 font-mono text-sm">{item.ipAddress || <span className="text-gray-400">—</span>}</td>
                            <td className="p-4 text-sm">{item.location || <span className="text-gray-400">—</span>}</td>
                            <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[item.status] || 'bg-gray-100'}`}>{statusLabel[item.status] || item.status}</span></td>
                          </>}
                          {activeTab === 'ips' && <>
                            <td className="p-4 font-mono font-medium">{item.address}</td>
                            <td className="p-4 text-sm">{item.subnet || <span className="text-gray-400">—</span>}</td>
                            <td className="p-4 text-sm">{item.gateway || <span className="text-gray-400">—</span>}</td>
                            <td className="p-4 text-sm">{item.vlan || <span className="text-gray-400">—</span>}</td>
                            <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${item.status === 'available' ? 'bg-green-100 text-green-700' : item.status === 'assigned' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{item.status === 'available' ? 'Disponible' : item.status === 'assigned' ? 'Asignada' : 'Reservada'}</span></td>
                          </>}
                          {activeTab === 'invoices' && <>
                            <td className="p-4 font-mono text-sm text-indigo-600">{item.invoiceNumber}</td>
                            <td className="p-4 text-sm">{item.client?.fullName || 'N/A'}</td>
                            <td className="p-4 text-sm">{item.billingPeriod || '—'}</td>
                            <td className="p-4 text-sm">${Number(item.amount).toLocaleString('es-CL')}</td>
                            <td className="p-4 text-sm">${Number(item.tax).toLocaleString('es-CL')}</td>
                            <td className="p-4 font-bold">${Number(item.total).toLocaleString('es-CL')}</td>
                            <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[item.status] || 'bg-gray-100'}`}>{statusLabel[item.status] || item.status}</span></td>
                          </>}
                          {activeTab === 'tickets' && <>
                            <td className="p-4"><span className="font-medium text-sm">{item.subject}</span><br/><span className="text-xs text-gray-400 font-mono">{item.ticketNumber}</span></td>
                            <td className="p-4 text-sm">{item.client?.fullName || item.client?.email || 'N/A'}</td>
                            <td className="p-4 text-sm text-gray-600">{item.category || '—'}</td>
                            <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[item.priority] || 'bg-gray-100'}`}>{statusLabel[item.priority] || item.priority}</span></td>
                            <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[item.status] || 'bg-gray-100'}`}>{statusLabel[item.status] || item.status}</span></td>
                            <td className="p-4 text-sm text-gray-500">{new Date(item.createdAt).toLocaleDateString('es-CL')}</td>
                          </>}
                          {/* Actions */}
                          <td className="p-4">
                            <div className="flex items-center gap-1">
                              {activeTab === 'services' && (
                                item.status === 'active'
                                  ? <button onClick={() => handleAction('suspend', item.id)} className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 font-medium">⏸ Suspender</button>
                                  : <button onClick={() => handleAction('reactivate', item.id)} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 font-medium">▶ Reactivar</button>
                              )}
                              {activeTab === 'invoices' && item.status === 'pending' && (
                                <button onClick={() => handleAction('pay', item.id)} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 font-medium">💰 Marcar pagada</button>
                              )}
                              {canEdit.includes(activeTab) && activeTab !== 'services' && (
                                <button onClick={() => openEdit(item)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition" title="Editar"><Edit2 className="h-4 w-4" /></button>
                              )}
                              {activeTab === 'clients' && (
                                <button onClick={() => setSelectedClientId(item.id)} className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded transition" title="Ver detalle"><Eye className="h-4 w-4" /></button>
                              )}
                              {canDelete.includes(activeTab) && (
                                <button onClick={() => handleDelete(item.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition" title="Eliminar"><Trash2 className="h-4 w-4" /></button>
                              )}
                            </div>
                          </td>
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