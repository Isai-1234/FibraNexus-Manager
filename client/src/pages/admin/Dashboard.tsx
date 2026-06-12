import { useState, useEffect } from 'react'
import { Users, Wifi, DollarSign, LogOut, Server, Ticket, LayoutDashboard, TrendingUp, AlertTriangle, Plus, X, Edit2, Trash2, CheckCircle, MapPin, Eye, Router, Network, Settings, WifiOff } from 'lucide-react'
import axios from 'axios'
import ClientDetail from './ClientDetail'
import RouterManager from './RouterManager'
import NetworkManager from './NetworkManager'
import BillingSettings from './BillingSettings'
import { formatDateCL } from '../../lib/formatDate'

export default function AdminDashboard({ user, API }: { user: any, API: string }) {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [equipmentSubTab, setEquipmentSubTab] = useState('infrastructure')
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null)
  const [showRouters, setShowRouters] = useState(false)
  const [showNetwork, setShowNetwork] = useState(false)
  const [showBillingSettings, setShowBillingSettings] = useState(false)
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<any>(null)
  const [form, setForm] = useState<any>({})
  const [stats, setStats] = useState<any>({})
  const [clientOverview, setClientOverview] = useState<any[]>([])
  const [clientsWithProblems, setClientsWithProblems] = useState<any[]>([])
  const [overdueInvoices, setOverdueInvoices] = useState<any[]>([])
  const [recentTickets, setRecentTickets] = useState<any[]>([])
  const [error, setError] = useState('')
  const [clients, setClients] = useState<any[]>([])
  const [plans, setPlans] = useState<any[]>([])

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
    })
  }

  useEffect(() => { loadData() }, [activeTab, equipmentSubTab])

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
        setClientOverview(res.data.clientOverview || [])
        setClientsWithProblems(res.data.clientsWithProblems || [])
        setOverdueInvoices(res.data.overdueInvoices || [])
        setRecentTickets(res.data.recentTickets || [])
      } else if (activeTab === 'clients') {
        const res = await api().get('/clients/overview')
        setData(Array.isArray(res.data) ? res.data : [])
      } else {
        const endpoints: Record<string, string> = {
          clients: '/clients', plans: '/plans', services: '/services',
          invoices: '/invoices', tickets: '/tickets',
          equipment: equipmentSubTab === 'routers' ? '/routers' : '/equipment',
          ips: '/ip-management'
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

  async function openNewForm() {
    setEditingItem(null)
    const defaults: any = activeTab === 'services' ? { status: 'active' } : {}
    try {
      if (activeTab === 'services' || activeTab === 'invoices' || activeTab === 'tickets') {
        const [cRes, pRes] = await Promise.all([
          api().get('/clients'),
          activeTab === 'services' ? api().get('/plans') : Promise.resolve({ data: plans }),
        ])
        const clientList = Array.isArray(cRes.data) ? cRes.data : []
        setClients(clientList)
        if (activeTab === 'services') {
          const planList = Array.isArray(pRes.data) ? pRes.data : []
          setPlans(planList)
          if (clientList.length === 1) defaults.clientId = String(clientList[0].id)
          if (planList.length === 1) defaults.planId = String(planList[0].id)
        }
      }
    } catch { /* listas ya cargadas en mount */ }
    setForm(defaults)
    setShowForm(true)
  }

  async function handleSave() {
    const fields = formFields[activeTab] || []
    for (const f of fields) {
      if (f.required && !form[f.name]) {
        alert(`Completa el campo obligatorio: ${f.label}`)
        return
      }
    }
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
    const msg = activeTab === 'clients'
      ? '¿Eliminar este abonado? Se borrarán también sus servicios, facturas y tickets.'
      : activeTab === 'services'
        ? '¿Eliminar esta suscripción? El abonado conserva su cuenta; solo se borra este servicio.'
        : '¿Eliminar este registro?'
    if (!confirm(msg)) return
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
    const flat: any = { ...item }
    if (item.user) { flat.fullName = item.user.fullName; flat.email = item.user.email; flat.phone = item.user.phone }
    setForm(flat)
    setShowForm(true)
  }

  async function handleAction(action: string, id: number) {
    try {
      if (action === 'suspend') await api().put(`/services/${id}/suspend`)
      else if (action === 'reactivate') await api().put(`/services/${id}/reactivate`)
      else if (action === 'pay') {
        const method = prompt('Método de pago (transfer/cash/card/flow):', 'transfer')
        if (method) await api().post('/payments', { invoiceId: id, method })
      }
      loadData()
    } catch (err: any) { alert('Error: ' + (err.response?.data?.error || err.message)) }
  }

  async function handleGenerateInvoices() {
    if (!confirm('¿Generar facturas para servicios con cobro pendiente? Se respeta el ciclo de cada abonado (aniversario o proporcional).')) return
    try {
      const res = await api().post('/invoices/generate', {})
      alert(res.data.message || 'Facturas generadas')
      loadData()
    } catch (err: any) { alert('Error: ' + (err.response?.data?.error || err.message)) }
  }

  const menuSections = [
    {
      title: 'Tus abonados',
      hint: 'Personas que contratan internet',
      items: [
        { id: 'dashboard', label: 'Centro de operaciones', icon: LayoutDashboard },
        { id: 'clients', label: 'Abonados', icon: Users },
        { id: 'services', label: 'Suscripciones', icon: Wifi },
        { id: 'invoices', label: 'Facturación', icon: DollarSign },
        { id: 'billing-settings', label: 'Ajustes facturación', icon: Settings },
        { id: 'tickets', label: 'Soporte', icon: Ticket },
      ],
    },
    {
      title: 'Red e infraestructura',
      hint: 'Equipos de tu ISP',
      items: [
        { id: 'network', label: 'Red ISP (sitios/nodos)', icon: Network },
        { id: 'equipment', label: 'Equipos / Routers', icon: Server },
        { id: 'ips', label: 'Gestión IP', icon: MapPin },
      ],
    },
    {
      title: 'Catálogo comercial',
      hint: 'Planes que vendes (productos)',
      items: [
        { id: 'plans', label: 'Planes de internet', icon: TrendingUp },
      ],
    },
  ]
  const menuItems = menuSections.flatMap((s) => s.items)

  const tabLabels: Record<string, string> = {
    dashboard: 'Centro de operaciones ISP',
    clients: 'Abonados',
    services: 'Suscripciones activas',
    plans: 'Planes comerciales',
    equipment: 'Equipos y routers',
    ips: 'Gestión de IPs',
    invoices: 'Facturación',
    tickets: 'Tickets de soporte',
  }

  const tabDescriptions: Record<string, string> = {
    dashboard: 'Alertas, deudas y acceso rápido a cada cuenta de abonado',
    clients: 'Quienes pagan internet — tienen login en el portal abonado',
    services: 'Qué abonado tiene qué plan instalado (IP, MAC, estado)',
    plans: 'Catálogo de productos de tu ISP — no son personas, son los planes que ofreces',
    equipment: 'Infraestructura de red: routers MikroTik, switches, OLTs…',
    ips: 'Pools y asignación de direcciones IP',
    invoices: 'Facturas mensuales de tus abonados',
    tickets: 'Incidencias reportadas por abonados',
  }

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
      { name: 'clientId', label: 'Abonado', type: 'client-select', required: true },
      { name: 'planId', label: 'Plan comercial', type: 'plan-select', required: true },
      { name: 'ipAddress', label: 'Dirección IP', type: 'text' },
      { name: 'macAddress', label: 'MAC Address', type: 'text' },
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
      { name: 'description', label: 'Descripción', type: 'textarea', required: true },
      { name: 'priority', label: 'Prioridad', type: 'select', options: ['low', 'medium', 'high', 'critical'] },
      { name: 'category', label: 'Categoría', type: 'select', options: ['technical', 'billing', 'installation', 'speed', 'other'] },
      { name: 'status', label: 'Estado', type: 'select', options: ['open', 'in_progress', 'waiting_client', 'resolved', 'closed'] },
    ],
  }

  const statusColor: Record<string, string> = {
    active: 'bg-green-100 text-green-700', suspended: 'bg-yellow-100 text-yellow-700',
    cancelled: 'bg-red-100 text-red-700', pending: 'bg-blue-100 text-blue-700', cut: 'bg-red-100 text-red-700',
    paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700',
    open: 'bg-yellow-100 text-yellow-700', in_progress: 'bg-blue-100 text-blue-700',
    resolved: 'bg-green-100 text-green-700', closed: 'bg-gray-100 text-gray-600',
    online: 'bg-green-100 text-green-700', offline: 'bg-gray-100 text-gray-600',
    maintenance: 'bg-yellow-100 text-yellow-700', error: 'bg-red-100 text-red-700',
    critical: 'bg-red-100 text-red-700', high: 'bg-orange-100 text-orange-700',
    medium: 'bg-blue-100 text-blue-700', low: 'bg-gray-100 text-gray-600',
    individual: 'bg-blue-100 text-blue-700', business: 'bg-purple-100 text-purple-700',
  }

  const statusLabel: Record<string, string> = {
    active: 'Activo', suspended: 'Suspendido', cancelled: 'Cancelado', pending: 'Pendiente', cut: 'Cortado',
    paid: 'Pagada', overdue: 'Vencida', open: 'Abierto', in_progress: 'En proceso',
    resolved: 'Resuelto', closed: 'Cerrado', online: 'Online', offline: 'Offline',
    maintenance: 'Mantenimiento', error: 'Error', critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja',
    individual: 'Individual', business: 'Empresa',
    fiber: 'Fibra', wisp: 'WISP', copper: 'Cobre', wireless: 'Inalámbrico',
    router: 'Router', switch: 'Switch', olt: 'OLT', ont: 'ONT', ap: 'AP', cpe: 'CPE', server: 'Servidor', other: 'Otro',
    admin: 'Administrador', technician: 'Técnico', client: 'Cliente', superadmin: 'Super Admin',
    none: 'Sin servicio', cut: 'Cortado',
    unknown: 'Sin PPPoE',
  }

  const connectionLabel: Record<string, string> = {
    online: 'Online', offline: 'Desconectado', suspended: 'Suspendido', none: '—', unknown: '—',
  }

  const connectionColor: Record<string, string> = {
    online: 'bg-green-100 text-green-700',
    offline: 'bg-orange-100 text-orange-700',
    suspended: 'bg-yellow-100 text-yellow-700',
    none: 'bg-gray-100 text-gray-500',
    unknown: 'bg-gray-100 text-gray-500',
  }

  const logout = () => { localStorage.removeItem('token'); window.location.href = '/login' }

  const duplicateServiceIps = activeTab === 'services'
    ? data.reduce((acc: Record<string, number>, item: any) => {
        const ip = item.ipAddress?.trim()
        if (ip) acc[ip] = (acc[ip] || 0) + 1
        return acc
      }, {})
    : {}

  // Vista detalle cliente
  if (selectedClientId) {
    return (
      <div className="min-h-screen bg-gray-100 flex">
        <Sidebar menuSections={menuSections} activeTab={activeTab} user={user} logout={logout}
          onTabClick={(id) => { setSelectedClientId(null); setActiveTab(id) }} />
        <ClientDetail clientId={selectedClientId} API={API} onBack={() => { setSelectedClientId(null); setActiveTab('clients') }} />
      </div>
    )
  }

  // Vista ajustes facturación
  if (showBillingSettings) {
    return (
      <div className="min-h-screen bg-gray-100 flex">
        <Sidebar menuSections={menuSections} activeTab="billing-settings" user={user} logout={logout}
          onTabClick={(id) => { setShowBillingSettings(false); if (id === 'network') setShowNetwork(true); else setActiveTab(id) }} />
        <BillingSettings API={API} onBack={() => { setShowBillingSettings(false); setActiveTab('dashboard') }} />
      </div>
    )
  }

  // Vista red ISP (sitios/nodos)
  if (showNetwork) {
    return (
      <div className="min-h-screen bg-gray-100 flex">
        <Sidebar menuSections={menuSections} activeTab="network" user={user} logout={logout}
          onTabClick={(id) => { setShowNetwork(false); setActiveTab(id) }} />
        <NetworkManager API={API} onBack={() => { setShowNetwork(false); setActiveTab('equipment') }} />
      </div>
    )
  }

  // Vista gestión de routers
  if (showRouters) {
    return (
      <div className="min-h-screen bg-gray-100 flex">
        <Sidebar menuSections={menuSections} activeTab="equipment" user={user} logout={logout}
          onTabClick={(id) => { setShowRouters(false); setActiveTab(id) }} />
        <RouterManager API={API} onBack={() => { setShowRouters(false); setActiveTab('equipment') }} />
      </div>
    )
  }

  const canDelete = ['clients', 'plans', 'services', 'equipment', 'ips', 'tickets']
  const canEdit = ['clients', 'plans', 'services', 'equipment', 'ips', 'tickets']

  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Modal Form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5 border-b pb-4">
              <h3 className="text-lg font-bold">{editingItem ? '✏️ Editar' : '➕ Nuevo'} {{
                ips: 'registro IP', services: 'suscripción', clients: 'abonado',
                plans: 'plan', tickets: 'ticket', equipment: 'equipo', invoices: 'factura',
              }[activeTab] || activeTab.slice(0, -1)}</h3>
              <button onClick={() => setShowForm(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              {(formFields[activeTab] || []).map(f => (
                <div key={f.name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{f.label} {f.required && <span className="text-red-500">*</span>}</label>
                  {f.type === 'client-select' ? (
                    <select className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 bg-white" value={form[f.name] || ''} onChange={e => setForm({...form, [f.name]: e.target.value})}>
                      <option value="">Seleccionar abonado...</option>
                      {clients.length === 0 && <option disabled value="">— Sin abonados (créalos en Abonados) —</option>}
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
                    <input type={f.type} className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" value={form[f.name] || ''} onChange={e => setForm({...form, [f.name]: e.target.value})} />
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

      <Sidebar menuSections={menuSections} activeTab={activeTab} user={user} logout={logout}
        onTabClick={(id) => {
          if (id === 'network') { setShowNetwork(true); return }
          if (id === 'billing-settings') { setShowBillingSettings(true); return }
          setActiveTab(id); setData([]); setError('')
        }} />

      {/* Main Content */}
      <div className="flex-1 overflow-auto bg-gray-50">
        {user?.organization?.plan === 'trial' && user?.organization?.trialDaysLeft != null && (
          <div className={`px-8 py-3 text-sm flex items-center justify-between ${user.organization.trialDaysLeft <= 3 ? 'bg-amber-50 text-amber-900 border-b border-amber-200' : 'bg-sky-50 text-sky-900 border-b border-sky-200'}`}>
            <span>
              FibraNexus · trial de plataforma — <strong>{user.organization.trialDaysLeft} días</strong> restantes
            </span>
            <span className="text-xs opacity-75">Tú operas <strong>{user.organization.name}</strong> · tus abonados son otra cosa</span>
          </div>
        )}
        <header className="bg-white shadow-sm px-8 py-4 flex justify-between items-center sticky top-0 z-10 border-b">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{tabLabels[activeTab] || activeTab}</h1>
            {tabDescriptions[activeTab] && (
              <p className="text-sm text-gray-500 mt-0.5">{tabDescriptions[activeTab]}</p>
            )}
            {activeTab !== 'dashboard' && activeTab !== 'equipment' && (
              <p className="text-xs text-gray-400 mt-1">{data.length} registro{data.length !== 1 ? 's' : ''}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={loadData} className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm font-medium">🔄 Actualizar</button>
            {activeTab === 'invoices' && (
              <button onClick={handleGenerateInvoices} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium flex items-center gap-2">📄 Generar Facturas</button>
            )}
            {activeTab !== 'dashboard' && activeTab !== 'invoices' && activeTab !== 'equipment' && (
              <button onClick={openNewForm} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2">
                <Plus className="h-4 w-4" /> Nuevo
              </button>
            )}
          </div>
        </header>

        <main className="p-8">
          {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2"><AlertTriangle className="h-5 w-5 flex-shrink-0" /> {error}</div>}

          {/* DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {[
                  { label: 'Abonados', value: stats?.totalClients || 0, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50', tab: 'clients' },
                  { label: 'Online', value: stats?.onlineClients || 0, icon: Wifi, color: 'text-green-600', bg: 'bg-green-50', tab: 'clients' },
                  { label: 'Desconectados', value: stats?.offlineClients || 0, icon: WifiOff, color: 'text-orange-600', bg: 'bg-orange-50', tab: 'clients' },
                  { label: 'Morosos', value: stats?.delinquentClients || 0, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', tab: 'invoices' },
                  { label: 'Servicios activos', value: stats?.activeServices || 0, icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50', tab: 'services' },
                  { label: 'Suspendidos', value: stats?.suspendedServices || 0, icon: WifiOff, color: 'text-yellow-600', bg: 'bg-yellow-50', tab: 'services' },
                  { label: 'Por cobrar', value: '$' + (stats?.pendingAmount || 0).toLocaleString('es-CL'), icon: DollarSign, color: 'text-amber-600', bg: 'bg-amber-50', tab: 'invoices' },
                  { label: 'Vencidas', value: stats?.overdueCount || 0, icon: DollarSign, color: 'text-red-600', bg: 'bg-red-50', tab: 'invoices' },
                  { label: 'Tickets abiertos', value: stats?.openTickets || 0, icon: Ticket, color: 'text-yellow-600', bg: 'bg-yellow-50', tab: 'tickets' },
                  { label: 'Routers', value: stats?.totalRouters || 0, icon: Router, color: 'text-cyan-600', bg: 'bg-cyan-50', action: () => { setActiveTab('equipment'); setEquipmentSubTab('routers'); setShowRouters(true) } },
                ].map(s => (
                  <div key={s.label} className="bg-white p-4 rounded-xl shadow-sm hover:shadow-md transition cursor-pointer border border-gray-100"
                    onClick={() => s.action ? s.action() : setActiveTab(s.tab)}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`p-1.5 rounded-lg ${s.bg}`}><s.icon className={`h-4 w-4 ${s.color}`} /></div>
                      <p className="text-xs text-gray-500 font-medium leading-tight">{s.label}</p>
                    </div>
                    <p className="text-xl font-bold text-gray-900">{s.value}</p>
                  </div>
                ))}
              </div>

              {clientsWithProblems.length > 0 && (
                <div className="bg-white rounded-xl border border-red-100 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 bg-red-50 border-b border-red-100 flex justify-between items-center">
                    <div>
                      <h2 className="font-semibold text-red-900 flex items-center gap-2"><AlertTriangle className="h-5 w-5" /> Abonados que requieren atención</h2>
                      <p className="text-sm text-red-700/80">Deuda, servicio suspendido o tickets abiertos</p>
                    </div>
                    <button onClick={() => setActiveTab('clients')} className="text-sm text-red-700 hover:underline">Ver todos →</button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                        <tr>
                          {['Abonado', 'Plan', 'Conexión', 'Deuda', 'Mora', 'Tickets', ''].map(h => (
                            <th key={h} className="text-left p-4">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {clientsWithProblems.slice(0, 8).map((c: any) => (
                          <tr key={c.id} className="hover:bg-red-50/30">
                            <td className="p-4">
                              <p className="font-medium">{c.fullName}</p>
                              <p className="text-xs text-gray-400">{c.email}{c.ipAddress ? ` · ${c.ipAddress}` : ''}</p>
                            </td>
                            <td className="p-4 text-sm">
                              {c.planName || '—'}
                              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[c.serviceStatus] || 'bg-gray-100'}`}>
                                {statusLabel[c.serviceStatus] || c.serviceStatus}
                              </span>
                            </td>
                            <td className="p-4">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${connectionColor[c.connectionStatus] || 'bg-gray-100'}`}>
                                {connectionLabel[c.connectionStatus] || c.connectionStatus}
                              </span>
                            </td>
                            <td className="p-4 text-sm font-medium text-red-600">{c.pendingAmount > 0 ? '$' + c.pendingAmount.toLocaleString('es-CL') : '—'}</td>
                            <td className="p-4 text-sm">{c.overdueDays > 0 ? <span className="text-red-600 font-medium">{c.overdueDays} días</span> : '—'}</td>
                            <td className="p-4 text-sm">{c.openTickets || '—'}</td>
                            <td className="p-4">
                              <button onClick={() => setSelectedClientId(c.id)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">
                                Gestionar cuenta
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {overdueInvoices.length > 0 && (
                <div className="bg-white rounded-xl border border-amber-100 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 bg-amber-50 border-b border-amber-100 flex justify-between items-center">
                    <div>
                      <h2 className="font-semibold text-amber-900 flex items-center gap-2"><DollarSign className="h-5 w-5" /> Facturas vencidas</h2>
                      <p className="text-sm text-amber-700/80">${(stats?.overdueAmount || 0).toLocaleString('es-CL')} en mora</p>
                    </div>
                    <button onClick={() => setActiveTab('invoices')} className="text-sm text-amber-800 hover:underline">Ver facturas →</button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                        <tr>
                          {['Factura', 'Abonado', 'Total', 'Vencimiento', 'Atraso', ''].map(h => (
                            <th key={h} className="text-left p-4">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {overdueInvoices.map((inv: any) => (
                          <tr key={inv.id} className="hover:bg-amber-50/30">
                            <td className="p-4 font-mono text-sm text-indigo-600">{inv.invoiceNumber}</td>
                            <td className="p-4 font-medium">{inv.clientName}</td>
                            <td className="p-4 font-bold text-red-600">${Number(inv.total).toLocaleString('es-CL')}</td>
                            <td className="p-4 text-sm">{formatDateCL(inv.dueDate)}</td>
                            <td className="p-4"><span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full font-medium">{inv.overdueDays} días</span></td>
                            <td className="p-4">
                              <button onClick={() => setSelectedClientId(inv.clientId)} className="text-xs text-blue-600 hover:underline">Ver abonado</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b flex justify-between items-center">
                    <h2 className="font-semibold">Abonados (estilo UISP)</h2>
                    <button onClick={() => setActiveTab('clients')} className="text-sm text-blue-600 hover:underline">Ver listado completo →</button>
                  </div>
                  {clientOverview.length === 0 ? (
                    <div className="p-10 text-center text-gray-400">
                      <Users className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">Aún no hay abonados registrados.</p>
                      <button onClick={() => { setActiveTab('clients'); setShowForm(true) }} className="mt-3 text-blue-600 text-sm hover:underline">+ Crear primer abonado</button>
                    </div>
                  ) : (
                    <div className="divide-y max-h-96 overflow-y-auto">
                      {clientOverview.map((c: any) => (
                        <div key={c.id} className="px-6 py-3 flex items-center justify-between hover:bg-gray-50 gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm truncate">{c.fullName}</p>
                              {c.connectionStatus === 'online' && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">ONLINE</span>
                              )}
                              {c.connectionStatus === 'offline' && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">DESCONECTADO</span>
                              )}
                              {c.isDelinquent && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">MORA {c.overdueDays}d</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 truncate">
                              {c.planName || 'Sin plan'} · {c.city || 'Sin ciudad'}
                              {c.pendingAmount > 0 && ` · Saldo $${c.pendingAmount.toLocaleString('es-CL')}`}
                            </p>
                          </div>
                          <button onClick={() => setSelectedClientId(c.id)} className="text-xs text-blue-600 hover:underline flex-shrink-0">Gestionar</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b">
                    <h2 className="font-semibold">Tickets recientes</h2>
                  </div>
                  {recentTickets.length === 0 ? (
                    <p className="p-8 text-center text-gray-400 text-sm">Sin tickets recientes</p>
                  ) : (
                    <div className="divide-y">
                      {recentTickets.map((t: any) => (
                        <div key={t.id} className="px-6 py-3 hover:bg-gray-50">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-sm font-medium">{t.subject}</p>
                              <p className="text-xs text-gray-400">{t.clientName || 'Cliente'} · {new Date(t.createdAt).toLocaleDateString('es-CL')}</p>
                            </div>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor[t.priority] || 'bg-gray-100'}`}>{statusLabel[t.priority] || t.priority}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* EQUIPOS con subtabs */}
          {activeTab === 'equipment' && (
            <div className="space-y-4">
              {/* Subtabs */}
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
                {[
                  { id: 'infrastructure', label: '🖥️ Infraestructura' },
                  { id: 'routers', label: '📡 Routers / Agentes' },
                ].map(t => (
                  <button key={t.id} onClick={() => { setEquipmentSubTab(t.id); if (t.id === 'routers') setShowRouters(true) }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition ${equipmentSubTab === t.id ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Botón nuevo equipo */}
              <div className="flex justify-end">
                <button onClick={() => { setEditingItem(null); setForm({}); setShowForm(true) }} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2">
                  <Plus className="h-4 w-4" /> Nuevo equipo
                </button>
              </div>

              {/* Tabla equipos */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                {loading ? (
                  <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div></div>
                ) : data.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <Server className="h-12 w-12 mx-auto mb-3 opacity-20" />
                    <p className="font-medium text-gray-500">Sin equipos registrados</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b">
                        <tr>{['Equipo', 'Tipo', 'IP / Host', 'RouterOS', 'Uptime', 'CPU', 'Estado', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {data.map((item: any) => (
                          <tr key={item.id} className="hover:bg-blue-50/30 transition">
                            <td className="p-4 font-medium">{item.name}<br/><span className="text-xs text-gray-400">{item.brand} {item.model}</span></td>
                            <td className="p-4"><span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs">{statusLabel[item.type] || item.type}</span></td>
                            <td className="p-4 font-mono text-sm">{item.ipAddress || item.credentials?.tunnelHostname || <span className="text-gray-400">—</span>}</td>
                            <td className="p-4 text-xs">{item.routerInfo?.version?.split(' ')[0] || item.firmware || <span className="text-gray-400">—</span>}</td>
                            <td className="p-4 text-xs">{item.routerInfo?.uptime || <span className="text-gray-400">—</span>}</td>
                            <td className="p-4 text-xs">{item.routerInfo?.cpuLoad != null ? `${item.routerInfo.cpuLoad}%` : <span className="text-gray-400">—</span>}</td>
                            <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[item.status] || 'bg-gray-100'}`}>{statusLabel[item.status] || item.status}</span></td>
                            <td className="p-4">
                              <div className="flex items-center gap-1">
                                <button onClick={() => openEdit(item)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition"><Edit2 className="h-4 w-4" /></button>
                                <button onClick={() => handleDelete(item.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"><Trash2 className="h-4 w-4" /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TABLAS GENERALES */}
          {activeTab !== 'dashboard' && activeTab !== 'equipment' && (
            <div className="space-y-4">
              {activeTab === 'plans' && (
                <div className="bg-purple-50 border border-purple-100 rounded-xl px-5 py-3 text-sm text-purple-900">
                  <strong>Catálogo comercial</strong> — Aquí defines los planes que vendes (ej. 20 Mbps, 100 Mbps).
                  Los <strong>abonados</strong> están en otra pestaña; aquí solo creas productos.
                </div>
              )}
              {activeTab === 'services' && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-3 text-sm text-blue-900">
                  <strong>Suscripciones</strong> — Une un <strong>abonado</strong> con un <strong>plan comercial</strong>.
                  Es la conexión real de internet (IP, MAC, activo/suspendido).
                  {Object.values(duplicateServiceIps).some((n) => n > 1) && (
                    <p className="mt-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      ⚠️ Hay IPs duplicadas en la lista. Elimina la suscripción repetida — dos abonados con la misma IP causan conflicto en la red.
                    </p>
                  )}
                </div>
              )}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100">
              {loading ? (
                <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4"></div></div>
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
                        {activeTab === 'clients' && ['Abonado', 'Plan', 'Conexión', 'Deuda', 'Mora', 'Estado', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}
                        {activeTab === 'services' && ['ID', 'Abonado', 'Plan comercial', 'IP', 'MAC', 'Estado', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}
                        {activeTab === 'plans' && ['Plan comercial', 'Tipo', 'Velocidad', 'Precio', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}
                        {activeTab === 'ips' && ['Dirección IP', 'Subred', 'Gateway', 'VLAN', 'Estado', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}
                        {activeTab === 'invoices' && ['Nº Factura', 'Cliente', 'Período', 'Neto', 'IVA', 'Total', 'Estado', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}
                        {activeTab === 'tickets' && ['Ticket', 'Cliente', 'Categoría', 'Prioridad', 'Estado', 'Fecha', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.map((item: any) => (
                        <tr key={item.id} className="hover:bg-blue-50/30 transition">
                          {activeTab === 'clients' && <>
                            <td className="p-4">
                              <p className="font-medium text-gray-900">{item.fullName || 'N/A'}</p>
                              <p className="text-xs text-gray-400">{item.email} · {item.city || '—'}</p>
                            </td>
                            <td className="p-4 text-sm">
                              {item.planName || '—'}
                              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[item.serviceStatus] || 'bg-gray-100'}`}>
                                {statusLabel[item.serviceStatus] || item.serviceStatus}
                              </span>
                            </td>
                            <td className="p-4">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${connectionColor[item.connectionStatus] || 'bg-gray-100'}`}>
                                {connectionLabel[item.connectionStatus] || item.connectionStatus}
                              </span>
                            </td>
                            <td className="p-4 text-sm font-medium">{item.pendingAmount > 0 ? <span className="text-red-600">${item.pendingAmount.toLocaleString('es-CL')}</span> : '—'}</td>
                            <td className="p-4 text-sm">{item.overdueDays > 0 ? <span className="text-red-600 font-medium">{item.overdueDays} días</span> : '—'}</td>
                            <td className="p-4">
                              {item.hasProblem ? (
                                <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full">Requiere atención</span>
                              ) : (
                                <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">OK</span>
                              )}
                            </td>
                          </>}
                          {activeTab === 'services' && <>
                            <td className="p-4 text-xs font-mono text-gray-400">#{item.id}</td>
                            <td className="p-4 font-medium">{item.client?.fullName || 'N/A'}</td>
                            <td className="p-4 text-sm">{item.plan?.name || 'N/A'}<br/><span className="text-xs text-gray-400">{item.plan?.downloadSpeed}/{item.plan?.uploadSpeed} Mbps</span></td>
                            <td className="p-4 font-mono text-sm">
                              {item.ipAddress ? (
                                <span className={duplicateServiceIps[item.ipAddress.trim()] > 1 ? 'text-red-600 font-semibold' : ''}>
                                  {item.ipAddress}
                                  {duplicateServiceIps[item.ipAddress.trim()] > 1 && ' ⚠️'}
                                </span>
                              ) : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="p-4 font-mono text-xs text-gray-500">{item.macAddress || <span className="text-gray-400">—</span>}</td>
                            <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[item.status] || 'bg-gray-100'}`}>{statusLabel[item.status] || item.status}</span></td>
                          </>}
                          {activeTab === 'plans' && <>
                            <td className="p-4 font-medium">{item.name}</td>
                            <td className="p-4"><span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs">{statusLabel[item.type] || item.type}</span></td>
                            <td className="p-4 font-mono text-sm">{item.downloadSpeed}/{item.uploadSpeed} Mbps</td>
                            <td className="p-4 font-bold text-blue-600">${Number(item.price).toLocaleString('es-CL')}</td>
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
                            <td className="p-4">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[item.status] || 'bg-gray-100'}`}>{statusLabel[item.status] || item.status}</span>
                              {item.status === 'overdue' && item.dueDate && (
                                <p className="text-xs text-red-600 mt-1">Atrasada {Math.max(0, Math.floor((Date.now() - new Date(String(item.dueDate).split('T')[0]).getTime()) / 86400000))} días</p>
                              )}
                            </td>
                          </>}
                          {activeTab === 'tickets' && <>
                            <td className="p-4"><span className="font-medium text-sm">{item.subject}</span><br/><span className="text-xs text-gray-400 font-mono">{item.ticketNumber}</span></td>
                            <td className="p-4 text-sm">{item.client?.fullName || 'N/A'}</td>
                            <td className="p-4 text-sm text-gray-600">{item.category || '—'}</td>
                            <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[item.priority] || 'bg-gray-100'}`}>{statusLabel[item.priority] || item.priority}</span></td>
                            <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[item.status] || 'bg-gray-100'}`}>{statusLabel[item.status] || item.status}</span></td>
                            <td className="p-4 text-sm text-gray-500">{new Date(item.createdAt).toLocaleDateString('es-CL')}</td>
                          </>}
                          <td className="p-4">
                            <div className="flex items-center gap-1">
                              {activeTab === 'services' && (
                                <>
                                  {item.status === 'active'
                                    ? <button onClick={() => handleAction('suspend', item.id)} className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 font-medium">⏸ Suspender</button>
                                    : <button onClick={() => handleAction('reactivate', item.id)} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 font-medium">▶ Reactivar</button>}
                                  <button onClick={() => handleDelete(item.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition" title="Eliminar suscripción"><Trash2 className="h-4 w-4" /></button>
                                </>
                              )}
                              {activeTab === 'invoices' && item.status === 'pending' && (
                                <button onClick={() => handleAction('pay', item.id)} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 font-medium">💰 Pagar</button>
                              )}
                              {canEdit.includes(activeTab) && activeTab !== 'services' && (
                                <button onClick={() => openEdit(item)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition"><Edit2 className="h-4 w-4" /></button>
                              )}
                              {activeTab === 'clients' && (
                                <button onClick={() => setSelectedClientId(item.id)} className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 font-medium">Gestionar</button>
                              )}
                              {canDelete.includes(activeTab) && activeTab !== 'services' && (
                                <button onClick={() => handleDelete(item.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"><Trash2 className="h-4 w-4" /></button>
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
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

// Sidebar como componente separado para reutilizar
const roleLabels: Record<string, string> = {
  admin: 'Administrador ISP',
  technician: 'Técnico',
  client: 'Cliente',
  superadmin: 'Super Admin',
}

function Sidebar({ menuSections, activeTab, user, logout, onTabClick }: any) {
  return (
    <div className="w-64 bg-gray-900 text-white min-h-screen flex flex-col flex-shrink-0">
      <div className="p-6 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center"><Wifi className="h-6 w-6" /></div>
          <div>
            <h2 className="text-lg font-bold truncate max-w-[140px]">{user?.organization?.name || 'FibraNexus'}</h2>
            <p className="text-gray-400 text-xs">Operador ISP · panel admin</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 mt-2 overflow-y-auto pb-4">
        {menuSections.map((section: any) => (
          <div key={section.title} className="mb-4">
            <div className="px-6 py-2">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{section.title}</p>
              <p className="text-[10px] text-gray-600">{section.hint}</p>
            </div>
            {section.items.map((item: any) => (
              <button key={item.id} onClick={() => onTabClick(item.id)}
                className={`w-full flex items-center gap-3 px-6 py-2.5 text-left text-sm transition ${activeTab === item.id ? 'bg-blue-600 border-r-4 border-blue-300 text-white' : 'hover:bg-gray-800 text-gray-300'}`}>
                <item.icon className="h-4 w-4 flex-shrink-0" /> {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="p-4 border-t border-gray-800 bg-gray-950">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-sm font-bold">{user?.fullName?.charAt(0) || 'A'}</div>
            <div><p className="text-xs font-medium truncate max-w-[100px]">{user?.fullName}</p><p className="text-xs text-gray-400">{roleLabels[user?.role] || user?.role}</p></div>
          </div>
          <button onClick={logout} className="text-gray-400 hover:text-red-400 transition p-1"><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  )
}
