import { useState, useEffect } from 'react'
import { ArrowLeft, User, Wifi, DollarSign, Ticket, X, CheckCircle, Clock, Phone, Mail, MapPin, CreditCard, Plus, Power, PowerOff, Router, Zap, Trash2, Antenna, Pencil, Search } from 'lucide-react'
import axios from 'axios'
import { formatDateCL, todayISO } from '../../lib/formatDate'
import { formatQueueSpeedLabel } from '../../lib/bandwidth'
import SubscriberQueueCard from '../../components/SubscriberQueueCard'

interface Props {
  clientId: number
  API: string
  onBack: () => void
}

function defaultServiceForm() {
  return {
    provisionMode: 'both',
    provisionOnCreate: true,
    status: 'active',
    installationDate: todayISO(),
    billingCycleType: 'anniversary',
    billingDueDay: 5,
    generateFirstInvoice: true,
    siteId: '',
    equipmentId: '',
  }
}

const CLIENT_EQUIP_TYPES = [
  { value: 'cpe', label: 'Antena CPE (Ubiquiti, etc.)' },
  { value: 'ap', label: 'Cámara / Access Point' },
  { value: 'other', label: 'Router u otro dispositivo' },
]

const EQUIP_TYPE_LABEL: Record<string, string> = {
  cpe: 'Antena CPE', ap: 'Cámara / AP', other: 'Dispositivo', router: 'Router',
}

function flattenSites(tree: any[]): any[] {
  const acc: any[] = []
  for (const s of tree) {
    acc.push({ id: s.id, name: s.name, city: s.city })
    if (s.children?.length) acc.push(...flattenSites(s.children))
  }
  return acc
}

export default function ClientDetail({ clientId, API, onBack }: Props) {
  const [client, setClient] = useState<any>(null)
  const [services, setServices] = useState<any[]>([])
  const [invoices, setInvoices] = useState<any[]>([])
  const [tickets, setTickets] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [showPayModal, setShowPayModal] = useState<any>(null)
  const [payMethod, setPayMethod] = useState('transfer')
  const [routers, setRouters] = useState<any[]>([])
  const [plans, setPlans] = useState<any[]>([])
  const [showServiceForm, setShowServiceForm] = useState(false)
  const [serviceForm, setServiceForm] = useState<any>(defaultServiceForm())
  const [provisionRouterId, setProvisionRouterId] = useState<number | null>(null)
  const [provisionMode, setProvisionMode] = useState('both')
  const [provisionPppProfile, setProvisionPppProfile] = useState('default')
  const [provisioning, setProvisioning] = useState(false)
  const [routerCredForm, setRouterCredForm] = useState<any>({})
  const [savingRouterCred, setSavingRouterCred] = useState(false)
  const [savingService, setSavingService] = useState(false)
  const [pppProfiles, setPppProfiles] = useState<any[]>([])
  const [generatingInvoice, setGeneratingInvoice] = useState<number | null>(null)
  const [clientEquipment, setClientEquipment] = useState<any[]>([])
  const [sites, setSites] = useState<any[]>([])
  const [showEquipForm, setShowEquipForm] = useState(false)
  const [equipForm, setEquipForm] = useState<any>({ type: 'cpe', brand: 'Ubiquiti' })
  const [editingEquip, setEditingEquip] = useState<any>(null)
  const [editEquipForm, setEditEquipForm] = useState<any>({})
  const [suggestingIp, setSuggestingIp] = useState(false)
  const [ipSuggestHint, setIpSuggestHint] = useState('')

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
    })
  }

  useEffect(() => {
    Promise.all([
      api().get('/routers'),
      api().get('/plans'),
      api().get('/sites'),
    ]).then(([rRes, pRes, sRes]) => {
      setRouters(Array.isArray(rRes.data) ? rRes.data : [])
      setPlans(Array.isArray(pRes.data) ? pRes.data : [])
      setSites(flattenSites(sRes.data?.tree || []))
    }).catch(() => {})
  }, [clientId])

  async function loadClientEquipment() {
    try {
      const res = await api().get(`/clients/${clientId}/equipment`)
      setClientEquipment(Array.isArray(res.data) ? res.data : [])
    } catch {
      setClientEquipment([])
    }
  }

  async function loadPppProfiles(routerId: number) {
    try {
      const res = await api().get(`/network/routers/${routerId}/ppp-profiles`)
      setPppProfiles(Array.isArray(res.data) ? res.data : [])
    } catch {
      setPppProfiles([])
    }
  }

  async function loadAll() {
    setLoading(true)
    try {
      const [cRes, sRes, iRes, tRes] = await Promise.all([
        api().get(`/clients/${clientId}`),
        api().get('/services'),
        api().get('/invoices'),
        api().get('/tickets'),
      ])
      setClient(cRes.data)
      setServices((Array.isArray(sRes.data) ? sRes.data : []).filter((s: any) =>
        Number(s.client?.id) === Number(clientId) || Number(s.clientId) === Number(clientId)))
      setInvoices((Array.isArray(iRes.data) ? iRes.data : []).filter((i: any) => i.client?.id === clientId || i.clientId === clientId))
      setTickets((Array.isArray(tRes.data) ? tRes.data : []).filter((t: any) => t.client?.id === clientId || t.clientId === clientId))
      await loadClientEquipment()
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [clientId])

  async function provisionNetwork(serviceId: number, serviceRouterId?: number | null) {
    const routerId = provisionRouterId || serviceRouterId || null
    if (!routerId) {
      alert('Selecciona un router MikroTik')
      return
    }
    const router = routers.find((r) => r.id === routerId)
    if (router && !router.hasApiCredentials) {
      if (!routerCredForm.routerUser || !routerCredForm.routerPass) {
        alert('Configura usuario y contraseña API del router antes de provisionar')
        return
      }
      setSavingRouterCred(true)
      try {
        await api().patch(`/routers/${routerId}`, {
          routerUser: routerCredForm.routerUser,
          routerPass: routerCredForm.routerPass,
          tunnelHostname: routerCredForm.tunnelHostname || router.credentials?.tunnelHostname || router.ipAddress,
          connectionMethod: router.credentials?.connectionMethod || 'cloudflare_tunnel',
        })
        const rRes = await api().get('/routers')
        setRouters(Array.isArray(rRes.data) ? rRes.data : [])
      } catch (e: any) {
        alert('Error al guardar credenciales: ' + (e.response?.data?.error || e.message))
        setSavingRouterCred(false)
        return
      }
      setSavingRouterCred(false)
    }
    setProvisioning(true)
    try {
      const res = await api().post(`/services/${serviceId}/provision`, {
        routerId,
        provisionMode,
        pppProfile: provisionPppProfile,
      })
      const parts = []
      if (res.data.username) parts.push(`PPPoE: ${res.data.username}\nClave: ${res.data.password}`)
      if (res.data.queueName) {
        const qAction = res.data.actions?.queue?.action === 'updated' ? 'actualizada' : 'creada'
        parts.push(`Cola ${qAction}: ${res.data.queueName} (${res.data.maxLimit})`)
      }
      if (res.data.actions?.pppoe?.action === 'updated') parts.unshift('PPPoE actualizado (sin duplicar)')
      if (res.data.actions?.dhcpLease) {
        parts.push(`DHCP lease ${res.data.actions.dhcpLease.action}: ${res.data.service?.ipAddress || ''}`)
      }
      if (res.data.service) {
        setServices((prev) => prev.map((s) => (s.id === serviceId
          ? { ...s, ...res.data.service, plan: s.plan, client: s.client }
          : s)))
      }
      await loadAll()
      alert('Provisionado en router:\n' + parts.join('\n'))
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    }
    setProvisioning(false)
  }

  async function createService() {
    if (!serviceForm.planId) {
      alert('Selecciona un plan comercial')
      return
    }
    if (serviceForm.provisionOnCreate && !serviceForm.routerId) {
      alert('Selecciona el router donde provisionar, o desmarca "Provisionar en router"')
      return
    }
    setSavingService(true)
    try {
      const res = await api().post('/services', {
        clientId,
        planId: serviceForm.planId,
        ipAddress: serviceForm.ipAddress || null,
        macAddress: serviceForm.macAddress || null,
        routerId: serviceForm.routerId || null,
        status: serviceForm.status || 'active',
        provisionNetwork: serviceForm.provisionOnCreate && !!serviceForm.routerId,
        provisionMode: serviceForm.provisionMode || 'both',
        installationDate: serviceForm.installationDate,
        billingCycleType: serviceForm.billingCycleType || 'anniversary',
        billingDueDay: serviceForm.billingDueDay ?? 5,
        generateFirstInvoice: serviceForm.generateFirstInvoice !== false,
      })
      if (res.data.invoiceWarning) alert('Servicio creado. Factura: ' + res.data.invoiceWarning)
      else if (res.data.firstInvoice) {
        alert(`Servicio creado.\nFactura ${res.data.firstInvoice.invoiceNumber} por $${Number(res.data.firstInvoice.total).toLocaleString('es-CL')}`)
      } else if (res.data.networkWarning) {
        alert('Servicio creado con advertencia: ' + res.data.networkWarning)
      } else if (res.data.network) {
        const n = res.data.network
        const parts = ['Servicio creado.']
        if (n.username) parts.push(`PPPoE: ${n.username} / ${n.password}`)
        if (n.queueName) parts.push(`Cola: ${n.queueName}`)
        alert(parts.join('\n'))
      }
      setShowServiceForm(false)
      setServiceForm(defaultServiceForm())
      if (serviceForm.equipmentId) {
        await api().patch(`/sites/equipment/${serviceForm.equipmentId}`, { clientId }).catch(() => {})
      }
      loadAll()
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    }
    setSavingService(false)
  }

  async function generateInvoice(serviceId: number) {
    setGeneratingInvoice(serviceId)
    try {
      const preview = await api().get(`/invoices/preview/${serviceId}`)
      const p = preview.data
      const msg = p.window.isProrated
        ? `Factura proporcional: ${p.days}/${p.totalDays} días\nNeto: $${p.amount.toLocaleString('es-CL')} · Total: $${p.total.toLocaleString('es-CL')}\nVence: ${formatDateCL(p.dueDate)}\n\n¿Generar?`
        : `Factura ciclo completo\nTotal: $${p.total.toLocaleString('es-CL')}\nVence: ${formatDateCL(p.dueDate)}\n\n¿Generar?`
      if (!confirm(msg)) { setGeneratingInvoice(null); return }
      const res = await api().post(`/invoices/service/${serviceId}`)
      alert(res.data.message + `\nTotal: $${Number(res.data.total).toLocaleString('es-CL')}`)
      loadAll()
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    }
    setGeneratingInvoice(null)
  }

  function billingCycleLabel(type: string, billingDay?: number) {
    if (type === 'calendar_prorate') return 'Proporcional (instalación → fin de mes)'
    return billingDay ? `Aniversario (día ${billingDay} al ${billingDay})` : 'Aniversario (día a día)'
  }

  async function deleteService(serviceId: number, planName: string) {
    if (!confirm(`¿Eliminar el servicio "${planName}"? El abonado conserva su cuenta.`)) return
    try {
      await api().delete(`/services/${serviceId}`)
      loadAll()
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    }
  }

  async function toggleService(serviceId: number, currentStatus: string) {
    try {
      const action = currentStatus === 'active' ? 'suspend' : 'reactivate'
      const res = await api().put(`/services/${serviceId}/${action}`)
      const net = res.data.network
      if (net?.error) alert('Servicio actualizado pero red: ' + net.error)
      else if (net?.skipped) alert('Servicio actualizado (sin provisión en router)')
      loadAll()
    } catch (e: any) { alert('Error: ' + (e.response?.data?.error || e.message)) }
  }

  async function payInvoice() {
    if (!showPayModal) return
    try {
      await api().post('/payments', { invoiceId: showPayModal.id, method: payMethod, amount: showPayModal.total })
      setShowPayModal(null)
      loadAll()
    } catch (e: any) { alert('Error: ' + (e.response?.data?.error || e.message)) }
  }

  async function suggestFreeIp(target: 'create' | 'edit' | 'service', siteId?: number) {
    const sid = siteId || (target === 'edit' ? editingEquip?.siteId : equipForm.siteId || serviceForm.siteId)
    if (!sid) {
      alert('Selecciona un nodo primero')
      return
    }
    setSuggestingIp(true)
    setIpSuggestHint('')
    try {
      const siteRouters = routers.filter((r) => r.siteId === sid)
      const routerId = siteRouters[0]?.id
      const q = routerId ? `?routerId=${routerId}` : ''
      const res = await api().get(`/network/sites/${sid}/next-free-ip${q}`)
      const ip = res.data.ip
      const mac = res.data.macAddress
      if (target === 'edit') setEditEquipForm((f: any) => ({ ...f, ipAddress: ip, ...(mac ? { macAddress: mac } : {}) }))
      else if (target === 'service') setServiceForm((f: any) => ({ ...f, ipAddress: ip, ...(mac ? { macAddress: mac } : {}) }))
      else setEquipForm((f: any) => ({ ...f, ipAddress: ip, siteId: sid, ...(mac ? { macAddress: mac } : {}) }))
      const macHint = mac ? ` · MAC ${mac} (DHCP)` : ''
      setIpSuggestHint(`Desde pool ${res.data.pool} · ${res.data.ranges}${macHint}`)
      if (!mac) await lookupMacForIp(ip, sid, target)
    } catch (e: any) {
      alert(e.response?.data?.error || e.message)
    }
    setSuggestingIp(false)
  }

  async function lookupMacForIp(ip: string, siteId: number | string, target: 'create' | 'edit' | 'service' = 'create') {
    const cleanIp = String(ip || '').split('/')[0].trim()
    if (!cleanIp || !siteId) return
    try {
      const routerId = siteRoutersFor(siteId)[0]?.id
      const q = routerId ? `&routerId=${routerId}` : ''
      const res = await api().get(`/network/sites/${siteId}/mac-for-ip?ip=${encodeURIComponent(cleanIp)}${q}`)
      if (!res.data.macAddress) return
      const mac = res.data.macAddress
      if (target === 'edit') setEditEquipForm((f: any) => ({ ...f, macAddress: mac }))
      else if (target === 'service') setServiceForm((f: any) => ({ ...f, macAddress: mac }))
      else setEquipForm((f: any) => ({ ...f, macAddress: mac }))
      if (res.data.source === 'dhcp-lease') {
        setIpSuggestHint((h) => h ? h : `MAC ${mac} desde lease DHCP del MikroTik`)
      }
    } catch { /* sin lease aún */ }
  }

  async function createClientEquipment() {
    try {
      await api().post('/sites/equipment', {
        ...equipForm,
        clientId,
        siteId: equipForm.siteId || null,
      })
      setShowEquipForm(false)
      setEquipForm({ type: 'cpe', brand: 'Ubiquiti' })
      setIpSuggestHint('')
      await loadClientEquipment()
      loadAll()
    } catch (e: any) { alert(e.response?.data?.error || e.message) }
  }

  function openEditEquip(eq: any) {
    setEditingEquip(eq)
    setEditEquipForm({
      name: eq.name || '',
      brand: eq.brand || '',
      model: eq.model || '',
      type: eq.type || 'cpe',
      ipAddress: eq.ipAddress || '',
      macAddress: eq.macAddress || '',
      snmpCommunity: eq.snmpCommunity || '',
      siteId: eq.siteId || '',
    })
    setIpSuggestHint('')
  }

  async function saveEditEquip() {
    if (!editingEquip) return
    try {
      await api().patch(`/sites/equipment/${editingEquip.id}`, {
        ...editEquipForm,
        clientId,
        siteId: editEquipForm.siteId || null,
      })
      setEditingEquip(null)
      setEditEquipForm({})
      setIpSuggestHint('')
      await loadClientEquipment()
      loadAll()
    } catch (e: any) { alert(e.response?.data?.error || e.message) }
  }

  async function unlinkEquipment(equipmentId: number, name: string) {
    if (!confirm(`¿Desvincular "${name}" de este abonado? El equipo sigue en el nodo.`)) return
    try {
      await api().patch(`/sites/equipment/${equipmentId}`, { clientId: null })
      await loadClientEquipment()
    } catch (e: any) { alert(e.response?.data?.error || e.message) }
  }

  function applyEquipmentToService(equipmentId: string) {
    const eq = clientEquipment.find((e) => String(e.id) === String(equipmentId))
    if (!eq) return
    setServiceForm((f: any) => ({
      ...f,
      equipmentId: eq.id,
      ipAddress: eq.ipAddress || f.ipAddress,
      macAddress: eq.macAddress || f.macAddress,
      siteId: eq.siteId || f.siteId,
      routerId: eq.siteId
        ? String(routers.find((r) => r.siteId === eq.siteId)?.id || f.routerId || '')
        : f.routerId,
    }))
  }

  const siteRoutersFor = (siteId: number | string) =>
    routers.filter((r) => r.siteId === Number(siteId))

  const statusColor: Record<string, string> = {
    active: 'bg-green-100 text-green-700', suspended: 'bg-yellow-100 text-yellow-700',
    cancelled: 'bg-red-100 text-red-700', pending: 'bg-blue-100 text-blue-700',
    paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700',
    open: 'bg-yellow-100 text-yellow-700', resolved: 'bg-green-100 text-green-700',
    in_progress: 'bg-blue-100 text-blue-700', closed: 'bg-gray-100 text-gray-500',
    critical: 'bg-red-100 text-red-700', high: 'bg-orange-100 text-orange-700',
    medium: 'bg-blue-100 text-blue-700', low: 'bg-gray-100 text-gray-500',
  }
  const statusLabel: Record<string, string> = {
    active: 'Activo', suspended: 'Suspendido', cancelled: 'Cancelado', pending: 'Pendiente',
    paid: 'Pagada', overdue: 'Vencida', open: 'Abierto', resolved: 'Resuelto',
    in_progress: 'En proceso', closed: 'Cerrado', cut: 'Cortado',
    critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja',
    individual: 'Individual', business: 'Empresa',
  }

  const pendingInvoices = invoices.filter(i => i.status === 'pending' || i.status === 'overdue')
  const totalDeuda = pendingInvoices.reduce((sum, i) => sum + Number(i.total || 0), 0)
  const primaryAntenna = clientEquipment.find((e) => e.type === 'cpe') || clientEquipment[0]
  const antennaOnline = primaryAntenna?.status === 'online'
  const activeService = services.find((s) => s.status === 'active')
  const nextDueInvoice = [...pendingInvoices].sort((a, b) =>
    new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0]
  const hasDuplicateServices = services.length > 1 && (
    new Set(services.map(s => `${s.plan?.id}-${s.ipAddress || ''}`)).size < services.length
    || services.filter(s => s.status === 'active').length > 1
  )

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-500">Cargando cliente...</p>
      </div>
    </div>
  )

  if (!client) return (
    <div className="flex-1 flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <p className="text-gray-500">Cliente no encontrado</p>
        <button onClick={onBack} className="mt-4 text-blue-600 hover:underline">Volver</button>
      </div>
    </div>
  )

  return (
    <div className="flex-1 overflow-auto bg-gray-50">
      {/* Pay Modal */}
      {showPayModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
            <div className="flex justify-between items-center mb-4 border-b pb-3">
              <h3 className="font-bold text-lg">Registrar pago</h3>
              <button onClick={() => setShowPayModal(null)}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500">Factura</p>
                <p className="font-bold text-lg">{showPayModal.invoiceNumber}</p>
                <p className="text-2xl font-bold text-blue-600 mt-1">${Number(showPayModal.total).toLocaleString('es-CL')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Método de pago</label>
                <select className="w-full border rounded-lg px-3 py-2" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                  <option value="transfer">Transferencia bancaria</option>
                  <option value="cash">Efectivo</option>
                  <option value="card">Tarjeta</option>
                  <option value="flow">Flow</option>
                  <option value="other">Otro</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t">
              <button onClick={() => setShowPayModal(null)} className="flex-1 py-2.5 border rounded-lg hover:bg-gray-50 font-medium">Cancelar</button>
              <button onClick={payInvoice} className="flex-1 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium">Confirmar pago</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal nuevo servicio */}
      {showServiceForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4 border-b pb-3">
              <h3 className="font-bold text-lg">Nuevo servicio de internet</h3>
              <button onClick={() => setShowServiceForm(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Plan comercial *</label>
                <select className="w-full border rounded-lg px-3 py-2 bg-white" value={serviceForm.planId || ''}
                  onChange={e => setServiceForm({ ...serviceForm, planId: e.target.value })}>
                  <option value="">Seleccionar plan...</option>
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>{p.name} — {p.downloadSpeed}/{p.uploadSpeed} Mbps — ${Number(p.price).toLocaleString('es-CL')}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha instalación *</label>
                  <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={(serviceForm.installationDate || todayISO()).split('T')[0]}
                    onChange={e => {
                      const d = e.target.value
                      const day = d ? parseInt(d.split('-')[2], 10) : 5
                      setServiceForm({
                        ...serviceForm,
                        installationDate: d,
                        ...(serviceForm.billingCycleType === 'anniversary' ? { billingDueDay: day } : {}),
                      })
                    }} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ciclo de cobro</label>
                  <select className="w-full border rounded-lg px-3 py-2 bg-white text-sm"
                    value={serviceForm.billingCycleType || 'anniversary'}
                    onChange={e => setServiceForm({ ...serviceForm, billingCycleType: e.target.value })}>
                    <option value="anniversary">Aniversario (12 al 12, 16 al 16…)</option>
                    <option value="calendar_prorate">Proporcional (instalación → fin de mes)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Día de vencimiento del pago
                </label>
                <select className="w-full border rounded-lg px-3 py-2 bg-white text-sm"
                  value={String(serviceForm.billingDueDay ?? 5)}
                  onChange={e => setServiceForm({ ...serviceForm, billingDueDay: parseInt(e.target.value, 10) })}>
                  {serviceForm.billingCycleType === 'calendar_prorate' ? (
                    <>
                      <option value="5">Día 5 del mes siguiente</option>
                      <option value="10">Día 10 del mes siguiente</option>
                      <option value="0">Último día del mes de instalación</option>
                    </>
                  ) : (
                    Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                      <option key={d} value={d}>Día {d} de cada ciclo</option>
                    ))
                  )}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {serviceForm.billingCycleType === 'calendar_prorate'
                    ? 'Ej: instala 12 ene → cobra proporcional 12–31 ene, paga el día que elijas del mes siguiente.'
                    : 'Ej: instala 12 ene → cada factura cubre del 12 al 12 del mes siguiente.'}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={serviceForm.generateFirstInvoice !== false}
                  onChange={e => setServiceForm({ ...serviceForm, generateFirstInvoice: e.target.checked })} />
                Generar primera factura al crear
              </label>

              <div className="bg-orange-50 border border-orange-100 rounded-lg p-4 space-y-3">
                <p className="text-sm font-medium text-orange-900 flex items-center gap-2"><Antenna className="h-4 w-4" /> Conexión y equipos</p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nodo / torre</label>
                  <select className="w-full border rounded-lg px-3 py-2 bg-white text-sm" value={serviceForm.siteId || ''}
                    onChange={e => {
                      const siteId = e.target.value
                      const firstRouter = siteRoutersFor(siteId)[0]
                      setServiceForm({
                        ...serviceForm,
                        siteId,
                        routerId: firstRouter ? String(firstRouter.id) : '',
                        equipmentId: '',
                      })
                    }}>
                    <option value="">Seleccionar nodo...</option>
                    {sites.map(s => (
                      <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Antena / equipo del abonado</label>
                  <select className="w-full border rounded-lg px-3 py-2 bg-white text-sm" value={serviceForm.equipmentId || ''}
                    onChange={e => {
                      const val = e.target.value
                      if (val === '__new__') {
                        setShowEquipForm(true)
                        setEquipForm({ type: 'cpe', brand: 'Ubiquiti', siteId: serviceForm.siteId || '' })
                        return
                      }
                      applyEquipmentToService(val)
                    }}>
                    <option value="">Sin vincular (IP manual)</option>
                    {clientEquipment.map(eq => (
                      <option key={eq.id} value={eq.id}>{eq.name} — {eq.ipAddress || 'sin IP'}</option>
                    ))}
                    <option value="__new__">+ Registrar nueva antena...</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">IP</label>
                    <div className="flex gap-1">
                      <input className="flex-1 border rounded-lg px-3 py-2 font-mono text-sm min-w-0" placeholder="172.16.140.2"
                        value={serviceForm.ipAddress || ''} onChange={e => setServiceForm({ ...serviceForm, ipAddress: e.target.value })} />
                      <button type="button" disabled={suggestingIp || !serviceForm.siteId}
                        onClick={() => suggestFreeIp('service', Number(serviceForm.siteId))}
                        className="shrink-0 px-2 py-2 border rounded-lg text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-40" title="IP libre">
                        <Search className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">MAC antena</label>
                    <input className="w-full border rounded-lg px-3 py-2 font-mono text-sm" placeholder="AA:BB:CC:DD:EE:FF"
                      value={serviceForm.macAddress || ''} onChange={e => setServiceForm({ ...serviceForm, macAddress: e.target.value })} />
                  </div>
                </div>
                {ipSuggestHint && <p className="text-xs text-emerald-700">{ipSuggestHint}</p>}
              </div>

              <div className="bg-sky-50 border border-sky-100 rounded-lg p-4 space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-sky-900">
                  <input type="checkbox" checked={serviceForm.provisionOnCreate !== false}
                    onChange={e => setServiceForm({ ...serviceForm, provisionOnCreate: e.target.checked })} />
                  Provisionar en router MikroTik al crear
                </label>
                {serviceForm.provisionOnCreate !== false && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Router del nodo *</label>
                      <select className="w-full border rounded-lg px-3 py-2 bg-white" value={serviceForm.routerId || ''}
                        onChange={e => setServiceForm({ ...serviceForm, routerId: e.target.value })}>
                        <option value="">Seleccionar router...</option>
                        {(serviceForm.siteId ? siteRoutersFor(serviceForm.siteId) : routers).map(r => (
                          <option key={r.id} value={r.id}>{r.name} {r.agentConnected ? '● online' : '○ offline'}</option>
                        ))}
                      </select>
                      {serviceForm.siteId && siteRoutersFor(serviceForm.siteId).length === 0 && (
                        <p className="text-xs text-amber-700 mt-1">Este nodo no tiene router. Configúralo en Red ISP.</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Modo de conexión</label>
                      <select className="w-full border rounded-lg px-3 py-2 bg-white" value={serviceForm.provisionMode || 'both'}
                        onChange={e => setServiceForm({ ...serviceForm, provisionMode: e.target.value })}>
                        <option value="both">PPPoE + Simple Queue (WISP con autenticación)</option>
                        <option value="pppoe">Solo PPPoE</option>
                        <option value="queue">Solo Simple Queue (IP fija, sin PPPoE)</option>
                        <option value="static">IP estática + cola + lease DHCP en MikroTik</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        <strong>DHCP dinámico:</strong> usa PPPoE o IP estática + lease. <strong>IP fija WISP:</strong> modo cola o estática + lease con MAC de la antena.
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t">
              <button onClick={() => setShowServiceForm(false)} className="flex-1 py-2.5 border rounded-lg hover:bg-gray-50 font-medium">Cancelar</button>
              <button onClick={createService} disabled={savingService}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50">
                {savingService ? 'Creando...' : 'Crear servicio'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal agregar equipo al abonado */}
      {showEquipForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4 border-b pb-3">
              <h3 className="font-bold text-lg">Agregar equipo al abonado</h3>
              <button onClick={() => { setShowEquipForm(false); setIpSuggestHint('') }}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Tipo</label>
                <select className="w-full border rounded-lg px-3 py-2 bg-white" value={equipForm.type || 'cpe'}
                  onChange={e => setEquipForm({ ...equipForm, type: e.target.value })}>
                  {CLIENT_EQUIP_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Nombre *</label>
                <input className="w-full border rounded-lg px-3 py-2" placeholder="LiteBeam Carlos"
                  value={equipForm.name || ''} onChange={e => setEquipForm({ ...equipForm, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Nodo / torre *</label>
                <select className="w-full border rounded-lg px-3 py-2 bg-white" value={equipForm.siteId || ''}
                  onChange={e => setEquipForm({ ...equipForm, siteId: e.target.value })}>
                  <option value="">Seleccionar...</option>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ''}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm font-medium mb-1">Marca</label>
                  <input className="w-full border rounded-lg px-3 py-2" value={equipForm.brand || ''}
                    onChange={e => setEquipForm({ ...equipForm, brand: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Modelo</label>
                  <input className="w-full border rounded-lg px-3 py-2" value={equipForm.model || ''}
                    onChange={e => setEquipForm({ ...equipForm, model: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">IP</label>
                <div className="flex gap-2">
                  <input className="flex-1 border rounded-lg px-3 py-2 font-mono text-sm"
                    value={equipForm.ipAddress || ''}
                    onChange={e => setEquipForm({ ...equipForm, ipAddress: e.target.value })}
                    onBlur={e => lookupMacForIp(e.target.value, equipForm.siteId, 'create')} />
                  <button type="button" disabled={suggestingIp || !equipForm.siteId}
                    onClick={() => suggestFreeIp('create')}
                    className="px-3 py-2 border rounded-lg text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-40">
                    <Search className="h-4 w-4" />
                  </button>
                </div>
                {ipSuggestHint && <p className="text-xs text-emerald-700 mt-1">{ipSuggestHint}</p>}
              </div>
              {equipForm.type === 'cpe' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">MAC</label>
                    <input className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                      value={equipForm.macAddress || ''} onChange={e => setEquipForm({ ...equipForm, macAddress: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">SNMP Community</label>
                    <input className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                      value={equipForm.snmpCommunity || ''} onChange={e => setEquipForm({ ...equipForm, snmpCommunity: e.target.value })} />
                  </div>
                </>
              )}
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t">
              <button onClick={() => { setShowEquipForm(false); setIpSuggestHint('') }} className="flex-1 py-2.5 border rounded-lg">Cancelar</button>
              <button onClick={createClientEquipment} className="flex-1 py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700">Agregar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal editar equipo */}
      {editingEquip && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4 border-b pb-3">
              <h3 className="font-bold text-lg">Editar equipo</h3>
              <button onClick={() => { setEditingEquip(null); setIpSuggestHint('') }}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Nombre</label>
                <input className="w-full border rounded-lg px-3 py-2" value={editEquipForm.name || ''}
                  onChange={e => setEditEquipForm({ ...editEquipForm, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Nodo</label>
                <select className="w-full border rounded-lg px-3 py-2 bg-white" value={editEquipForm.siteId || ''}
                  onChange={e => setEditEquipForm({ ...editEquipForm, siteId: e.target.value })}>
                  <option value="">Sin nodo</option>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">IP</label>
                <div className="flex gap-2">
                  <input className="flex-1 border rounded-lg px-3 py-2 font-mono text-sm"
                    value={editEquipForm.ipAddress || ''}
                    onChange={e => setEditEquipForm({ ...editEquipForm, ipAddress: e.target.value })}
                    onBlur={e => lookupMacForIp(e.target.value, editEquipForm.siteId || editingEquip?.siteId, 'edit')} />
                  <button type="button" disabled={suggestingIp} onClick={() => suggestFreeIp('edit')}
                    className="px-3 py-2 border rounded-lg text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-40">
                    <Search className="h-4 w-4" />
                  </button>
                </div>
                {ipSuggestHint && <p className="text-xs text-emerald-700 mt-1">{ipSuggestHint}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">MAC</label>
                <input className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                  placeholder="Auto desde DHCP del MikroTik"
                  value={editEquipForm.macAddress || ''} onChange={e => setEditEquipForm({ ...editEquipForm, macAddress: e.target.value })} />
                <p className="text-xs text-gray-500 mt-1">Se completa al salir del campo IP si hay lease DHCP en el router.</p>
              </div>
              {editEquipForm.type === 'cpe' && (
                <div>
                  <label className="block text-sm font-medium mb-1">SNMP</label>
                  <input className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                    value={editEquipForm.snmpCommunity || ''} onChange={e => setEditEquipForm({ ...editEquipForm, snmpCommunity: e.target.value })} />
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t">
              <button onClick={() => { setEditingEquip(null); setIpSuggestHint('') }} className="flex-1 py-2.5 border rounded-lg">Cancelar</button>
              <button onClick={saveEditEquip} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b px-8 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-3 flex-1">
            <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
              {client.user?.fullName?.charAt(0) || '?'}
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{client.user?.fullName}</h1>
              <p className="text-sm text-gray-500">{client.user?.email} · {client.city || 'Sin ciudad'}</p>
            </div>
          </div>
          {totalDeuda > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-center">
              <p className="text-xs text-red-500 font-medium">Deuda pendiente</p>
              <p className="text-lg font-bold text-red-600">${totalDeuda.toLocaleString('es-CL')}</p>
            </div>
          )}
          <div className="hidden md:flex items-center gap-2 flex-wrap justify-end">
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${activeService ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
              {activeService ? '● Servicio activo' : '○ Sin servicio'}
            </span>
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              !primaryAntenna ? 'bg-amber-100 text-amber-800' : antennaOnline ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {!primaryAntenna ? '○ Sin antena' : antennaOnline ? '● Antena online' : '● Antena offline'}
            </span>
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              nextDueInvoice?.status === 'overdue' ? 'bg-red-100 text-red-700'
                : nextDueInvoice ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-600'
            }`}>
              {nextDueInvoice
                ? (nextDueInvoice.status === 'overdue' ? '⚠ Boleta vencida' : `Boleta vence ${formatDateCL(nextDueInvoice.dueDate)}`)
                : 'Sin boleta pendiente'}
            </span>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-6xl mx-auto">
        {/* Stats rápidas */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Servicios', value: services.length, icon: Wifi, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'Equipos', value: clientEquipment.length, icon: Antenna, color: 'text-orange-600', bg: 'bg-orange-50' },
            { label: 'Por cobrar', value: '$' + totalDeuda.toLocaleString('es-CL'), icon: CreditCard, color: 'text-red-600', bg: 'bg-red-50' },
            { label: 'Tickets', value: tickets.filter(t => t.status === 'open').length + ' abiertos', icon: Ticket, color: 'text-yellow-600', bg: 'bg-yellow-50' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-lg ${s.bg}`}><s.icon className={`h-4 w-4 ${s.color}`} /></div>
                <p className="text-xs text-gray-500 font-medium">{s.label}</p>
              </div>
              <p className="text-xl font-bold text-gray-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
          {[
            { id: 'overview', label: 'Resumen' },
            { id: 'equipment', label: `Equipos (${clientEquipment.length})` },
            { id: 'services', label: `Servicio (${services.length})` },
            { id: 'invoices', label: `Facturas (${invoices.length})` },
            { id: 'tickets', label: `Tickets (${tickets.length})` },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === tab.id ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Datos personales */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-semibold text-gray-900 flex items-center gap-2"><User className="h-4 w-4 text-blue-600" /> Datos personales</h2>
              </div>
              <div className="space-y-3">
                {[
                  { label: 'Nombre', value: client.user?.fullName, icon: User },
                  { label: 'Email', value: client.user?.email, icon: Mail },
                  { label: 'Teléfono', value: client.user?.phone || '—', icon: Phone },
                  { label: 'RUT', value: client.rut || '—', icon: CreditCard },
                  { label: 'Dirección', value: client.address || '—', icon: MapPin },
                  { label: 'Ciudad', value: client.city || '—', icon: MapPin },
                  { label: 'Región', value: client.region || '—', icon: MapPin },
                  { label: 'Tipo', value: statusLabel[client.clientType] || client.clientType, icon: User },
                ].map(f => (
                  <div key={f.label} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                    <f.icon className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 font-medium">{f.label}</p>
                      <p className="text-sm text-gray-900 truncate">{f.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Servicio activo */}
            <div className="space-y-4">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="font-semibold text-gray-900 flex items-center gap-2"><Wifi className="h-4 w-4 text-green-600" /> Servicio actual</h2>
                  <button onClick={() => setActiveTab('services')} className="text-xs text-blue-600 hover:underline">Ver todos →</button>
                </div>
                {hasDuplicateServices && (
                  <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
                    ⚠️ Hay {services.length} suscripciones — probable duplicado. Elimina una (deja solo una activa por plan).
                  </div>
                )}
                {services.length === 0 ? (
                  <div className="text-center py-6 text-gray-400">
                    <Wifi className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Sin servicios asignados</p>
                    <button onClick={() => setShowServiceForm(true)} className="mt-2 text-blue-600 text-sm hover:underline">+ Crear servicio</button>
                  </div>
                ) : services.map(s => (
                  <div key={s.id} className="border rounded-lg p-4 mb-3 last:mb-0">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold text-gray-900">{s.plan?.name || 'Plan desconocido'}</p>
                        <p className="text-sm text-gray-500">{s.plan?.downloadSpeed}/{s.plan?.uploadSpeed} Mbps · #{s.id}</p>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[s.status] || 'bg-gray-100'}`}>
                        {statusLabel[s.status] || s.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 mt-3">
                      <div><span className="font-medium">Instalación:</span> {formatDateCL(s.installationDate)}</div>
                      <div><span className="font-medium">Próx. cobro:</span> {formatDateCL(s.nextBillingDate)}</div>
                      <div><span className="font-medium">Ciclo:</span> {billingCycleLabel(s.billingCycleType, s.billingDay)}</div>
                      <div><span className="font-medium">Precio:</span> ${Number(s.plan?.price || 0).toLocaleString('es-CL')}</div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => toggleService(s.id, s.status)}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 ${s.status === 'active' ? 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>
                        {s.status === 'active' ? <><PowerOff className="h-3.5 w-3.5" /> Suspender</> : <><Power className="h-3.5 w-3.5" /> Reactivar</>}
                      </button>
                      <button onClick={() => deleteService(s.id, s.plan?.name || 'servicio')}
                        className="px-3 py-2 rounded-lg text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 flex items-center gap-1">
                        <Trash2 className="h-3.5 w-3.5" /> Eliminar
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Equipos del abonado */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="font-semibold text-gray-900 flex items-center gap-2"><Antenna className="h-4 w-4 text-orange-600" /> Equipos</h2>
                  <button onClick={() => setActiveTab('equipment')} className="text-xs text-blue-600 hover:underline">Gestionar →</button>
                </div>
                {clientEquipment.length === 0 ? (
                  <div className="text-center py-4 text-gray-400 text-sm">
                    <p>Sin antenas ni dispositivos vinculados</p>
                    <button onClick={() => { setEquipForm({ type: 'cpe', brand: 'Ubiquiti' }); setShowEquipForm(true) }}
                      className="mt-2 text-blue-600 hover:underline">+ Agregar antena</button>
                  </div>
                ) : clientEquipment.slice(0, 3).map((eq) => (
                  <div key={eq.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${eq.status === 'online' ? 'bg-green-500' : 'bg-red-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{eq.name}</p>
                      <p className="text-xs text-gray-400">{EQUIP_TYPE_LABEL[eq.type] || eq.type} · {eq.ipAddress || 'sin IP'}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${eq.status === 'online' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {eq.status === 'online' ? 'Online' : 'Offline'}
                    </span>
                  </div>
                ))}
              </div>

              {/* Última factura */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4"><DollarSign className="h-4 w-4 text-purple-600" /> Facturas recientes</h2>
                {invoices.length === 0 ? (
                  <div className="text-center py-4 text-gray-400 text-sm">Sin facturas</div>
                ) : invoices.slice(0, 3).map(inv => (
                  <div key={inv.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{inv.invoiceNumber}</p>
                      <p className="text-xs text-gray-400">{inv.billingPeriod || formatDateCL(inv.dueDate)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold">${Number(inv.total).toLocaleString('es-CL')}</p>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[inv.status] || 'bg-gray-100'}`}>
                        {statusLabel[inv.status] || inv.status}
                      </span>
                      {(inv.status === 'pending' || inv.status === 'overdue') && (
                        <button onClick={() => setShowPayModal(inv)} className="px-2 py-0.5 bg-green-600 text-white rounded text-xs hover:bg-green-700">Pagar</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* EQUIPOS */}
        {activeTab === 'equipment' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center flex-wrap gap-3">
              <p className="text-sm text-gray-500">Antenas, cámaras y dispositivos del abonado vinculados a nodos de red</p>
              <button onClick={() => { setEquipForm({ type: 'cpe', brand: 'Ubiquiti' }); setShowEquipForm(true) }}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm font-medium flex items-center gap-2">
                <Plus className="h-4 w-4" /> Agregar equipo
              </button>
            </div>
            {clientEquipment.length === 0 ? (
              <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
                <Antenna className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="font-medium text-gray-600">Sin equipos asignados</p>
                <p className="text-sm mt-1 max-w-md mx-auto">Registra la antena Ubiquiti, cámara o router del cliente y asígnala a un nodo (ej. Torre Pangui).</p>
                <button onClick={() => { setEquipForm({ type: 'cpe', brand: 'Ubiquiti' }); setShowEquipForm(true) }}
                  className="mt-4 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium">+ Agregar antena CPE</button>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {clientEquipment.map((eq) => (
                  <div key={eq.id} className="bg-white rounded-xl border p-5 hover:shadow-sm transition">
                    <div className="flex items-start gap-3">
                      <span className={`w-3 h-3 rounded-full mt-1.5 flex-shrink-0 ${eq.status === 'online' ? 'bg-green-500' : eq.status === 'offline' ? 'bg-red-500' : 'bg-gray-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <p className="font-semibold text-gray-900">{eq.name}</p>
                            <p className="text-xs text-gray-500">{EQUIP_TYPE_LABEL[eq.type] || eq.type} · {eq.brand} {eq.model}</p>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${eq.status === 'online' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                            {eq.status === 'online' ? 'Online' : 'Offline'}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
                          <div><span className="text-gray-400">IP:</span> <span className="font-mono">{eq.ipAddress || '—'}</span></div>
                          <div><span className="text-gray-400">MAC:</span> <span className="font-mono">{eq.macAddress || '—'}</span></div>
                          <div className="col-span-2"><span className="text-gray-400">Nodo:</span> {eq.siteName || 'Sin nodo'} {eq.siteCity ? `· ${eq.siteCity}` : ''}</div>
                          {eq.snmpCommunity && <div className="col-span-2"><span className="text-gray-400">SNMP:</span> {eq.snmpCommunity}</div>}
                        </div>
                        <div className="flex gap-2 mt-4">
                          <button onClick={() => openEditEquip(eq)}
                            className="px-3 py-1.5 text-xs bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 flex items-center gap-1">
                            <Pencil className="h-3 w-3" /> Editar
                          </button>
                          <button onClick={() => unlinkEquipment(eq.id, eq.name)}
                            className="px-3 py-1.5 text-xs bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100">
                            Desvincular
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="bg-sky-50 border border-sky-100 rounded-xl p-4 text-sm text-sky-900">
              <strong>Tip:</strong> La configuración del router del nodo (pools DHCP, PPPoE) se hace en <strong>Red ISP → Infra</strong>.
              Aquí defines qué equipo usa este abonado y cómo se conecta (IP, MAC, antena).
            </div>
          </div>
        )}

        {/* SERVICIOS */}
        {activeTab === 'services' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-gray-500">Gestiona planes, provisión MikroTik y conectividad del abonado</p>
              <button onClick={() => setShowServiceForm(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2">
                <Plus className="h-4 w-4" /> Nuevo servicio
              </button>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100">
              {services.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <Wifi className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p className="font-medium">Sin servicios asignados</p>
                  <button onClick={() => setShowServiceForm(true)} className="mt-3 text-blue-600 text-sm hover:underline">+ Crear primer servicio</button>
                </div>
              ) : (
                <div className="divide-y">
                  {services.map(s => (
                    <div key={s.id} className="p-6">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="font-bold text-lg text-gray-900">{s.plan?.name}</h3>
                          <p className="text-gray-500">${Number(s.plan?.price || 0).toLocaleString('es-CL')}/mes</p>
                          <p className="text-xs text-gray-400 mt-1">Servicio #{s.id}</p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColor[s.status] || 'bg-gray-100'}`}>
                          {statusLabel[s.status] || s.status}
                        </span>
                      </div>

                      {(s.queueName || s.networkMeta?.maxLimit || s.plan) && (
                        <div className="mb-4 max-w-md">
                          <SubscriberQueueCard
                            name={s.queueName || client?.user?.fullName || client?.fullName || 'Abonado'}
                            target={s.ipAddress}
                            maxLimit={s.networkMeta?.maxLimit || (s.plan ? `${s.plan.uploadSpeed}M/${s.plan.downloadSpeed}M` : undefined)}
                            comment={s.plan?.name}
                            disabled={s.status === 'suspended' || s.status === 'cut'}
                          />
                        </div>
                      )}

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm bg-gray-50 rounded-lg p-4">
                      <div><p className="text-gray-400 text-xs mb-1">Instalación</p><p className="font-medium">{formatDateCL(s.installationDate)}</p></div>
                      <div><p className="text-gray-400 text-xs mb-1">Próximo cobro</p><p className="font-medium">{formatDateCL(s.nextBillingDate)}</p></div>
                      <div><p className="text-gray-400 text-xs mb-1">Ciclo facturación</p><p className="font-medium text-xs">{billingCycleLabel(s.billingCycleType, s.billingDay)}</p></div>
                      <div><p className="text-gray-400 text-xs mb-1">Vencimiento pago</p><p className="font-medium">Día {s.billingDueDay ?? s.billingDay ?? '—'}</p></div>
                      <div><p className="text-gray-400 text-xs mb-1">PPPoE</p><p className="font-mono font-medium text-xs">{s.pppoeUsername || '—'}</p></div>
                      <div><p className="text-gray-400 text-xs mb-1">IP</p><p className="font-mono font-medium text-xs">{s.ipAddress || '—'}</p></div>
                      <div><p className="text-gray-400 text-xs mb-1">Router</p><p className="font-medium text-xs">{s.routerId ? `#${s.routerId}` : '—'}</p></div>
                      <div><p className="text-gray-400 text-xs mb-1">Velocidad en router</p><p className="font-medium text-xs">{formatQueueSpeedLabel(s.networkMeta?.maxLimit || (s.plan ? `${s.plan.uploadSpeed}M/${s.plan.downloadSpeed}M` : undefined))}</p></div>
                    </div>
                      {clientEquipment.length > 0 && (
                        <div className="mt-3 p-3 bg-orange-50 border border-orange-100 rounded-lg">
                          <p className="text-xs font-semibold text-orange-800 mb-2">Equipos vinculados</p>
                          <div className="space-y-1">
                            {clientEquipment.map((eq) => (
                              <div key={eq.id} className="flex items-center gap-2 text-xs text-gray-700">
                                <span className={`w-2 h-2 rounded-full ${eq.status === 'online' ? 'bg-green-500' : 'bg-red-400'}`} />
                                <span className="font-medium">{eq.name}</span>
                                <span className="text-gray-400">· {eq.ipAddress || 'sin IP'}</span>
                                <button onClick={() => setActiveTab('equipment')} className="ml-auto text-blue-600 hover:underline">Ver</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {(!s.pppoeUsername || !s.queueName) && (
                        <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-100">
                          <p className="text-sm font-medium text-blue-800 mb-2 flex items-center gap-2">
                            <Zap className="h-4 w-4" /> Provisionar en MikroTik
                            {s.queueName && !s.pppoeUsername && <span className="text-xs font-normal text-blue-600">(falta PPPoE)</span>}
                            {s.pppoeUsername && !s.queueName && <span className="text-xs font-normal text-blue-600">(falta cola)</span>}
                          </p>
                          <div className="flex gap-2 flex-wrap items-center">
                            <select className="border rounded-lg px-3 py-2 text-sm bg-white min-w-[160px]"
                              value={provisionRouterId || s.routerId || ''} onChange={e => {
                                const id = parseInt(e.target.value) || null
                                setProvisionRouterId(id)
                                const r = routers.find((x) => x.id === id)
                                if (r) {
                                  setRouterCredForm({
                                    routerUser: r.credentials?.routerUser || 'admin',
                                    routerPass: r.credentials?.routerPass || '',
                                    tunnelHostname: r.credentials?.tunnelHostname || r.ipAddress || '',
                                  })
                                  setProvisionPppProfile(s.pppProfile || 'default')
                                  loadPppProfiles(id!)
                                }
                              }}>
                              <option value="">Router...</option>
                              {routers.map(r => (
                                <option key={r.id} value={r.id}>
                                  {r.name} {r.agentConnected ? '●' : '○'}{!r.hasApiCredentials ? ' ⚠ sin API' : ''}
                                </option>
                              ))}
                            </select>
                            <select className="border rounded-lg px-3 py-2 text-sm bg-white min-w-[200px]" value={provisionMode}
                              onChange={e => setProvisionMode(e.target.value)}>
                              <option value="both">PPPoE + Simple Queue</option>
                              <option value="pppoe">Solo PPPoE</option>
                              <option value="queue">Solo Simple Queue</option>
                              <option value="static">IP estática + cola + DHCP lease</option>
                            </select>
                            {pppProfiles.length > 0 && (provisionMode === 'both' || provisionMode === 'pppoe') && (
                              <select className="border rounded-lg px-3 py-2 text-sm bg-white min-w-[140px]"
                                value={provisionPppProfile}
                                onChange={e => setProvisionPppProfile(e.target.value)}>
                                {pppProfiles.map((p: any) => (
                                  <option key={p.name} value={p.name}>{p.name}</option>
                                ))}
                              </select>
                            )}
                            <button disabled={provisioning || savingRouterCred} onClick={() => provisionNetwork(s.id, s.routerId)}
                              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                              <Router className="h-4 w-4" /> {provisioning ? 'Provisionando...' : savingRouterCred ? 'Guardando API...' : (s.queueName || s.pppoeUsername ? 'Actualizar en router' : 'Aplicar en router')}
                            </button>
                          </div>
                          {provisionRouterId && !routers.find(r => r.id === (provisionRouterId || s.routerId))?.hasApiCredentials && (
                            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg grid grid-cols-1 md:grid-cols-3 gap-2">
                              <p className="md:col-span-3 text-xs text-amber-800">
                                Este router no tiene credenciales API. Ingresa el usuario/contraseña de Winbox (REST habilitado en puerto 443).
                              </p>
                              <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Host túnel"
                                value={routerCredForm.tunnelHostname || ''}
                                onChange={e => setRouterCredForm({ ...routerCredForm, tunnelHostname: e.target.value })} />
                              <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Usuario API"
                                value={routerCredForm.routerUser || ''}
                                onChange={e => setRouterCredForm({ ...routerCredForm, routerUser: e.target.value })} />
                              <input type="password" className="border rounded-lg px-3 py-2 text-sm" placeholder="Contraseña API"
                                value={routerCredForm.routerPass || ''}
                                onChange={e => setRouterCredForm({ ...routerCredForm, routerPass: e.target.value })} />
                            </div>
                          )}
                        </div>
                      )}
                    <div className="flex gap-2 mt-4 flex-wrap">
                      <button onClick={() => generateInvoice(s.id)} disabled={generatingInvoice === s.id || s.status !== 'active'}
                        className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50">
                        <DollarSign className="h-4 w-4" /> {generatingInvoice === s.id ? 'Generando...' : 'Generar factura'}
                      </button>
                      <button onClick={() => toggleService(s.id, s.status)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${s.status === 'active' ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
                          {s.status === 'active' ? <><PowerOff className="h-4 w-4" /> Suspender</> : <><Power className="h-4 w-4" /> Reactivar</>}
                        </button>
                        <button onClick={() => deleteService(s.id, s.plan?.name || 'servicio')}
                          className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 bg-red-50 text-red-700 hover:bg-red-100">
                          <Trash2 className="h-4 w-4" /> Eliminar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* FACTURAS */}
        {activeTab === 'invoices' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100">
            {invoices.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <DollarSign className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="font-medium">Sin facturas registradas</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    {['Nº Factura', 'Período', 'Neto', 'IVA', 'Total', 'Vencimiento', 'Estado', 'Acción'].map(h => (
                      <th key={h} className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoices.map(inv => (
                    <tr key={inv.id} className="hover:bg-gray-50">
                      <td className="p-4 font-mono text-sm text-blue-600 font-medium">{inv.invoiceNumber}</td>
                      <td className="p-4 text-sm">{inv.billingPeriod || '—'}</td>
                      <td className="p-4 text-sm">${Number(inv.amount).toLocaleString('es-CL')}</td>
                      <td className="p-4 text-sm">${Number(inv.tax).toLocaleString('es-CL')}</td>
                      <td className="p-4 font-bold">${Number(inv.total).toLocaleString('es-CL')}</td>
                      <td className="p-4 text-sm text-gray-500">{formatDateCL(inv.dueDate)}</td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[inv.status] || 'bg-gray-100'}`}>
                          {statusLabel[inv.status] || inv.status}
                        </span>
                      </td>
                      <td className="p-4">
                        {(inv.status === 'pending' || inv.status === 'overdue') && (
                          <button onClick={() => setShowPayModal(inv)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700">
                            Registrar pago
                          </button>
                        )}
                        {inv.status === 'paid' && <span className="text-green-600 text-xs flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> Pagada</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t">
                  <tr>
                    <td colSpan={4} className="p-4 text-sm font-semibold text-gray-700">Total pendiente</td>
                    <td className="p-4 font-bold text-red-600">${totalDeuda.toLocaleString('es-CL')}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        )}

        {/* TICKETS */}
        {activeTab === 'tickets' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100">
            {tickets.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Ticket className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="font-medium">Sin tickets registrados</p>
              </div>
            ) : (
              <div className="divide-y">
                {tickets.map(t => (
                  <div key={t.id} className="p-6 hover:bg-gray-50">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold text-gray-900">{t.subject}</p>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[t.priority] || 'bg-gray-100'}`}>{statusLabel[t.priority] || t.priority}</span>
                        </div>
                        <p className="text-sm text-gray-500 mb-2">{t.description}</p>
                        <div className="flex items-center gap-4 text-xs text-gray-400">
                          <span className="font-mono">{t.ticketNumber}</span>
                          <span>{t.category || 'Sin categoría'}</span>
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(t.createdAt).toLocaleDateString('es-CL')}</span>
                        </div>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ml-4 ${statusColor[t.status] || 'bg-gray-100'}`}>
                        {statusLabel[t.status] || t.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}