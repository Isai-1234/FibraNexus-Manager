import { useState, useEffect } from 'react'
import { Users, Wifi, DollarSign, LogOut, Server, Ticket, LayoutDashboard, TrendingUp, AlertTriangle, Plus, X, Edit2, Trash2, CheckCircle, MapPin, Eye, Router, Network, Settings, WifiOff, Radar, Search, Antenna } from 'lucide-react'
import axios from 'axios'
import ClientDetail from './ClientDetail'
import RouterManager from './RouterManager'
import NetworkManager from './NetworkManager'
import BillingSettings from './BillingSettings'
import FinanceDashboard from './FinanceDashboard'
import DetectedDevices from './DetectedDevices'
import StaffManager from './StaffManager'
import WorkOrdersManager from './WorkOrdersManager'
import FieldWorkOrders from '../technician/FieldWorkOrders'
import ThemeToggle from '../../components/ThemeToggle'
import { formatDateCL, formatBillingPeriod } from '../../lib/formatDate'
import EquipmentInventory from './EquipmentInventory'
import DeviceIpLink from '../../components/DeviceIpLink'
import LiveBandwidthChart from '../../components/LiveBandwidthChart'
import SubscriberStatusDonut from '../../components/SubscriberStatusDonut'

export default function AdminDashboard({ user, API }: { user: any, API: string }) {
  const [activeTab, setActiveTab] = useState(user?.role === 'technician' ? 'work-orders' : 'dashboard')
  const [equipmentSubTab, setEquipmentSubTab] = useState('infrastructure')
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null)
  const [clientInitialTab, setClientInitialTab] = useState('overview')
  const [showRouters, setShowRouters] = useState(false)
  const [showBillingSettings, setShowBillingSettings] = useState(false)
  const [showRedIsp, setShowRedIsp] = useState(false)
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
  const [recentPayments, setRecentPayments] = useState<any[]>([])
  const [error, setError] = useState('')
  const [clients, setClients] = useState<any[]>([])
  const [plans, setPlans] = useState<any[]>([])
  const [orgAlerts, setOrgAlerts] = useState<any[]>([])
  const [alertPanel, setAlertPanel] = useState<null | 'desconectados' | 'morosos' | 'cobros'>(null)
  const [clientSearch, setClientSearch] = useState('')
  const [clientLifecycleFilter, setClientLifecycleFilter] = useState('all')
  const [clientConnFilter, setClientConnFilter] = useState('all')
  const [clientDebtFilter, setClientDebtFilter] = useState(false)
  const [confirmGenerateInvoices, setConfirmGenerateInvoices] = useState(false)
  const [generatingInvoices, setGeneratingInvoices] = useState(false)
  const [generateInvoicesMsg, setGenerateInvoicesMsg] = useState('')
  const [listHydrated, setListHydrated] = useState(false)
  const [borderRouters, setBorderRouters] = useState<any[]>([])
  const [bandwidthRouterId, setBandwidthRouterId] = useState<number | null>(null)

  /** Agrupa alertas en la tarjeta del dashboard que corresponde. */
  const ALERT_BUCKETS: Record<string, 'desconectados' | 'morosos' | 'cobros'> = {
    cpe_offline: 'desconectados',
    router_offline: 'desconectados',
    agent_down: 'desconectados',
    mora: 'morosos',
    payment_fail: 'cobros',
  }

  const ALERT_WHY: Record<string, string> = {
    cpe_offline: 'El CPE/antena no responde en el último chequeo. Revisa alimentación, enlace radio o si el abonado apagó el equipo.',
    router_offline: 'El router figura offline en inventario. Puede ser corte de energía, enlace o fallo de monitoreo.',
    agent_down: 'El agente EdgeOS/MikroTik no envió heartbeat. El nodo puede estar caído, sin internet de gestión o con el script detenido.',
    mora: 'Hay factura(s) vencida(s) sin saldar. El abonado está en mora comercial.',
    payment_fail: 'Un intento de cobro/webhook falló o fue rechazado. Revisa la pasarela y el estado de la factura.',
  }

  function alertsForBucket(bucket: 'desconectados' | 'morosos' | 'cobros') {
    return orgAlerts.filter(a => ALERT_BUCKETS[a.kind] === bucket)
  }

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
    })
  }

  useEffect(() => { if (!showRedIsp && activeTab !== 'red-isp' && activeTab !== 'network') loadData() }, [activeTab, equipmentSubTab, showRedIsp])

  useEffect(() => {
    api().get('/clients').then(r => setClients(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    api().get('/plans').then(r => setPlans(Array.isArray(r.data) ? r.data : [])).catch(() => {})
  }, [])

  // Routers de borde / MikroTik para el gráfico de Mbps en vivo
  useEffect(() => {
    if (activeTab !== 'dashboard') return
    let cancelled = false
    api().get('/routers').then((r) => {
      if (cancelled) return
      const list = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.items) ? r.data.items : [])
      const usable = list.filter((x: any) =>
        x && (x.status === 'online' || x.isOnline || x.online || x.connectionStatus === 'online'
          || x.type === 'mikrotik' || x.vendor === 'mikrotik' || x.os === 'RouterOS'
          || x.type === 'edgeos' || x.vendor === 'ubiquiti'),
      )
      const preferred = (usable.length ? usable : list).slice().sort((a: any, b: any) => {
        const onlineScore = (x: any) => (x.status === 'online' || x.isOnline || x.online ? 0 : 1)
        return onlineScore(a) - onlineScore(b)
      })
      setBorderRouters(preferred)
      setBandwidthRouterId((prev) => {
        if (prev && preferred.some((x: any) => Number(x.id) === prev)) return prev
        return preferred[0] ? Number(preferred[0].id) : null
      })
    }).catch(() => {
      if (!cancelled) {
        setBorderRouters([])
        setBandwidthRouterId(null)
      }
    })
    return () => { cancelled = true }
  }, [activeTab])

  async function loadData() {
    if (activeTab === 'finance' || activeTab === 'staff' || activeTab === 'work-orders' || activeTab === 'detected-devices') {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      if (activeTab === 'dashboard') {
        const [dashRes, alertsRes] = await Promise.all([
          api().get('/dashboard/admin'),
          api().get('/alerts?status=all').catch(() => ({ data: { items: [] } })),
        ])
        setStats(dashRes.data.stats || {})
        setClientOverview(dashRes.data.clientOverview || [])
        setClientsWithProblems(dashRes.data.clientsWithProblems || [])
        setOverdueInvoices(dashRes.data.overdueInvoices || [])
        setRecentTickets(dashRes.data.recentTickets || [])
        setRecentPayments(dashRes.data.recentPayments || [])
        const raw = Array.isArray(alertsRes.data?.items) ? alertsRes.data.items : []
        setOrgAlerts(raw.filter((a: any) => a.status === 'open' || a.status === 'acked'))
        setListHydrated(true)
      } else if (activeTab === 'clients') {
        const res = await api().get('/clients/overview')
        setData(Array.isArray(res.data) ? res.data : [])
        setListHydrated(true)
      } else {
        const endpoints: Record<string, string> = {
          clients: '/clients', plans: '/plans', services: '/services',
          invoices: '/invoices', tickets: '/tickets',
          equipment: '/equipment',
          ips: '/ip-management'
        }
        if (endpoints[activeTab]) {
          const res = await api().get(endpoints[activeTab])
          setData(Array.isArray(res.data) ? res.data : [])
          setListHydrated(true)
        }
      }
    } catch (err: any) {
      setError('Error al cargar datos: ' + (err.response?.data?.error || err.message))
      setListHydrated(true)
    }
    setLoading(false)
  }

  async function loadClientsOverview() {
    setLoading(true)
    setError('')
    try {
      const res = await api().get('/clients/overview')
      setData(Array.isArray(res.data) ? res.data : [])
      setListHydrated(true)
    } catch (err: any) {
      setError('Error al cargar datos: ' + (err.response?.data?.error || err.message))
      setListHydrated(true)
    }
    setLoading(false)
  }

  function closeClientProfile() {
    setSelectedClientId(null)
    setClientInitialTab('overview')
    setActiveTab('clients')
    // Si ya estábamos en Abonados, el useEffect no dispara loadData — forzar recarga.
    void loadClientsOverview()
  }

  async function ackAlert(id: number) {
    try {
      await api().post(`/alerts/${id}/ack`)
      setOrgAlerts(prev => prev.map(a => a.id === id ? { ...a, status: 'acked' } : a))
    } catch (e: any) {
      alert(e.response?.data?.error || 'No se pudo acusar la alerta')
    }
  }

  async function resolveAlert(id: number) {
    try {
      await api().post(`/alerts/${id}/resolve`)
      setOrgAlerts(prev => prev.filter(a => a.id !== id))
    } catch (e: any) {
      alert(e.response?.data?.error || 'No se pudo resolver la alerta')
    }
  }

  async function refreshAlerts() {
    try {
      await api().post('/alerts/refresh')
      const alertsRes = await api().get('/alerts?status=all')
      const raw = Array.isArray(alertsRes.data?.items) ? alertsRes.data.items : []
      setOrgAlerts(raw.filter((a: any) => a.status === 'open' || a.status === 'acked'))
    } catch (e: any) {
      alert(e.response?.data?.error || 'No se pudieron refrescar alertas')
    }
  }

  function openAlertBucket(bucket: 'desconectados' | 'morosos' | 'cobros') {
    setAlertPanel(prev => prev === bucket ? null : bucket)
  }

  function goFromAlert(a: any) {
    if (a.entityType === 'invoice' || a.kind === 'mora' || a.kind === 'payment_fail') {
      const clientId = a.metadata?.clientId
      if (clientId) openClientProfile(Number(clientId))
      else setActiveTab('invoices')
      return
    }
    if (a.kind === 'cpe_offline' || a.kind === 'router_offline' || a.kind === 'agent_down') {
      openRouters()
      return
    }
  }

  async function openNewForm() {
    setEditingItem(null)
    const defaults: any = activeTab === 'services'
      ? { status: 'active' }
      : activeTab === 'clients'
        ? { lifecycleStatus: 'active', clientType: 'individual' }
        : {}
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
    setConfirmGenerateInvoices(true)
  }

  async function runGenerateInvoices(force = false) {
    setGeneratingInvoices(true)
    setError('')
    setGenerateInvoicesMsg('')
    try {
      const res = await api().post('/invoices/generate', { force: !!force })
      setConfirmGenerateInvoices(false)
      const skipped = Array.isArray(res.data.skipped) ? res.data.skipped : []
      const base = res.data.message || 'Facturas generadas correctamente'
      const detail = skipped.length
        ? ` · ${skipped.slice(0, 3).map((s: any) => s.reason).join('; ')}${skipped.length > 3 ? '…' : ''}`
        : ''
      setGenerateInvoicesMsg(base + detail)
      loadData()
    } catch (err: any) {
      setError('Error al generar facturas: ' + (err.response?.data?.error || err.message))
    }
    setGeneratingInvoices(false)
  }

  function openClientProfile(clientId: number, tab = 'overview') {
    setClientInitialTab(tab)
    setSelectedClientId(clientId)
  }

  function isRedIspMenu(id: string) {
    return id === 'red-isp' || id === 'network'
  }

  function openRedIsp() {
    setSelectedClientId(null)
    setShowBillingSettings(false)
    setShowRouters(false)
    setShowRedIsp(true)
    setActiveTab('red-isp')
  }

  function openInventory() {
    setSelectedClientId(null)
    setShowBillingSettings(false)
    setShowRouters(false)
    setShowRedIsp(false)
    setActiveTab('equipment')
    setEquipmentSubTab('infrastructure')
  }

  function openRouters() {
    setSelectedClientId(null)
    setShowBillingSettings(false)
    setShowRedIsp(false)
    setShowRouters(true)
    setActiveTab('routers')
  }

  function sidebarActiveTab() {
    if (showBillingSettings) return 'billing-settings'
    if (showRedIsp || activeTab === 'red-isp' || activeTab === 'network') return 'red-isp'
    if (showRouters) return 'routers'
    if (activeTab === 'equipment') return 'inventory'
    return activeTab
  }

  function tabNeedsFetch(id: string) {
    return !['finance', 'staff', 'work-orders', 'detected-devices', 'billing-settings'].includes(id)
  }

  /** Cambia de pestaña sin flash de vacío: loading inmediato + seed desde overview del dashboard. */
  function goToTab(id: string, opts?: { lifecycleFilter?: string; connFilter?: string; keepFilters?: boolean }) {
    if (opts?.lifecycleFilter) setClientLifecycleFilter(opts.lifecycleFilter)
    else if (id === 'clients' && !opts?.keepFilters) setClientLifecycleFilter('all')
    if (opts?.connFilter) setClientConnFilter(opts.connFilter)
    else if (id === 'clients' && !opts?.keepFilters) setClientConnFilter('all')
    if (id === 'clients' && !opts?.keepFilters) setClientDebtFilter(false)
    if (isRedIspMenu(id)) {
      openRedIsp()
      return
    }
    if (id === 'inventory') {
      openInventory()
      return
    }
    if (id === 'routers') {
      openRouters()
      return
    }
    setShowRedIsp(false)
    setShowRouters(false)
    if (id === 'billing-settings') {
      setSelectedClientId(null)
      setShowBillingSettings(true)
      setActiveTab('billing-settings')
      return
    }
    const leavingClient = selectedClientId != null
    const sameTab = activeTab === id
    setSelectedClientId(null)
    setShowBillingSettings(false)
    setError('')
    if (!sameTab && tabNeedsFetch(id)) {
      setLoading(true)
      setListHydrated(false)
      if (id === 'clients' && clientOverview.length > 0) {
        setData(clientOverview)
        setListHydrated(true)
      } else {
        setData([])
      }
    }
    setActiveTab(id)
    // Misma pestaña (p.ej. Abonados desde el perfil): useEffect no corre → recargar.
    if (sameTab) {
      if (id === 'clients') void loadClientsOverview()
      else void loadData()
    } else if (leavingClient && id === 'clients') {
      void loadClientsOverview()
    }
  }

  function navigateMenu(id: string) {
    goToTab(id)
  }

  const role = user?.role || 'admin'
  const allMenuSections = [
    {
      title: 'Tus abonados',
      hint: 'Personas que contratan internet',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'clients', label: 'Abonados', icon: Users },
        { id: 'services', label: 'Auditoría técnica', icon: Wifi, roles: ['admin', 'technician'] },
        { id: 'work-orders', label: 'Órdenes de trabajo', icon: Ticket },
        { id: 'invoices', label: 'Facturación', icon: DollarSign },
        { id: 'finance', label: 'Finanzas', icon: TrendingUp, roles: ['admin', 'office'] },
        { id: 'billing-settings', label: 'Ajustes facturación', icon: Settings, roles: ['admin'] },
        { id: 'tickets', label: 'Soporte', icon: Ticket },
        { id: 'staff', label: 'Personal ISP', icon: Users, roles: ['admin'] },
      ],
    },
    {
      title: 'Red e infraestructura',
      hint: 'Nodos, routers y adopciones',
      roles: ['admin', 'technician'],
      items: [
        { id: 'red-isp', label: 'Red ISP', icon: Network },
        { id: 'inventory', label: 'Señales RF e Inventario', icon: Antenna },
        { id: 'routers', label: 'Routers y agentes', icon: Router },
        { id: 'detected-devices', label: 'Dispositivos detectados', icon: Radar },
      ],
    },
    {
      title: 'Catálogo comercial',
      hint: 'Planes que vendes (productos)',
      items: [
        { id: 'plans', label: 'Planes de internet', icon: TrendingUp, roles: ['admin'] },
      ],
    },
  ]
  const menuSections = allMenuSections
    .filter((s) => !s.roles || s.roles.includes(role))
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => !i.roles || i.roles.includes(role)),
    }))
    .filter((s) => s.items.length > 0)
  const menuItems = menuSections.flatMap((s) => s.items)

  const tabLabels: Record<string, string> = {
    dashboard: 'Dashboard de red',
    clients: 'Abonados',
    services: 'Auditoría técnica (IPs y estados)',
    plans: 'Planes comerciales',
    equipment: 'Señales RF e Inventario',
    inventory: 'Señales RF e Inventario',
    'detected-devices': 'Dispositivos detectados',
    ips: 'Gestión de IPs',
    invoices: 'Facturación',
    finance: 'Finanzas',
    tickets: 'Tickets de soporte',
    staff: 'Personal del ISP',
    'work-orders': 'Órdenes de trabajo',
  }

  const tabDescriptions: Record<string, string> = {
    dashboard: 'Tráfico en vivo, presencia de abonados y alertas operativas',
    clients: 'Lista de abonados — clic en la IP para gestionar la antena',
    services: 'Vista global de servicios — gestiona cada abonado desde su perfil (Abonados → Gestionar)',
    plans: 'Catálogo de productos de tu ISP — no son personas, son los planes que ofreces',
    inventory: 'Sectoriales y CPEs con señal RF — clic en un AP para ver estaciones conectadas.',
    equipment: 'Sectoriales y CPEs con señal RF — clic en un AP para ver estaciones conectadas.',
    'detected-devices': 'Dispositivos vía DHCP, ARP y PPPoE activo — adóptalos como abonados con un clic',
    ips: 'Pools y asignación de direcciones IP',
    invoices: 'Facturas mensuales de tus abonados',
    finance: 'Ingresos, egresos y tendencias del ISP',
    tickets: 'Incidencias reportadas por abonados',
    staff: 'Administradores, administrativos y técnicos de tu organización',
    'work-orders': 'Instalaciones, visitas y cierres con checklist',
  }

  const formFields: Record<string, any[]> = {
    clients: [
      { name: 'fullName', label: 'Nombre completo', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'password', label: 'Contraseña', type: 'password', required: !editingItem },
      { name: 'phone', label: 'Teléfono', type: 'text' },
      { name: 'clientType', label: 'Tipo', type: 'select', options: ['individual', 'business'] },
      { name: 'rut', label: 'RUT (ej: 12345678-9)', type: 'text' },
      { name: 'lifecycleStatus', label: 'Estado CRM', type: 'select', options: ['prospect', 'pending_install', 'active', 'suspended', 'cut', 'cancelled'] },
      { name: 'city', label: 'Ciudad', type: 'text' },
      { name: 'region', label: 'Región', type: 'select', options: ['Arica y Parinacota','Tarapacá','Antofagasta','Atacama','Coquimbo','Valparaíso','Metropolitana','O\'Higgins','Maule','Ñuble','Biobío','La Araucanía','Los Ríos','Los Lagos','Aysén','Magallanes'] },
      { name: 'address', label: 'Dirección', type: 'text' },
      { name: 'latitude', label: 'Latitud', type: 'text' },
      { name: 'longitude', label: 'Longitud', type: 'text' },
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
      { name: 'snmpCommunity', label: 'SNMP Community (estado auto si IP + community)', type: 'text' },
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
    active: 'fn-badge-ok', suspended: 'fn-badge-warn',
    cancelled: 'fn-badge-danger', pending: 'fn-badge-info', cut: 'fn-badge-danger',
    paid: 'fn-badge-ok', overdue: 'fn-badge-danger',
    open: 'fn-badge-warn', in_progress: 'fn-badge-info',
    resolved: 'fn-badge-ok', closed: 'fn-badge-muted',
    online: 'fn-badge-ok', offline: 'fn-badge-muted',
    maintenance: 'fn-badge-warn', error: 'fn-badge-danger',
    critical: 'fn-badge-danger', high: 'fn-badge-warn',
    medium: 'fn-badge-info', low: 'fn-badge-muted',
    individual: 'fn-badge-info', business: 'fn-badge-info',
    prospect: 'fn-badge-muted', pending_install: 'fn-badge-info',
  }

  const statusLabel: Record<string, string> = {
    active: 'Activo', suspended: 'Suspendido', cancelled: 'Cancelado', pending: 'Pendiente', cut: 'Cortado',
      paid: 'Pagada', overdue: 'Vencida', partial: 'Pago parcial', open: 'Abierto', in_progress: 'En progreso',
    resolved: 'Resuelto', closed: 'Cerrado', online: 'Online', offline: 'Offline',
    maintenance: 'Mantenimiento', error: 'Error', critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja',
    individual: 'Individual', business: 'Empresa',
    fiber: 'Fibra', wisp: 'WISP', copper: 'Cobre', wireless: 'Inalámbrico',
    router: 'Router', switch: 'Switch', olt: 'OLT', ont: 'ONT', ap: 'AP', cpe: 'CPE', server: 'Servidor', other: 'Otro',
    admin: 'Administrador', office: 'Administrativo', technician: 'Técnico', client: 'Cliente', superadmin: 'Super Admin',
    none: 'Sin servicio',
    prospect: 'Prospecto', pending_install: 'Instalación pendiente',
    unknown: 'Sin PPPoE',
  }

  const connectionLabel: Record<string, string> = {
    online: 'Online',
    offline: 'Desconectado',
    suspended: 'Suspendido',
    static: 'IP fija',
    none: 'Sin servicio',
    unknown: 'Sin monitoreo',
  }

  const connectionColor: Record<string, string> = {
    online: 'fn-badge-ok',
    offline: 'fn-badge-warn',
    suspended: 'fn-badge-warn',
    static: 'fn-badge-info',
    none: 'fn-badge-muted',
    unknown: 'fn-badge-muted',
  }

  const logout = () => { localStorage.removeItem('token'); window.location.href = '/login' }

  const duplicateServiceIps = activeTab === 'services'
    ? data.reduce((acc: Record<string, number>, item: any) => {
        const ip = item.ipAddress?.trim()
        if (ip) acc[ip] = (acc[ip] || 0) + 1
        return acc
      }, {})
    : {}

  const filteredClients = activeTab === 'clients'
    ? data.filter((item: any) => {
        const q = clientSearch.trim().toLowerCase()
        if (q) {
          const hay = `${item.fullName || ''} ${item.email || ''} ${item.city || ''} ${item.phone || ''} ${item.planName || ''} ${item.ipAddress || ''}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        if (clientLifecycleFilter === 'suspended') {
          if (!(item.lifecycleStatus === 'suspended' || item.serviceStatus === 'suspended')) return false
        } else if (clientLifecycleFilter === 'cut') {
          if (!(item.lifecycleStatus === 'cut' || item.serviceStatus === 'cut')) return false
        } else if (clientLifecycleFilter !== 'all' && (item.lifecycleStatus || 'prospect') !== clientLifecycleFilter) {
          return false
        }
        if (clientConnFilter !== 'all' && item.connectionStatus !== clientConnFilter) return false
        if (clientDebtFilter && !(item.pendingAmount > 0)) return false
        return true
      })
    : data

  function tabCountLabel(tab: string, n: number) {
    const singular: Record<string, string> = {
      clients: 'abonado', plans: 'plan', invoices: 'factura', tickets: 'ticket',
      ips: 'IP', services: 'servicio',
    }
    const plural: Record<string, string> = {
      clients: 'abonados', plans: 'planes', invoices: 'facturas', tickets: 'tickets',
      ips: 'IPs', services: 'servicios',
    }
    const one = singular[tab] || 'registro'
    const many = plural[tab] || 'registros'
    return n === 1 ? `1 ${one}` : `${n} ${many}`
  }

  const emptyTabNoun: Record<string, string> = {
    clients: 'abonados', plans: 'planes', invoices: 'facturas', tickets: 'tickets',
    ips: 'IPs', services: 'servicios',
  }

  // Red ISP nunca usa la vista genérica de pestañas (legacy activeTab 'network')
  const redIspOpen = showRedIsp || activeTab === 'red-isp' || activeTab === 'network'

  // Vista detalle cliente
  if (selectedClientId) {
    return (
      <div className="min-h-screen bg-surface flex">
        <Sidebar menuSections={menuSections} activeTab={sidebarActiveTab()} user={user} logout={logout}
          onTabClick={navigateMenu} />
        <ClientDetail
          clientId={selectedClientId}
          API={API}
          initialTab={clientInitialTab}
          onBack={closeClientProfile}
        />
      </div>
    )
  }

  // Vistas overlay / dedicadas: deben ir ANTES de activeTab === 'finance'
  // (si no, Finanzas bloquea Ajustes / Routers al dejar activeTab en 'finance')
  if (showBillingSettings) {
    return (
      <div className="min-h-screen bg-surface flex">
        <Sidebar menuSections={menuSections} activeTab="billing-settings" user={user} logout={logout}
          onTabClick={navigateMenu} />
        <BillingSettings API={API} onBack={() => { setShowBillingSettings(false); setActiveTab('dashboard') }} />
      </div>
    )
  }

  if (showRouters) {
    return (
      <div className="min-h-screen bg-surface flex">
        <Sidebar menuSections={menuSections} activeTab="routers" user={user} logout={logout}
          onTabClick={navigateMenu} />
        <RouterManager API={API} onBack={() => { setShowRouters(false); openRedIsp() }} />
      </div>
    )
  }

  if (redIspOpen) {
    return (
      <div className="min-h-screen bg-surface flex">
        <Sidebar menuSections={menuSections} activeTab="red-isp" user={user} logout={logout}
          onTabClick={navigateMenu} />
        <NetworkManager
          API={API}
          onBack={() => { setShowRedIsp(false); setActiveTab('dashboard') }}
          onOpenClient={(id, tab) => openClientProfile(id, tab || 'overview')}
        />
      </div>
    )
  }

  if (activeTab === 'finance') {
    return (
      <div className="min-h-screen bg-surface flex">
        <Sidebar menuSections={menuSections} activeTab="finance" user={user} logout={logout}
          onTabClick={navigateMenu} />
        <FinanceDashboard API={API} />
      </div>
    )
  }

  const canDelete = ['clients', 'plans', 'services', 'equipment', 'ips', 'tickets']
  const canEdit = ['clients', 'plans', 'services', 'equipment', 'ips', 'tickets']

  return (
    <div className="min-h-screen bg-surface flex">
      {/* Modal Form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-surface-card rounded-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
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
                  <label className="block text-sm font-medium text-ink-soft mb-1">{f.label} {f.required && <span className="text-red-500">*</span>}</label>
                  {f.type === 'client-select' ? (
                    <select className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 bg-surface-card" value={form[f.name] || ''} onChange={e => setForm({...form, [f.name]: e.target.value})}>
                      <option value="">Seleccionar abonado...</option>
                      {clients.length === 0 && <option disabled value="">— Sin abonados (créalos en Abonados) —</option>}
                      {clients.map((c: any) => <option key={c.id} value={c.id}>{c.user?.fullName || c.id} — {c.city || ''}</option>)}
                    </select>
                  ) : f.type === 'plan-select' ? (
                    <select className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 bg-surface-card" value={form[f.name] || ''} onChange={e => setForm({...form, [f.name]: e.target.value})}>
                      <option value="">Seleccionar plan...</option>
                      {plans.map((p: any) => <option key={p.id} value={p.id}>{p.name} — ${Number(p.price).toLocaleString('es-CL')}/mes</option>)}
                    </select>
                  ) : f.type === 'select' ? (
                    <select className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 bg-surface-card" value={form[f.name] || ''} onChange={e => setForm({...form, [f.name]: e.target.value})}>
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
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 border rounded-lg hover:bg-surface-raised font-medium">Cancelar</button>
              <button onClick={handleSave} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
                {editingItem ? '💾 Guardar cambios' : '✅ Crear'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Sidebar menuSections={menuSections} activeTab={sidebarActiveTab()} user={user} logout={logout}
        onTabClick={navigateMenu} />

      {/* Main Content */}
      <div className="flex-1 overflow-auto bg-surface">
        {user?.organization?.plan === 'trial' && user?.organization?.trialDaysLeft != null && (
          <div className={`px-8 py-3 text-sm flex items-center justify-between ${user.organization.trialDaysLeft <= 3 ? 'bg-amber-50 text-amber-900 border-b border-amber-200' : 'bg-sky-50 text-sky-900 border-b border-sky-200'}`}>
            <span>
              FibraNexus · trial de plataforma — <strong>{user.organization.trialDaysLeft} días</strong> restantes
            </span>
            <span className="text-xs opacity-75">Tú operas <strong>{user.organization.name}</strong> · tus abonados son otra cosa</span>
          </div>
        )}
        <header className="bg-surface-card shadow-sm px-8 py-4 flex justify-between items-center sticky top-0 z-10 border-b border-line">
          <div>
            <h1 className="text-xl font-bold text-ink">{tabLabels[activeTab === 'equipment' ? 'inventory' : activeTab] || activeTab}</h1>
            {tabDescriptions[activeTab === 'equipment' ? 'inventory' : activeTab] && (
              <p className="text-sm text-ink-muted mt-0.5">{tabDescriptions[activeTab === 'equipment' ? 'inventory' : activeTab]}</p>
            )}
            {activeTab !== 'dashboard' && !loading && activeTab !== 'equipment' && activeTab !== 'detected-devices' && activeTab !== 'red-isp' && activeTab !== 'network' && activeTab !== 'staff' && activeTab !== 'work-orders' && activeTab !== 'finance' && (
              <p className="text-xs text-ink-muted mt-1">
                {activeTab === 'clients'
                  ? `${tabCountLabel('clients', filteredClients.length)}${filteredClients.length !== data.length ? ` (de ${data.length})` : ''}`
                  : tabCountLabel(activeTab, data.length)}
              </p>
            )}
          </div>
          <div className="flex gap-2 items-center">
            <ThemeToggle />
            {activeTab !== 'staff' && activeTab !== 'work-orders' && (
              <button onClick={loadData} className="px-4 py-2 border border-line rounded-lg hover:bg-surface-raised text-sm font-medium text-ink">🔄 Actualizar</button>
            )}
            {activeTab === 'invoices' && (
              <button onClick={handleGenerateInvoices} disabled={generatingInvoices}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium flex items-center gap-2 disabled:opacity-60">
                📄 {generatingInvoices ? 'Generando…' : 'Generar Facturas'}
              </button>
            )}
            {activeTab !== 'dashboard' && activeTab !== 'invoices' && activeTab !== 'equipment' && activeTab !== 'services' && activeTab !== 'detected-devices' && activeTab !== 'red-isp' && activeTab !== 'network' && activeTab !== 'staff' && activeTab !== 'work-orders' && (
              <button onClick={openNewForm} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2">
                <Plus className="h-4 w-4" /> Nuevo
              </button>
            )}
          </div>
        </header>

        <main className="p-8">
          {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2"><AlertTriangle className="h-5 w-5 flex-shrink-0" /> {error}</div>}

          {generateInvoicesMsg && activeTab === 'invoices' && (
            <div className="mb-4 bg-blue-50 border border-blue-200 text-blue-900 px-4 py-3 rounded-xl flex items-center justify-between gap-3 text-sm">
              <span>{generateInvoicesMsg}</span>
              <button type="button" onClick={() => setGenerateInvoicesMsg('')} className="text-blue-700 hover:underline text-xs">Cerrar</button>
            </div>
          )}

          {confirmGenerateInvoices && activeTab === 'invoices' && (
            <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-950 px-4 py-3 rounded-xl flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm max-w-xl">
                <p className="font-semibold">¿Generar facturas del ciclo actual?</p>
                <p className="text-emerald-900/80 mt-0.5">Solo servicios con cobro vencido hoy. «Forzar» incluye todos los activos (útil al arrancar el ISP).</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setConfirmGenerateInvoices(false)}
                  className="px-3 py-1.5 text-sm rounded-lg border border-emerald-200 bg-white hover:bg-emerald-50">Cancelar</button>
                <button type="button" onClick={() => runGenerateInvoices(true)} disabled={generatingInvoices}
                  className="px-3 py-1.5 text-sm rounded-lg border border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-50 disabled:opacity-60">
                  Forzar todos
                </button>
                <button type="button" onClick={() => runGenerateInvoices(false)} disabled={generatingInvoices}
                  className="px-3 py-1.5 text-sm rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-60">
                  {generatingInvoices ? 'Generando…' : 'Sí, generar vencidos'}
                </button>
              </div>
            </div>
          )}

          {/* DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-5">
              {/* 4 KPIs — estilo dashboard de red */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  {
                    label: 'Suscriptores',
                    value: stats?.totalClients || 0,
                    hint: (stats?.pendingInstallClients || 0) > 0
                      ? `${stats.pendingInstallClients} en instalación`
                      : 'Total abonados',
                    icon: Users,
                    accent: 'text-sky-400',
                    ring: 'hover:border-sky-500/40',
                    onClick: () => goToTab('clients'),
                  },
                  {
                    label: 'Links activos',
                    value: stats?.onlineClients || 0,
                    hint: `${Math.max(stats?.offlineClients || 0, 0)} offline`,
                    icon: Wifi,
                    accent: 'text-emerald-400',
                    ring: 'hover:border-emerald-500/40',
                    onClick: () => goToTab('clients', { connFilter: 'online', keepFilters: true }),
                  },
                  {
                    label: 'Requieren atención',
                    value: Math.max(
                      stats?.offlineClients || 0,
                      alertsForBucket('desconectados').length,
                      clientsWithProblems.length,
                    ),
                    hint: alertsForBucket('desconectados').length
                      ? `${alertsForBucket('desconectados').length} alerta(s)`
                      : 'CPE / routers sin respuesta',
                    icon: WifiOff,
                    accent: 'text-red-400',
                    ring: 'hover:border-red-500/40',
                    onClick: () => {
                      const n = alertsForBucket('desconectados').length
                      if (n) openAlertBucket('desconectados')
                      else goToTab('clients', { connFilter: 'offline', keepFilters: true })
                    },
                  },
                  {
                    label: 'Ingreso mensual',
                    value: '$' + (stats?.monthCollected || 0).toLocaleString('es-CL'),
                    hint: `${stats?.monthPaymentCount || 0} pago(s) · por cobrar $${(stats?.pendingAmount || 0).toLocaleString('es-CL')}`,
                    icon: TrendingUp,
                    accent: 'text-amber-400',
                    ring: 'hover:border-amber-500/40',
                    onClick: () => goToTab('finance'),
                  },
                ].map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={c.onClick}
                    className={`text-left rounded-2xl border border-slate-800 bg-[#0f172a] p-4 transition ${c.ring}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{c.label}</p>
                      <c.icon className={`h-4 w-4 ${c.accent}`} />
                    </div>
                    <p className="text-2xl font-bold tabular-nums text-slate-50">{c.value}</p>
                    <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">{c.hint}</p>
                  </button>
                ))}
              </div>

              {/* Gráficos */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <LiveBandwidthChart
                  className="xl:col-span-2"
                  API={API}
                  routerId={bandwidthRouterId}
                  routerName={
                    borderRouters.find((r: any) => Number(r.id) === bandwidthRouterId)?.name
                    || borderRouters.find((r: any) => Number(r.id) === bandwidthRouterId)?.hostname
                  }
                  routers={borderRouters.map((r: any) => ({
                    id: Number(r.id),
                    name: r.name,
                    hostname: r.hostname,
                    status: r.status,
                  }))}
                  onRouterChange={(id) => setBandwidthRouterId(id)}
                />
                <SubscriberStatusDonut
                  online={stats?.onlineClients || 0}
                  offline={stats?.offlineClients || 0}
                  suspended={Math.max(stats?.suspendedClients || 0, stats?.suspendedServices || 0)}
                />
              </div>

              {/* Alertas + atención */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-slate-800 bg-[#0f172a] overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-100">Alertas recientes</h2>
                    <button type="button" onClick={refreshAlerts} className="text-xs text-slate-400 hover:text-slate-200">Actualizar</button>
                  </div>
                  {orgAlerts.length === 0 ? (
                    <p className="px-5 py-10 text-center text-sm text-slate-500">Sin alertas abiertas — red operativa.</p>
                  ) : (
                    <ul className="divide-y divide-slate-800/80 max-h-72 overflow-y-auto">
                      {orgAlerts.slice(0, 8).map((a: any) => (
                        <li key={a.id} className="px-5 py-3 flex items-start gap-3 hover:bg-slate-900/60">
                          <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                            a.severity === 'critical' ? 'bg-red-400'
                              : a.severity === 'info' ? 'bg-sky-400' : 'bg-amber-400'
                          }`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-slate-200 truncate">{a.title}</p>
                            <p className="text-xs text-slate-500 truncate mt-0.5">{a.message || ALERT_WHY[a.kind] || ''}</p>
                          </div>
                          <button type="button" onClick={() => goFromAlert(a)} className="text-xs text-sky-400 hover:text-sky-300 shrink-0">Ir</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-800 bg-[#0f172a] overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-100">Requieren atención</h2>
                    <button type="button" onClick={() => goToTab('clients')} className="text-xs text-slate-400 hover:text-slate-200">Ver abonados →</button>
                  </div>
                  {clientsWithProblems.length === 0 ? (
                    <p className="px-5 py-10 text-center text-sm text-slate-500">Ningún abonado con deuda o falla ahora.</p>
                  ) : (
                    <ul className="divide-y divide-slate-800/80 max-h-72 overflow-y-auto">
                      {clientsWithProblems.slice(0, 8).map((c: any) => (
                        <li key={c.id} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-900/60">
                          <div className="min-w-0">
                            <p className="text-sm text-slate-200 truncate">{c.fullName}</p>
                            <p className="text-xs text-slate-500 truncate mt-0.5">
                              {connectionLabel[c.connectionStatus] || c.connectionStatus}
                              {c.pendingAmount > 0 ? ` · $${c.pendingAmount.toLocaleString('es-CL')}` : ''}
                            </p>
                          </div>
                          <button type="button" onClick={() => openClientProfile(c.id)} className="text-xs text-sky-400 hover:text-sky-300 shrink-0">Gestionar</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {alertPanel && (
                <div className="rounded-2xl border border-amber-500/30 bg-[#0f172a] overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold text-amber-200 text-sm flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      {alertPanel === 'desconectados' && 'Desconectados'}
                      {alertPanel === 'morosos' && 'Morosos'}
                      {alertPanel === 'cobros' && 'Cobros'}
                    </h2>
                    <button type="button" onClick={() => setAlertPanel(null)} className="text-xs text-slate-400 hover:text-slate-200">Cerrar</button>
                  </div>
                  {alertsForBucket(alertPanel).length === 0 ? (
                    <p className="px-5 py-8 text-sm text-slate-500 text-center">Sin alertas en esta categoría.</p>
                  ) : (
                    <ul className="divide-y divide-slate-800 max-h-80 overflow-y-auto">
                      {alertsForBucket(alertPanel).map((a: any) => (
                        <li key={a.id} className="px-5 py-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-1">
                              <p className="font-medium text-sm text-slate-100">{a.title}</p>
                              <p className="text-xs text-slate-400">{a.message || 'Sin detalle.'}</p>
                              <p className="text-xs text-slate-500">{ALERT_WHY[a.kind] || ''}</p>
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <button type="button" onClick={() => goFromAlert(a)} className="text-xs px-2.5 py-1 rounded-lg bg-sky-500/15 text-sky-300">Ir</button>
                              {a.status === 'open' && (
                                <button type="button" onClick={() => ackAlert(a.id)} className="text-xs px-2.5 py-1 rounded-lg border border-slate-700 text-slate-300">Visto</button>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Accesos rápidos secundarios */}
              <div className="flex flex-wrap gap-2 text-xs">
                <button type="button" onClick={() => goToTab('invoices')} className="px-3 py-1.5 rounded-lg border border-slate-800 bg-[#0f172a] text-slate-300 hover:border-slate-600">
                  Por cobrar: ${(stats?.pendingAmount || 0).toLocaleString('es-CL')}
                </button>
                <button type="button" onClick={() => goToTab('tickets')} className="px-3 py-1.5 rounded-lg border border-slate-800 bg-[#0f172a] text-slate-300 hover:border-slate-600">
                  Tickets abiertos: {stats?.openTickets || 0}
                </button>
                <button type="button" onClick={() => openRouters()} className="px-3 py-1.5 rounded-lg border border-slate-800 bg-[#0f172a] text-slate-300 hover:border-slate-600">
                  Routers: {stats?.totalRouters || 0}
                </button>
                {(stats?.delinquentClients || 0) > 0 && (
                  <button type="button" onClick={() => goToTab('invoices')} className="px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300">
                    Morosos: {stats.delinquentClients}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* DISPOSITIVOS DETECTADOS */}
          {activeTab === 'detected-devices' && (
            <DetectedDevices API={API} onOpenClient={(id) => openClientProfile(id, 'overview')} />
          )}

          {activeTab === 'staff' && (
            <StaffManager API={API} />
          )}

          {activeTab === 'work-orders' && (
            user?.role === 'technician'
              ? <FieldWorkOrders API={API} user={user} />
              : <WorkOrdersManager API={API} />
          )}

          {/* EQUIPOS — inventario operativo NOC */}
          {activeTab === 'equipment' && (
            <EquipmentInventory
              API={API}
              onOpenRedIsp={openRedIsp}
              onOpenClient={(id) => openClientProfile(id, 'overview')}
            />
          )}

          {/* TABLAS GENERALES */}
          {activeTab !== 'dashboard' && activeTab !== 'equipment' && activeTab !== 'detected-devices' && activeTab !== 'network' && activeTab !== 'staff' && activeTab !== 'work-orders' && (
            <div className="space-y-4">
              {activeTab === 'plans' && (
                <div className="bg-purple-50 border border-purple-100 rounded-xl px-5 py-3 text-sm text-purple-900">
                  <strong>Catálogo comercial</strong> — Aquí defines los planes que vendes (ej. 20 Mbps, 100 Mbps).
                  Los <strong>abonados</strong> están en otra pestaña; aquí solo creas productos.
                </div>
              )}
              {activeTab === 'services' && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-4 text-sm text-blue-900 space-y-2">
                  <p><strong>Auditoría técnica</strong> — Lista global para detectar IPs duplicadas o servicios suspendidos.</p>
                  <p>Para crear servicios, asignar antenas, configurar DHCP/estática y ver facturas, entra al <strong>perfil del abonado</strong>:</p>
                  <button onClick={() => goToTab('clients')} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                    Ir a Abonados → Gestionar
                  </button>
                  {Object.values(duplicateServiceIps).some((n) => n > 1) && (
                    <p className="mt-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      ⚠️ Hay IPs duplicadas. Corrígelo desde el perfil del abonado afectado.
                    </p>
                  )}
                </div>
              )}
            <div className="bg-surface-card rounded-xl shadow-sm border border-line">
              {activeTab === 'clients' && data.length > 0 && (
                <div className="p-4 border-b border-line space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
                    <input
                      type="search"
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      placeholder="Buscar por nombre, email, ciudad, plan o IP…"
                      className="w-full pl-10 pr-3 py-2.5 text-sm border border-line rounded-xl bg-surface focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-[11px] uppercase tracking-wide text-ink-muted font-medium">CRM</span>
                    {[
                      { id: 'all', label: 'Todos' },
                      { id: 'active', label: 'Activos' },
                      { id: 'pending_install', label: 'Instalación' },
                      { id: 'suspended', label: 'Suspendidos' },
                      { id: 'cut', label: 'Cortados' },
                      { id: 'cancelled', label: 'Baja' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setClientLifecycleFilter(f.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                          clientLifecycleFilter === f.id
                            ? 'bg-sky-600 text-white border-sky-600'
                            : 'bg-surface text-ink-soft border-line hover:bg-surface-raised'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                    <span className="text-ink-muted/40 mx-1">|</span>
                    {[
                      { id: 'all', label: 'Red: todas' },
                      { id: 'online', label: 'Online' },
                      { id: 'offline', label: 'Offline' },
                      { id: 'unknown', label: 'Sin monitoreo' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setClientConnFilter(f.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                          clientConnFilter === f.id
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-surface text-ink-soft border-line hover:bg-surface-raised'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setClientDebtFilter((v) => !v)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                        clientDebtFilter
                          ? 'bg-red-600 text-white border-red-600'
                          : 'bg-surface text-ink-soft border-line hover:bg-surface-raised'
                      }`}
                    >
                      Con deuda
                    </button>
                  </div>
                </div>
              )}
              {loading || !listHydrated ? (
                <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4"></div></div>
              ) : data.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400 px-6 text-center">
                  <Users className="h-12 w-12 mb-3 opacity-30 text-blue-500" />
                  <p className="text-lg font-medium text-ink-muted">
                    {activeTab === 'clients' ? 'Aún no hay abonados'
                      : activeTab === 'invoices' ? 'Aún no hay facturas'
                      : activeTab === 'tickets' ? 'Aún no hay tickets'
                      : activeTab === 'plans' ? 'Aún no hay planes'
                      : activeTab === 'services' ? 'Sin servicios en auditoría'
                      : `No hay ${emptyTabNoun[activeTab] || 'registros'} registrados`}
                  </p>
                  <p className="text-sm mt-1 max-w-sm">
                    {activeTab === 'clients'
                      ? 'Crea tu primer abonado para empezar a facturar y asignar servicios.'
                      : activeTab === 'invoices'
                        ? 'Usa «Generar Facturas» para crear el ciclo actual, o genera una desde el perfil del abonado.'
                        : activeTab === 'tickets'
                          ? 'Los tickets de soporte aparecerán aquí cuando un abonado o el personal abran uno.'
                          : activeTab === 'plans'
                            ? 'Crea un plan comercial (velocidad y precio) para asignarlo a abonados.'
                            : 'Usa el botón «+ Nuevo» para agregar'}
                  </p>
                  {activeTab === 'clients' && (
                    <button type="button" onClick={openNewForm}
                      className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 inline-flex items-center gap-2">
                      <Plus className="h-4 w-4" /> Crear abonado
                    </button>
                  )}
                  {activeTab === 'invoices' && (
                    <button type="button" onClick={handleGenerateInvoices}
                      className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 inline-flex items-center gap-2">
                      📄 Generar Facturas
                    </button>
                  )}
                  {activeTab === 'plans' && (
                    <button type="button" onClick={openNewForm}
                      className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 inline-flex items-center gap-2">
                      <Plus className="h-4 w-4" /> Crear plan
                    </button>
                  )}
                </div>
              ) : activeTab === 'clients' && filteredClients.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-ink-muted px-6 text-center">
                  <Search className="h-10 w-10 mb-3 opacity-40" />
                  <p className="font-medium">Ningún abonado coincide con el filtro</p>
                  <button type="button" className="mt-3 text-sm text-blue-600 hover:underline"
                    onClick={() => { setClientSearch(''); setClientLifecycleFilter('all'); setClientConnFilter('all'); setClientDebtFilter(false) }}>
                    Limpiar filtros
                  </button>
                </div>
              ) : activeTab === 'clients' ? (
                <div className="divide-y divide-line/70">
                  {filteredClients.map((item: any) => {
                    const life = item.lifecycleStatus || 'prospect'
                    const showLife = life !== 'active'
                    const conn = item.connectionStatus || 'unknown'
                    const highAlerts = (item.alerts || []).filter((a: any) => a.severity === 'high')
                    const debt = Number(item.pendingAmount || 0) > 0
                    return (
                      <div
                        key={item.id}
                        className="px-4 py-3.5 sm:px-5 hover:bg-surface-raised/50 transition flex flex-col sm:flex-row sm:items-center gap-3"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-10 h-10 rounded-lg bg-sky-500/15 text-sky-700 dark:text-sky-400 flex items-center justify-center font-semibold text-sm shrink-0">
                            {(item.fullName || '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-ink truncate">{item.fullName || 'Sin nombre'}</p>
                              {showLife && (
                                <span className={statusColor[life] || 'fn-badge-muted'}>
                                  {statusLabel[life] || life}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-ink-muted truncate mt-0.5">
                              {item.email}
                              {item.city ? ` · ${item.city}` : ''}
                              {item.siteName ? ` · ${item.siteName}` : ''}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                              <span className="text-ink-soft truncate max-w-[180px]">
                                {item.planName || 'Sin plan'}
                              </span>
                              {item.ipAddress ? (
                                <DeviceIpLink
                                  ip={item.ipAddress}
                                  className="font-mono text-sky-700 dark:text-sky-400 hover:underline"
                                  showIcon
                                >
                                  <Router className="h-3 w-3 shrink-0 opacity-70" />
                                  {item.ipAddress}
                                </DeviceIpLink>
                              ) : (
                                <span className="text-ink-muted/50">Sin IP</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 sm:justify-end shrink-0">
                          <span className={connectionColor[conn] || 'fn-badge-muted'} title={item.connectionDetail || ''}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              conn === 'online' ? 'bg-emerald-500' : conn === 'offline' ? 'bg-amber-500' : 'bg-slate-400'
                            }`} />
                            {connectionLabel[conn] || conn}
                          </span>
                          {debt ? (
                            <span className="fn-badge-danger tabular-nums">
                              ${Number(item.pendingAmount).toLocaleString('es-CL')}
                            </span>
                          ) : (
                            <span className="fn-badge-ok">Al día</span>
                          )}
                          {item.openTickets > 0 && (
                            <span className="fn-badge-warn">{item.openTickets} ticket{item.openTickets > 1 ? 's' : ''}</span>
                          )}
                          {highAlerts.slice(0, 1).map((a: any) => (
                            <span key={a.type + a.label} className="fn-badge-danger">{a.label}</span>
                          ))}
                          <button
                            type="button"
                            onClick={() => openClientProfile(item.id)}
                            className="ml-1 px-3 py-1.5 bg-sky-600 text-white rounded-lg text-xs font-medium hover:bg-sky-700"
                          >
                            Abrir
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-surface border-b">
                      <tr>
                        {activeTab === 'clients' && ['Abonado', 'Plan', 'Conexión', 'Deuda', 'Mora', 'Estado', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-ink-muted uppercase tracking-wider">{h}</th>)}
                        {activeTab === 'services' && ['ID', 'Abonado', 'Plan comercial', 'IP', 'MAC', 'Estado', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-ink-muted uppercase tracking-wider">{h}</th>)}
                        {activeTab === 'plans' && ['Plan comercial', 'Tipo', 'Velocidad', 'Precio', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-ink-muted uppercase tracking-wider">{h}</th>)}
                        {activeTab === 'ips' && ['Dirección IP', 'Subred', 'Gateway', 'VLAN', 'Estado', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-ink-muted uppercase tracking-wider">{h}</th>)}
                        {activeTab === 'invoices' && ['Nº Factura', 'Cliente', 'Período', 'Neto', 'IVA', 'Total', 'Estado', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-ink-muted uppercase tracking-wider">{h}</th>)}
                        {activeTab === 'tickets' && ['Ticket', 'Cliente', 'Categoría', 'Prioridad', 'Estado', 'Fecha', 'Acciones'].map(h => <th key={h} className="text-left p-4 text-xs font-semibold text-ink-muted uppercase tracking-wider">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.map((item: any) => (
                        <tr key={item.id} className="hover:bg-blue-50/30 transition">
                          {activeTab === 'clients' && <>
                            <td className="p-4">
                              <p className="font-medium text-ink">{item.fullName || 'N/A'}</p>
                              <p className="text-xs text-gray-400">{item.email} · {item.city || '—'}</p>
                            </td>
                            <td className="p-4 text-sm">
                              {item.planName || '—'}
                              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[item.serviceStatus] || 'bg-surface-raised'}`}>
                                {statusLabel[item.serviceStatus] || item.serviceStatus}
                              </span>
                            </td>
                            <td className="p-4">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${connectionColor[item.connectionStatus] || 'bg-surface-raised'}`}>
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
                            <td className="p-4 font-mono text-xs text-ink-muted">{item.macAddress || <span className="text-gray-400">—</span>}</td>
                            <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[item.status] || 'bg-surface-raised'}`}>{statusLabel[item.status] || item.status}</span></td>
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
                            <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${item.status === 'available' ? 'bg-green-100 text-green-700' : item.status === 'assigned' ? 'bg-blue-100 text-blue-700' : 'bg-surface-raised text-gray-600'}`}>{item.status === 'available' ? 'Disponible' : item.status === 'assigned' ? 'Asignada' : 'Reservada'}</span></td>
                          </>}
                          {activeTab === 'invoices' && <>
                            <td className="p-4 font-mono text-sm text-indigo-600" title={item.invoiceNumber}>{item.invoiceNumber}</td>
                            <td className="p-4 text-sm">{item.client?.fullName || 'N/A'}</td>
                            <td className="p-4 text-sm capitalize" title={item.billingPeriod || ''}>{formatBillingPeriod(item.billingPeriod)}</td>
                            <td className="p-4 text-sm">${Number(item.amount).toLocaleString('es-CL')}</td>
                            <td className="p-4 text-sm">${Number(item.tax).toLocaleString('es-CL')}</td>
                            <td className="p-4 font-bold">
                              ${Number(item.total).toLocaleString('es-CL')}
                              {['pending', 'overdue', 'partial'].includes(item.status) && item.balance != null && Number(item.balance) < Number(item.total) && (
                                <p className="text-xs font-medium text-amber-600 mt-0.5">Saldo ${Number(item.balance).toLocaleString('es-CL')}</p>
                              )}
                            </td>
                            <td className="p-4">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[item.status] || 'bg-surface-raised'}`}>{statusLabel[item.status] || item.status}</span>
                              {item.status === 'overdue' && item.dueDate && (
                                <p className="text-xs text-red-600 mt-1">Atrasada {Math.max(0, Math.floor((Date.now() - new Date(String(item.dueDate).split('T')[0]).getTime()) / 86400000))} días</p>
                              )}
                            </td>
                          </>}
                          {activeTab === 'tickets' && <>
                            <td className="p-4"><span className="font-medium text-sm">{item.subject}</span><br/><span className="text-xs text-gray-400 font-mono">{item.ticketNumber}</span></td>
                            <td className="p-4 text-sm">{item.client?.fullName || 'N/A'}</td>
                            <td className="p-4 text-sm text-gray-600">{item.category || '—'}</td>
                            <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[item.priority] || 'bg-surface-raised'}`}>{statusLabel[item.priority] || item.priority}</span></td>
                            <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[item.status] || 'bg-surface-raised'}`}>{statusLabel[item.status] || item.status}</span></td>
                            <td className="p-4 text-sm text-ink-muted">{new Date(item.createdAt).toLocaleDateString('es-CL')}</td>
                          </>}
                          <td className="p-4">
                            <div className="flex items-center gap-1">
                              {activeTab === 'services' && (
                                <>
                                  <button onClick={() => openClientProfile(item.client?.id || item.clientId)}
                                    className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 font-medium flex items-center gap-1">
                                    <Eye className="h-3 w-3" /> Perfil
                                  </button>
                                  {item.status === 'active'
                                    ? <button onClick={() => handleAction('suspend', item.id)} className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 font-medium">Suspender</button>
                                    : <button onClick={() => handleAction('reactivate', item.id)} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 font-medium">Reactivar</button>}
                                </>
                              )}
                              {activeTab === 'invoices' && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      const res = await api().get(`/invoices/${item.id}/pdf`, { responseType: 'blob' })
                                      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
                                      const a = document.createElement('a')
                                      a.href = url
                                      a.download = `${item.invoiceNumber || `factura-${item.id}`}.pdf`
                                      a.click()
                                      URL.revokeObjectURL(url)
                                    } catch (e: any) {
                                      alert(e.response?.data?.error || 'Error al descargar PDF')
                                    }
                                  }}
                                  className="px-2 py-1 text-xs bg-slate-100 text-slate-700 rounded hover:bg-slate-200 font-medium"
                                >
                                  PDF
                                </button>
                              )}
                              {activeTab === 'invoices' && item.status === 'pending' && (
                                <button onClick={() => handleAction('pay', item.id)} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 font-medium">💰 Pagar</button>
                              )}
                              {canEdit.includes(activeTab) && activeTab !== 'services' && activeTab !== 'clients' && (
                                <button onClick={() => openEdit(item)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition"><Edit2 className="h-4 w-4" /></button>
                              )}
                              {activeTab === 'clients' && (
                                <button onClick={() => openClientProfile(item.id)} className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 font-medium">Gestionar</button>
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
