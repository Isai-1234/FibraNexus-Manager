import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, User, Wifi, DollarSign, Ticket, X, CheckCircle, Clock, Phone, Mail, MapPin, CreditCard, Plus, Power, PowerOff, Router, Zap, Trash2, Antenna, Pencil, Search, Send, MessageSquare } from 'lucide-react'
import axios from 'axios'
import { formatDateCL, todayISO } from '../../lib/formatDate'
import { formatQueueSpeedLabel } from '../../lib/bandwidth'
import SubscriberQueueCard from '../../components/SubscriberQueueCard'
import NetworkSuspendStatus, { suspendToastMessage } from '../../components/NetworkSuspendStatus'
import CpeLinkVisualizer, { computeLinkScore, linkTheme } from '../../components/CpeLinkVisualizer'
import DeviceIpLink from '../../components/DeviceIpLink'

interface Props {
  clientId: number
  API: string
  onBack: () => void
  initialTab?: string
}

const OPEN_TICKET_STATUSES = ['open', 'in_progress', 'waiting_client']

function isOpenTicket(status: string) {
  return OPEN_TICKET_STATUSES.includes(status)
}

function filterByClientId(items: any[], id: number) {
  return items.filter((row) =>
    Number(row.clientId) === Number(id) || Number(row.client?.id) === Number(id))
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

function apiErrorMessage(e: any, fallback: string) {
  const raw = e.response?.data?.error || e.message || fallback
  return String(raw).replace(/^Error al eliminar servicio:\s*/i, '')
}

export default function ClientDetail({ clientId, API, onBack, initialTab = 'overview' }: Props) {
  const [client, setClient] = useState<any>(null)
  const [services, setServices] = useState<any[]>([])
  const [invoices, setInvoices] = useState<any[]>([])
  const [tickets, setTickets] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState(initialTab)
  const [showPayModal, setShowPayModal] = useState<any>(null)
  const [payMethod, setPayMethod] = useState('transfer')
  const [payEmitirDte, setPayEmitirDte] = useState(false)
  const [savingDteFlag, setSavingDteFlag] = useState(false)
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
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null)
  const [ticketDetail, setTicketDetail] = useState<any>(null)
  const [replyText, setReplyText] = useState('')
  const [ticketLoading, setTicketLoading] = useState(false)
  const [sendingReply, setSendingReply] = useState(false)
  const [linkFullscreen, setLinkFullscreen] = useState(false)
  const [snmpRefreshing, setSnmpRefreshing] = useState(false)
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: 'error' | 'success' | 'warning' | 'info' }[]>([])
  const toastId = useRef(0)
  const [expandedMetricsId, setExpandedMetricsId] = useState<number | null>(null)
  const [metricsData, setMetricsData] = useState<Record<number, any[]>>({})

  function toast(msg: string, type: 'error' | 'success' | 'warning' | 'info' = 'info') {
    const id = ++toastId.current
    setToasts((prev) => [...prev, { id, msg, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000)
  }

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

  async function loadClientEquipment(options: { quick?: boolean } = {}) {
    try {
      const qs = options.quick ? '?quick=1' : ''
      const res = await api().get(`/clients/${clientId}/equipment${qs}`)
      setClientEquipment(Array.isArray(res.data) ? res.data : [])
    } catch {
      setClientEquipment([])
    }
  }

  async function pollEquipmentUntilFresh(maxAttempts = 12, intervalMs = 1500) {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise<void>((r) => setTimeout(r, intervalMs))
      const res = await api().get(`/clients/${clientId}/equipment?quick=1`)
      const items: any[] = Array.isArray(res.data) ? res.data : []
      setClientEquipment(items)
      if (!items.some((e: any) => e.isStale)) break
    }
  }

  async function startBackgroundSnmpRefresh() {
    try {
      await api().post(`/clients/${clientId}/equipment/refresh`)
      await pollEquipmentUntilFresh()
    } catch {
      // refresh en background — sin toast
    }
  }

  async function refreshSnmpPoll() {
    if (!clientEquipment.length) return
    setSnmpRefreshing(true)
    try {
      await api().post(`/clients/${clientId}/equipment/refresh`)
      await pollEquipmentUntilFresh(10, 2000)
    } catch (err: any) {
      toast(err.response?.data?.error || 'No se pudo iniciar actualización SNMP', 'error')
    }
    setSnmpRefreshing(false)
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
      setServices(filterByClientId(Array.isArray(sRes.data) ? sRes.data : [], clientId))
      setInvoices(filterByClientId(Array.isArray(iRes.data) ? iRes.data : [], clientId))
      setTickets(filterByClientId(Array.isArray(tRes.data) ? tRes.data : [], clientId))
      await loadClientEquipment({ quick: true })
      void startBackgroundSnmpRefresh()

      const clientServices = (Array.isArray(sRes.data) ? sRes.data : []).filter((s: any) =>
        Number(s.client?.id) === Number(clientId) || Number(s.clientId) === Number(clientId))
      const activeWithQueue = clientServices.find((s: any) => s.status === 'active' && s.queueName && s.routerId)
      if (activeWithQueue) {
        api().post(`/services/${activeWithQueue.id}/sync-queue`).catch(() => {})
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [clientId])

  useEffect(() => {
    const hasPendingNetwork = services.some((s) => {
      const st = s.networkMeta?.suspendState?.status
      return st === 'pending' || st === 'removing'
    })
    if (!hasPendingNetwork) return
    const timer = window.setInterval(() => { loadAll() }, 15000)
    return () => window.clearInterval(timer)
  }, [services, clientId])

  useEffect(() => {
    setActiveTab(initialTab)
  }, [clientId, initialTab])

  async function loadTicketDetail(ticketId: number) {
    setSelectedTicketId(ticketId)
    setTicketLoading(true)
    setReplyText('')
    try {
      const res = await api().get(`/tickets/${ticketId}`)
      setTicketDetail(res.data)
    } catch {
      setTicketDetail(null)
    }
    setTicketLoading(false)
  }

  async function sendTicketReply(e?: React.FormEvent) {
    e?.preventDefault()
    if (!selectedTicketId || !replyText.trim()) return
    setSendingReply(true)
    try {
      const res = await api().post(`/tickets/${selectedTicketId}/messages`, {
        message: replyText.trim(),
        isInternal: false,
      })
      setTicketDetail(res.data)
      setReplyText('')
      setTickets((prev) => prev.map((t) => t.id === res.data.id ? { ...t, status: res.data.status } : t))
    } catch (err: any) {
      toast(err.response?.data?.error || 'Error al enviar respuesta', 'error')
    }
    setSendingReply(false)
  }

  async function changeTicketStatus(status: string) {
    if (!selectedTicketId) return
    setTicketLoading(true)
    try {
      const res = await api().patch(`/tickets/${selectedTicketId}`, { status })
      setTicketDetail(res.data)
      setTickets((prev) => prev.map((t) => t.id === res.data.id ? { ...t, status: res.data.status } : t))
    } catch (err: any) {
      toast(err.response?.data?.error || 'Error al actualizar estado', 'error')
    }
    setTicketLoading(false)
  }

  async function provisionNetwork(serviceId: number, serviceRouterId?: number | null) {
    const routerId = provisionRouterId || serviceRouterId || null
    if (!routerId) {
      toast('Selecciona un router MikroTik', 'warning')
      return
    }
    const router = routers.find((r) => r.id === routerId)
    if (router && !router.hasApiCredentials) {
      if (!routerCredForm.routerUser || !routerCredForm.routerPass) {
        toast('Configura usuario y contraseña API del router antes de provisionar', 'warning')
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
        toast('Error al guardar credenciales: ' + (e.response?.data?.error || e.message), 'error')
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
      toast('Provisionado en router: ' + parts.join(' · '), 'success')
    } catch (e: any) {
      toast('Error al provisionar: ' + (e.response?.data?.error || e.message), 'error')
    }
    setProvisioning(false)
  }

  async function createService() {
    if (!serviceForm.planId) {
      toast('Selecciona un plan comercial', 'warning')
      return
    }
    if (serviceForm.provisionOnCreate && !serviceForm.routerId) {
      toast('Selecciona el router donde provisionar, o desmarca "Provisionar en router"', 'warning')
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
      if (res.data.invoiceWarning) toast('Servicio creado. Factura: ' + res.data.invoiceWarning, 'warning')
      else if (res.data.firstInvoice) {
        toast(`Servicio creado · Factura ${res.data.firstInvoice.invoiceNumber} por $${Number(res.data.firstInvoice.total).toLocaleString('es-CL')}`, 'success')
      } else if (res.data.networkWarning) {
        toast('Servicio creado con advertencia: ' + res.data.networkWarning, 'warning')
      } else if (res.data.network) {
        const n = res.data.network
        const parts = ['Servicio creado.']
        if (n.username) parts.push(`PPPoE: ${n.username}`)
        if (n.queueName) parts.push(`Cola: ${n.queueName}`)
        toast(parts.join(' · '), 'success')
      }
      setShowServiceForm(false)
      setServiceForm(defaultServiceForm())
      if (serviceForm.equipmentId) {
        await api().patch(`/sites/equipment/${serviceForm.equipmentId}`, { clientId }).catch(() => {})
      }
      loadAll()
    } catch (e: any) {
      toast('Error al crear servicio: ' + (e.response?.data?.error || e.message), 'error')
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
      toast(res.data.message + ` · Total: $${Number(res.data.total).toLocaleString('es-CL')}`, 'success')
      loadAll()
    } catch (e: any) {
      toast('Error al generar factura: ' + (e.response?.data?.error || e.message), 'error')
    }
    setGeneratingInvoice(null)
  }

  function billingCycleLabel(type: string, billingDay?: number) {
    if (type === 'calendar_prorate') return 'Proporcional (instalación → fin de mes)'
    return billingDay ? `Aniversario (día ${billingDay} al ${billingDay})` : 'Aniversario (día a día)'
  }

  async function deleteService(serviceId: number, planName: string) {
    if (!confirm(`¿Eliminar el servicio "${planName}"?\n\nEl abonado conserva su cuenta. Las facturas pendientes de este servicio se borrarán; las pagadas quedan en el historial.`)) return
    try {
      const res = await api().delete(`/services/${serviceId}`)
      const n = res.data?.deletedInvoices
      toast(n ? `Servicio eliminado (${n} factura${n !== 1 ? 's' : ''} pendiente${n !== 1 ? 's' : ''} borrada${n !== 1 ? 's' : ''})` : 'Servicio eliminado', 'success')
      loadAll()
    } catch (e: any) {
      toast(apiErrorMessage(e, 'No se pudo eliminar el servicio'), 'error')
    }
  }

  async function toggleService(serviceId: number, currentStatus: string) {
    try {
      const action = currentStatus === 'active' ? 'suspend' : 'reactivate'
      const res = await api().put(`/services/${serviceId}/${action}`)
      const net = res.data.network
      const toastMsg = suspendToastMessage(net, action as 'suspend' | 'reactivate')
      if (toastMsg) toast(toastMsg.text, toastMsg.type)
      else if (net?.error) toast('Servicio actualizado pero red: ' + net.error, 'warning')
      else toast(action === 'suspend' ? 'Servicio suspendido' : 'Servicio reactivado', 'success')

      const updated = res.data.service
      if (updated) {
        setServices((prev) => prev.map((s) => {
          if (s.id !== serviceId) return s
          let suspendState = s.networkMeta?.suspendState
          if (!net?.skipped && !net?.error) {
            if (net?.queued) {
              suspendState = {
                mode: 'walled-garden',
                clientIp: net.clientIp,
                portalUrl: net.portalUrl,
                routerId: net.routerId,
                cmdId: net.cmdId,
                status: action === 'suspend' ? 'pending' : 'removing',
                queuedAt: new Date().toISOString(),
              }
            } else if (net?.success && action === 'suspend') {
              suspendState = {
                mode: 'walled-garden',
                clientIp: net.clientIp,
                portalUrl: net.portalUrl,
                routerId: net.routerId ?? s.routerId,
                status: 'active',
                appliedAt: new Date().toISOString(),
              }
            } else if (net?.success && action === 'reactivate') {
              suspendState = undefined
            }
          }
          return {
            ...s,
            ...updated,
            plan: s.plan,
            networkMeta: {
              ...s.networkMeta,
              suspendState,
            },
          }
        }))
      }
      loadAll()
    } catch (e: any) { toast('Error: ' + (e.response?.data?.error || e.message), 'error') }
  }

  async function payInvoice() {
    if (!showPayModal) return
    try {
      await api().post('/payments', {
        invoiceId: showPayModal.id,
        method: payMethod,
        amount: showPayModal.total,
        emitirDte: payEmitirDte,
      })
      setShowPayModal(null)
      loadAll()
    } catch (e: any) { toast('Error al registrar pago: ' + (e.response?.data?.error || e.message), 'error') }
  }

  async function toggleClientDte(next: boolean) {
    if (!client) return
    setSavingDteFlag(true)
    try {
      const res = await api().put(`/clients/${clientId}`, { dteHabilitado: next })
      setClient((c: any) => ({ ...c, dteHabilitado: res.data.dteHabilitado ?? next }))
      toast(next ? 'Facturación electrónica habilitada para este cliente' : 'Facturación electrónica deshabilitada', 'success')
    } catch (e: any) {
      toast('Error: ' + (e.response?.data?.error || e.message), 'error')
    }
    setSavingDteFlag(false)
  }

  function openPayModal(inv: any) {
    setPayMethod('transfer')
    setPayEmitirDte(Boolean(client?.dteHabilitado))
    setShowPayModal(inv)
  }

  async function suggestFreeIp(target: 'create' | 'edit' | 'service', siteId?: number) {
    const sid = siteId || (target === 'edit' ? editingEquip?.siteId : equipForm.siteId || serviceForm.siteId)
    if (!sid) {
      toast('Selecciona un nodo primero', 'warning')
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
      toast(e.response?.data?.error || e.message, 'error')
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

  async function resolveDynamicIp(target: 'create' | 'edit') {
    const form = target === 'edit' ? editEquipForm : equipForm
    const sid = target === 'edit' ? (editEquipForm.siteId || editingEquip?.siteId) : equipForm.siteId
    const mode = form.connectionMode || 'static'

    if (mode === 'static') { suggestFreeIp(target); return }
    if (!sid) { toast('Selecciona un nodo primero', 'warning'); return }

    if (mode === 'dhcp' && !form.macAddress) {
      toast('Ingresa la MAC del equipo primero', 'warning'); return
    }
    if (mode === 'pppoe' && !form.pppoeUsername) {
      toast('Ingresa el usuario PPPoE primero', 'warning'); return
    }

    setSuggestingIp(true)
    setIpSuggestHint('')
    try {
      const params = mode === 'dhcp'
        ? `mode=dhcp&mac=${encodeURIComponent(form.macAddress)}`
        : `mode=pppoe&username=${encodeURIComponent(form.pppoeUsername)}`
      const res = await api().get(`/network/sites/${sid}/resolve-dynamic-ip?${params}`)
      if (!res.data.ip) {
        toast(
          mode === 'dhcp'
            ? 'MAC no encontrada en leases DHCP del MikroTik'
            : 'Usuario PPPoE sin sesión activa en el router',
          'warning',
        )
      } else {
        const setter = target === 'edit'
          ? (v: string) => setEditEquipForm((f: any) => ({ ...f, ipAddress: v }))
          : (v: string) => setEquipForm((f: any) => ({ ...f, ipAddress: v }))
        setter(res.data.ip)
        setIpSuggestHint(
          mode === 'dhcp'
            ? `IP ${res.data.ip} · lease ${res.data.status || 'bound'}${res.data.hostname ? ` · ${res.data.hostname}` : ''}`
            : `IP ${res.data.ip} · sesión PPPoE activa${res.data.uptime ? ` · uptime ${res.data.uptime}` : ''}`,
        )
      }
    } catch (e: any) {
      toast(e.response?.data?.error || e.message, 'error')
    }
    setSuggestingIp(false)
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
    } catch (e: any) { toast(e.response?.data?.error || e.message, 'error') }
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
      snmpCommunity: '',
      siteId: eq.siteId || '',
      connectionMode: eq.credentials?.connectionMode || 'static',
      pppoeUsername: eq.credentials?.pppoeUsername || '',
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
    } catch (e: any) { toast(e.response?.data?.error || e.message, 'error') }
  }

  async function unlinkEquipment(equipmentId: number, name: string) {
    if (!confirm(`¿Desvincular "${name}" de este abonado? El equipo sigue en el nodo.`)) return
    try {
      await api().patch(`/sites/equipment/${equipmentId}`, { clientId: null })
      await loadClientEquipment()
    } catch (e: any) { toast(e.response?.data?.error || e.message, 'error') }
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
    in_progress: 'bg-blue-100 text-blue-700', waiting_client: 'bg-amber-100 text-amber-800', closed: 'bg-surface-raised text-ink-muted',
    critical: 'bg-red-100 text-red-700', high: 'bg-orange-100 text-orange-700',
    medium: 'bg-blue-100 text-blue-700', low: 'bg-surface-raised text-ink-muted',
  }
  const statusLabel: Record<string, string> = {
    active: 'Activo', suspended: 'Suspendido', cancelled: 'Cancelado', pending: 'Pendiente',
    paid: 'Pagada', overdue: 'Vencida',     open: 'Abierto', resolved: 'Resuelto', waiting_client: 'Esperando cliente',
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
  const openTickets = tickets.filter((t) => isOpenTicket(t.status))
  const openTicketsCount = openTickets.length
  const linkScore = computeLinkScore(
    antennaOnline,
    primaryAntenna?.wirelessSignal ?? primaryAntenna?.wirelessRssi ?? null,
    primaryAntenna?.wirelessCcq,
    primaryAntenna?.wirelessSnr,
  )
  const linkThemeColors = linkTheme(linkScore, antennaOnline, (primaryAntenna?.wirelessWarnings?.length || 0) > 0)

  const statCards = [
    { label: 'Servicios', value: services.length, icon: Wifi, tab: 'services' as const, accent: 'text-cyan-400' },
    { label: 'Equipos', value: clientEquipment.length, icon: Antenna, tab: 'equipment' as const, accent: 'text-orange-400' },
    { label: 'Por cobrar', value: '$' + totalDeuda.toLocaleString('es-CL'), icon: CreditCard, tab: 'invoices' as const, accent: totalDeuda > 0 ? 'text-red-400' : 'text-ink-soft' },
    { label: 'Tickets', value: openTicketsCount > 0 ? `${openTicketsCount} abierto${openTicketsCount > 1 ? 's' : ''}` : '0', icon: Ticket, tab: 'tickets' as const, accent: openTicketsCount > 0 ? 'text-amber-400' : 'text-ink-soft' },
  ]

  async function loadMetrics(equipId: number) {
    if (metricsData[equipId]) { setExpandedMetricsId(equipId); return }
    try {
      const res = await api().get(`/devices/metrics/${equipId}?hours=24`)
      setMetricsData(prev => ({ ...prev, [equipId]: Array.isArray(res.data) ? res.data : [] }))
      setExpandedMetricsId(equipId)
    } catch { setExpandedMetricsId(equipId) }
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-surface">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-ink-muted">Cargando cliente...</p>
      </div>
    </div>
  )

  if (!client) return (
    <div className="flex-1 flex items-center justify-center bg-surface">
      <div className="text-center">
        <p className="text-ink-muted">Cliente no encontrado</p>
        <button onClick={onBack} className="mt-4 text-blue-600 hover:underline">Volver</button>
      </div>
    </div>
  )

  return (
    <div className="flex-1 overflow-auto bg-[#060a12] min-h-screen">
      {/* Pay Modal */}
      {showPayModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
            <div className="flex justify-between items-center mb-4 border-b pb-3">
              <h3 className="font-bold text-lg">Registrar pago</h3>
              <button onClick={() => setShowPayModal(null)}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="bg-surface rounded-lg p-4">
                <p className="text-sm text-ink-muted">Factura</p>
                <p className="font-bold text-lg">{showPayModal.invoiceNumber}</p>
                <p className="text-2xl font-bold text-blue-600 mt-1">${Number(showPayModal.total).toLocaleString('es-CL')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">Método de pago</label>
                <select className="w-full border rounded-lg px-3 py-2" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                  <option value="transfer">Transferencia bancaria</option>
                  <option value="cash">Efectivo</option>
                  <option value="card">Tarjeta</option>
                  <option value="flow">Flow</option>
                  <option value="other">Otro</option>
                </select>
              </div>
              <label className="flex items-start gap-3 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  className="mt-1 rounded"
                  checked={payEmitirDte}
                  onChange={(e) => setPayEmitirDte(e.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium text-ink">¿Generar factura electrónica?</span>
                  <span className="block text-xs text-ink-muted mt-0.5">
                    Override de este pago (no cambia el default del cliente). Default: {client?.dteHabilitado ? 'Sí' : 'No'}.
                    Pagos Flow con delegación SII activa no emiten DTE aquí.
                  </span>
                </span>
              </label>
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t">
              <button onClick={() => setShowPayModal(null)} className="flex-1 py-2.5 border rounded-lg hover:bg-surface-raised font-medium">Cancelar</button>
              <button onClick={payInvoice} className="flex-1 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium">Confirmar pago</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal nuevo servicio */}
      {showServiceForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4 border-b pb-3">
              <h3 className="font-bold text-lg">Nuevo servicio de internet</h3>
              <button onClick={() => setShowServiceForm(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">Plan comercial *</label>
                <select className="w-full border rounded-lg px-3 py-2 bg-surface-card" value={serviceForm.planId || ''}
                  onChange={e => setServiceForm({ ...serviceForm, planId: e.target.value })}>
                  <option value="">Seleccionar plan...</option>
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>{p.name} — {p.downloadSpeed}/{p.uploadSpeed} Mbps — ${Number(p.price).toLocaleString('es-CL')}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-ink-soft mb-1">Fecha instalación *</label>
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
                  <label className="block text-sm font-medium text-ink-soft mb-1">Ciclo de cobro</label>
                  <select className="w-full border rounded-lg px-3 py-2 bg-surface-card text-sm"
                    value={serviceForm.billingCycleType || 'anniversary'}
                    onChange={e => setServiceForm({ ...serviceForm, billingCycleType: e.target.value })}>
                    <option value="anniversary">Aniversario (12 al 12, 16 al 16…)</option>
                    <option value="calendar_prorate">Proporcional (instalación → fin de mes)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">
                  Día de vencimiento del pago
                </label>
                <select className="w-full border rounded-lg px-3 py-2 bg-surface-card text-sm"
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
                <p className="text-xs text-ink-muted mt-1">
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
                  <label className="block text-sm font-medium text-ink-soft mb-1">Nodo / torre</label>
                  <select className="w-full border rounded-lg px-3 py-2 bg-surface-card text-sm" value={serviceForm.siteId || ''}
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
                  <label className="block text-sm font-medium text-ink-soft mb-1">Antena / equipo del abonado</label>
                  <select className="w-full border rounded-lg px-3 py-2 bg-surface-card text-sm" value={serviceForm.equipmentId || ''}
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
                    <label className="block text-sm font-medium text-ink-soft mb-1">IP</label>
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
                    <label className="block text-sm font-medium text-ink-soft mb-1">MAC antena</label>
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
                      <label className="block text-sm font-medium text-ink-soft mb-1">Router del nodo *</label>
                      <select className="w-full border rounded-lg px-3 py-2 bg-surface-card" value={serviceForm.routerId || ''}
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
                      <label className="block text-sm font-medium text-ink-soft mb-1">Modo de conexión</label>
                      <select className="w-full border rounded-lg px-3 py-2 bg-surface-card" value={serviceForm.provisionMode || 'both'}
                        onChange={e => setServiceForm({ ...serviceForm, provisionMode: e.target.value })}>
                        <option value="both">PPPoE + Simple Queue (WISP con autenticación)</option>
                        <option value="pppoe">Solo PPPoE</option>
                        <option value="queue">Solo Simple Queue (IP fija, sin PPPoE)</option>
                        <option value="static">IP estática + cola + lease DHCP en MikroTik</option>
                      </select>
                      <p className="text-xs text-ink-muted mt-1">
                        <strong>DHCP dinámico:</strong> usa PPPoE o IP estática + lease. <strong>IP fija WISP:</strong> modo cola o estática + lease con MAC de la antena.
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t">
              <button onClick={() => setShowServiceForm(false)} className="flex-1 py-2.5 border rounded-lg hover:bg-surface-raised font-medium">Cancelar</button>
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
          <div className="bg-surface-card rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4 border-b pb-3">
              <h3 className="font-bold text-lg">Agregar equipo al abonado</h3>
              <button onClick={() => { setShowEquipForm(false); setIpSuggestHint('') }}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Tipo</label>
                <select className="w-full border rounded-lg px-3 py-2 bg-surface-card" value={equipForm.type || 'cpe'}
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
                <select className="w-full border rounded-lg px-3 py-2 bg-surface-card" value={equipForm.siteId || ''}
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
                    onClick={() => resolveDynamicIp('create')}
                    className="px-3 py-2 border rounded-lg text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                    title={equipForm.connectionMode === 'dhcp' ? 'Buscar IP por MAC en MikroTik' : equipForm.connectionMode === 'pppoe' ? 'Buscar IP por usuario PPPoE' : 'Sugerir IP libre del pool'}>
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
                  <div>
                    <label className="block text-sm font-medium mb-1">Modo de conexión IP</label>
                    <select className="w-full border rounded-lg px-3 py-2 bg-surface-card text-sm"
                      value={equipForm.connectionMode || 'static'}
                      onChange={e => setEquipForm({ ...equipForm, connectionMode: e.target.value })}>
                      <option value="static">Estática (default)</option>
                      <option value="dhcp">DHCP dinámico (por MAC)</option>
                      <option value="pppoe">PPPoE (por usuario)</option>
                    </select>
                  </div>
                  {equipForm.connectionMode === 'pppoe' && (
                    <div>
                      <label className="block text-sm font-medium mb-1">Usuario PPPoE</label>
                      <input className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                        placeholder="cliente01@isp"
                        value={equipForm.pppoeUsername || ''} onChange={e => setEquipForm({ ...equipForm, pppoeUsername: e.target.value })} />
                    </div>
                  )}
                  {(equipForm.connectionMode === 'dhcp' || equipForm.connectionMode === 'pppoe') && (
                    <p className="text-xs text-blue-700 bg-blue-50 rounded px-3 py-2">
                      IP dinámica — el sistema la resuelve automáticamente desde el router MikroTik del nodo cada 90 s.
                    </p>
                  )}
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
          <div className="bg-surface-card rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
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
                <select className="w-full border rounded-lg px-3 py-2 bg-surface-card" value={editEquipForm.siteId || ''}
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
                  <button type="button" disabled={suggestingIp} onClick={() => resolveDynamicIp('edit')}
                    className="px-3 py-2 border rounded-lg text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                    title={editEquipForm.connectionMode === 'dhcp' ? 'Buscar IP por MAC en MikroTik' : editEquipForm.connectionMode === 'pppoe' ? 'Buscar IP por usuario PPPoE' : 'Sugerir IP libre del pool'}>
                    <Search className="h-4 w-4" />
                  </button>
                </div>
                {ipSuggestHint && <p className="text-xs text-emerald-700 mt-1">{ipSuggestHint}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">MAC</label>
                <input className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                  placeholder="AA:BB:CC:DD:EE:FF"
                  value={editEquipForm.macAddress || ''} onChange={e => setEditEquipForm({ ...editEquipForm, macAddress: e.target.value })} />
                <p className="text-xs text-ink-muted mt-1">
                  {editEquipForm.connectionMode === 'dhcp'
                    ? 'Modo DHCP: ingresa la MAC y usa la lupa para buscar la IP activa en el MikroTik.'
                    : editEquipForm.connectionMode === 'pppoe'
                      ? 'Modo PPPoE: la IP se obtiene por usuario PPPoE. La MAC es opcional.'
                      : 'Modo estático: la lupa sugiere la próxima IP libre del pool del nodo.'}
                </p>
              </div>
              {editEquipForm.type === 'cpe' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">SNMP</label>
                    <input className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                      value={editEquipForm.snmpCommunity || ''} onChange={e => setEditEquipForm({ ...editEquipForm, snmpCommunity: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Modo de conexión IP</label>
                    <select className="w-full border rounded-lg px-3 py-2 bg-surface-card text-sm"
                      value={editEquipForm.connectionMode || 'static'}
                      onChange={e => setEditEquipForm({ ...editEquipForm, connectionMode: e.target.value })}>
                      <option value="static">Estática (default)</option>
                      <option value="dhcp">DHCP dinámico (por MAC)</option>
                      <option value="pppoe">PPPoE (por usuario)</option>
                    </select>
                  </div>
                  {editEquipForm.connectionMode === 'pppoe' && (
                    <div>
                      <label className="block text-sm font-medium mb-1">Usuario PPPoE</label>
                      <input className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                        placeholder="cliente01@isp"
                        value={editEquipForm.pppoeUsername || ''} onChange={e => setEditEquipForm({ ...editEquipForm, pppoeUsername: e.target.value })} />
                    </div>
                  )}
                  {editingEquip?.credentials?.resolvedIp && (
                    <div className="text-xs text-emerald-700 bg-emerald-50 rounded px-3 py-2">
                      IP resuelta: <span className="font-mono font-semibold">{editingEquip.credentials.resolvedIp}</span>
                      {editingEquip.credentials.resolvedAt && (
                        <span className="text-ink-muted ml-2">({new Date(editingEquip.credentials.resolvedAt).toLocaleTimeString('es-CL')})</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t">
              <button onClick={() => { setEditingEquip(null); setIpSuggestHint('') }} className="flex-1 py-2.5 border rounded-lg">Cancelar</button>
              <button onClick={saveEditEquip} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Header perfil — mission control */}
      <header className="relative sticky top-0 z-20 border-b border-white/[0.06] bg-[#060a12]/90 backdrop-blur-xl">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_20%_0%,rgba(34,211,238,0.08),transparent)] pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-6 sm:px-8 py-5 flex flex-col lg:flex-row lg:items-center gap-5">
          <button onClick={onBack} className="p-2.5 rounded-xl bg-surface-card/[0.04] border border-white/[0.08] text-ink-muted hover:text-white hover:border-white/20 transition self-start">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-indigo-600/20 border border-white/10 flex items-center justify-center text-xl font-bold text-white shrink-0">
              {client.user?.fullName?.charAt(0) || '?'}
              {primaryAntenna && (
                <span className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-[#060a12] ${antennaOnline ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-red-500'}`} />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.2em] text-ink-muted font-medium">Centro del abonado</p>
              <h1 className="text-xl sm:text-2xl font-bold text-white truncate tracking-tight">{client.user?.fullName}</h1>
              <p className="text-ink-muted text-sm truncate">{client.user?.email}</p>
              <p className="text-slate-600 text-xs mt-0.5">{[client.city, client.region].filter(Boolean).join(' · ') || 'Sin ubicación'}</p>
              {primaryAntenna?.siteName && (
                <p className="text-cyan-500/70 text-xs mt-1 flex items-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0" />
                  Nodo {primaryAntenna.siteName}
                  {primaryAntenna.ipAddress && (
                    <>
                      {' · '}
                      <DeviceIpLink
                        ip={primaryAntenna.ipAddress}
                        className="text-cyan-400/90 font-mono hover:underline"
                        title="Abrir interfaz web de la antena"
                      />
                    </>
                  )}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {primaryAntenna && (
              <button type="button" onClick={() => setLinkFullscreen(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition hover:scale-[1.02]"
                style={{ color: linkThemeColors.ring, borderColor: `${linkThemeColors.ring}40`, background: `${linkThemeColors.ring}12` }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: linkThemeColors.ring }} />
                Link {linkScore}
              </button>
            )}
          {totalDeuda > 0 && (
              <div className="px-3 py-1.5 rounded-full bg-red-500/10 border border-red-400/20">
                <span className="text-xs text-red-300 font-bold">${totalDeuda.toLocaleString('es-CL')}</span>
            </div>
          )}
            <span className={`px-3 py-1.5 rounded-full text-xs font-medium border ${activeService ? 'bg-emerald-500/10 text-emerald-300 border-emerald-400/20' : 'bg-surface-card/[0.04] text-ink-muted border-white/[0.08]'}`}>
              {activeService ? 'Servicio activo' : 'Sin servicio'}
          </span>
            <span className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
              !primaryAntenna ? 'bg-amber-500/10 text-amber-300 border-amber-400/20'
                : antennaOnline ? 'bg-emerald-500/10 text-emerald-300 border-emerald-400/20'
                : 'bg-red-500/10 text-red-300 border-red-400/20'
            }`}>
              {!primaryAntenna ? 'Sin antena' : antennaOnline ? 'Antena online' : 'Antena offline'}
            </span>
            {openTicketsCount > 0 && (
              <button type="button" onClick={() => setActiveTab('tickets')}
                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-200 border border-amber-400/25 hover:bg-amber-500/25 transition">
                {openTicketsCount} ticket{openTicketsCount > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="p-6 sm:p-8 max-w-6xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {statCards.map(s => (
            <button key={s.label} type="button" onClick={() => setActiveTab(s.tab)}
              className="text-left rounded-2xl p-4 bg-surface-card/[0.03] border border-white/[0.07] hover:bg-surface-card/[0.06] hover:border-white/[0.12] transition group">
              <div className="flex items-center gap-2 mb-2">
                <s.icon className={`h-4 w-4 ${s.accent} opacity-80 group-hover:opacity-100`} />
                <p className="text-[10px] uppercase tracking-wider text-ink-muted">{s.label}</p>
              </div>
              <p className={`text-xl font-bold tabular-nums ${s.accent}`}>{s.value}</p>
            </button>
          ))}
        </div>

        <div className="flex gap-1 mb-6 bg-surface-card/[0.04] border border-white/[0.06] rounded-2xl p-1 w-fit overflow-x-auto max-w-full">
          {[
            { id: 'overview', label: 'Resumen' },
            { id: 'equipment', label: `Equipos (${clientEquipment.length})` },
            { id: 'services', label: `Servicio (${services.length})` },
            { id: 'invoices', label: `Facturas (${invoices.length})` },
            { id: 'tickets', label: openTicketsCount > 0 ? `Tickets (${openTicketsCount})` : `Tickets (${tickets.length})` },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition whitespace-nowrap ${
                activeTab === tab.id ? 'bg-surface-card/[0.1] text-cyan-300 shadow-sm border border-white/[0.08]' : 'text-ink-muted hover:text-ink-soft'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {openTicketsCount > 0 && (
              <div className="md:col-span-2 p-4 bg-amber-500/10 border border-amber-400/20 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-amber-200">
                    {openTicketsCount} ticket{openTicketsCount > 1 ? 's' : ''} de soporte sin resolver
                  </p>
                  <p className="text-sm text-amber-200/70 mt-0.5">
                    {openTickets.slice(0, 2).map((t) => t.subject).join(' · ')}
                    {openTicketsCount > 2 ? ` · +${openTicketsCount - 2} más` : ''}
                  </p>
              </div>
                <button type="button" onClick={() => setActiveTab('tickets')}
                  className="px-4 py-2 bg-amber-500/80 text-white rounded-xl text-sm font-medium hover:bg-amber-500 shrink-0">
                  Ver tickets
                </button>
              </div>
            )}
            <div className="md:col-span-2 group">
              <CpeLinkVisualizer
                equipment={primaryAntenna || null}
                siteName={primaryAntenna?.siteName}
                isStale={primaryAntenna?.isStale ?? false}
                onExpand={() => setLinkFullscreen(true)}
                onRefresh={primaryAntenna ? refreshSnmpPoll : undefined}
                refreshing={snmpRefreshing}
              />
              <p className="text-center text-[10px] text-slate-600 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                Clic en ⛶ para vista inmersiva del enlace
              </p>
            </div>
            <div className="rounded-2xl bg-surface-card/[0.03] border border-white/[0.08] p-6">
              <h2 className="font-semibold text-white flex items-center gap-2 mb-4"><User className="h-4 w-4 text-cyan-400" /> Datos personales</h2>
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
                  ...(client.planNombre || client.precioEfectivo != null
                    ? [
                        { label: 'Plan (WispHub)', value: client.planNombre || '—', icon: Wifi },
                        {
                          label: 'Precio efectivo',
                          value: client.precioEfectivo != null
                            ? `$${Number(client.precioEfectivo).toLocaleString('es-CL')}`
                            : '—',
                          icon: CreditCard,
                        },
                      ]
                    : []),
                ].map(f => (
                  <div key={f.label} className="flex items-start gap-3 py-2 border-b border-white/[0.05] last:border-0">
                    <f.icon className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] uppercase tracking-wider text-slate-400">{f.label}</p>
                      <p className="text-sm text-white truncate">{f.value || '—'}</p>
                    </div>
                  </div>
                ))}
                <div className="flex items-start gap-3 py-3 border-t border-white/[0.08] mt-1">
                  <CreditCard className="h-4 w-4 text-cyan-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">Factura electrónica (SII)</p>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1 rounded"
                        checked={Boolean(client.dteHabilitado)}
                        disabled={savingDteFlag}
                        onChange={(e) => toggleClientDte(e.target.checked)}
                      />
                      <span>
                        <span className="block text-sm text-white">¿Generar factura electrónica?</span>
                        <span className="block text-xs text-slate-400 mt-0.5">
                          Pilotaje: actívalo solo en 2–3 clientes reales. El resto sigue sin DTE.
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl bg-surface-card/[0.03] border border-white/[0.08] p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="font-semibold text-white flex items-center gap-2"><Wifi className="h-4 w-4 text-emerald-400" /> Servicio actual</h2>
                  <button onClick={() => setActiveTab('services')} className="text-xs text-cyan-400/80 hover:text-cyan-300">Ver todos →</button>
                </div>
                {hasDuplicateServices && (
                  <div className="mb-4 p-3 bg-amber-500/10 border border-amber-400/20 rounded-xl text-sm text-amber-200">
                    Hay {services.length} suscripciones — probable duplicado. Elimina una (deja solo una activa por plan).
                  </div>
                )}
                {services.length === 0 ? (
                  <div className="text-center py-6 text-ink-muted">
                    {(client.planNombre || client.precioEfectivo != null) ? (
                      <div className="text-left space-y-2 mb-4 p-3 rounded-xl border border-white/[0.08] bg-surface-card/[0.02]">
                        <p className="text-[10px] uppercase tracking-wider text-slate-400">Snapshot WispHub (solo lectura)</p>
                        <p className="text-sm text-white font-medium">{client.planNombre || 'Plan sin nombre'}</p>
                        <p className="text-sm text-emerald-300">
                          {client.precioEfectivo != null
                            ? `$${Number(client.precioEfectivo).toLocaleString('es-CL')} / mes`
                            : 'Sin precio efectivo'}
                        </p>
                        <p className="text-xs text-slate-500">Aún no hay servicio FibraNexus vinculado — el contrato/prorrateo viene después.</p>
                      </div>
                    ) : (
                      <>
                        <Wifi className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">Sin servicios asignados</p>
                      </>
                    )}
                    <button onClick={() => setShowServiceForm(true)} className="mt-2 text-cyan-400 text-sm hover:underline">+ Crear servicio</button>
                  </div>
                ) : services.map(s => (
                  <div key={s.id} className="border border-white/[0.08] rounded-xl p-4 mb-3 last:mb-0 bg-surface-card/[0.02]">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold text-white">{s.plan?.name || 'Plan desconocido'}</p>
                        <p className="text-sm text-ink-muted">{s.plan?.downloadSpeed}/{s.plan?.uploadSpeed} Mbps · #{s.id}</p>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[s.status] || 'bg-surface-raised'}`}>
                        {statusLabel[s.status] || s.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-ink-muted mt-3">
                      <div><span className="text-slate-600">Instalación:</span> {formatDateCL(s.installationDate)}</div>
                      <div><span className="text-slate-600">Próx. cobro:</span> {formatDateCL(s.nextBillingDate)}</div>
                      <div><span className="text-slate-600">Ciclo:</span> {billingCycleLabel(s.billingCycleType, s.billingDay)}</div>
                      <div><span className="text-slate-600">Precio:</span> ${Number(s.plan?.price || 0).toLocaleString('es-CL')}</div>
                    </div>
                    <div className="flex gap-2 mt-3">
                    <button onClick={() => toggleService(s.id, s.status)}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border ${
                          s.status === 'active' ? 'border-amber-500/30 text-amber-300 hover:bg-amber-500/10' : 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10'
                        }`}>
                        {s.status === 'active' ? <><PowerOff className="h-3.5 w-3.5" /> Suspender</> : <><Power className="h-3.5 w-3.5" /> Reactivar</>}
                      </button>
                      <button onClick={() => deleteService(s.id, s.plan?.name || 'servicio')}
                        className="px-3 py-2 rounded-lg text-xs font-medium border border-red-500/30 text-red-300 hover:bg-red-500/10 flex items-center gap-1">
                        <Trash2 className="h-3.5 w-3.5" /> Eliminar
                    </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl bg-surface-card/[0.03] border border-white/[0.08] p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="font-semibold text-white flex items-center gap-2"><Antenna className="h-4 w-4 text-orange-400" /> Equipos</h2>
                  <button onClick={() => setActiveTab('equipment')} className="text-xs text-cyan-400/80 hover:text-cyan-300">Gestionar →</button>
                </div>
                {clientEquipment.length === 0 ? (
                  <div className="text-center py-4 text-ink-muted text-sm">
                    <p>Sin antenas ni dispositivos vinculados</p>
                    <button onClick={() => { setEquipForm({ type: 'cpe', brand: 'Ubiquiti' }); setShowEquipForm(true) }}
                      className="mt-2 text-cyan-400 hover:underline">+ Agregar antena</button>
                  </div>
                ) : clientEquipment.slice(0, 3).map((eq) => (
                  <div key={eq.id} className="flex items-center gap-3 py-2 border-b border-white/[0.05] last:border-0">
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${eq.status === 'online' ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-red-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{eq.name}</p>
                      <p className="text-xs text-ink-muted">{EQUIP_TYPE_LABEL[eq.type] || eq.type} · {eq.ipAddress || 'sin IP'}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${eq.status === 'online' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-surface-card/[0.05] text-ink-muted'}`}>
                      {eq.status === 'online' ? 'Online' : 'Offline'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl bg-surface-card/[0.03] border border-white/[0.08] p-6">
                <h2 className="font-semibold text-white flex items-center gap-2 mb-4"><DollarSign className="h-4 w-4 text-violet-400" /> Facturas recientes</h2>
                {invoices.length === 0 ? (
                  <div className="text-center py-4 text-ink-muted text-sm">Sin facturas</div>
                ) : invoices.slice(0, 3).map(inv => (
                  <div key={inv.id} className="flex items-center justify-between py-2 border-b border-white/[0.05] last:border-0">
                    <div>
                      <p className="text-sm font-medium text-ink">{inv.invoiceNumber}</p>
                      <p className="text-xs text-ink-muted">{formatDateCL(inv.dueDate) || inv.billingPeriod || '—'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-white">${Number(inv.total).toLocaleString('es-CL')}</p>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[inv.status] || 'bg-surface-raised'}`}>
                        {statusLabel[inv.status] || inv.status}
                      </span>
                      {(inv.status === 'pending' || inv.status === 'overdue') && (
                        <button onClick={() => openPayModal(inv)} className="px-2 py-0.5 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-500">Pagar</button>
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
            {primaryAntenna && (
              <CpeLinkVisualizer
                equipment={primaryAntenna}
                siteName={primaryAntenna.siteName}
                immersive
                isStale={primaryAntenna?.isStale ?? false}
                onExpand={() => setLinkFullscreen(true)}
                onRefresh={refreshSnmpPoll}
                refreshing={snmpRefreshing}
              />
            )}
            <div className="flex justify-between items-center flex-wrap gap-3">
              <p className="text-sm text-ink-muted">Antenas, cámaras y dispositivos del abonado vinculados a nodos de red</p>
              <button onClick={() => { setEquipForm({ type: 'cpe', brand: 'Ubiquiti' }); setShowEquipForm(true) }}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm font-medium flex items-center gap-2">
                <Plus className="h-4 w-4" /> Agregar equipo
              </button>
            </div>
            {clientEquipment.length === 0 ? (
              <div className="bg-surface-card rounded-xl border p-12 text-center text-gray-400">
                <Antenna className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="font-medium text-gray-600">Sin equipos asignados</p>
                <p className="text-sm mt-1 max-w-md mx-auto">Registra la antena Ubiquiti, cámara o router del cliente y asígnala a un nodo (ej. Torre Pangui).</p>
                <button onClick={() => { setEquipForm({ type: 'cpe', brand: 'Ubiquiti' }); setShowEquipForm(true) }}
                  className="mt-4 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium">+ Agregar antena CPE</button>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {clientEquipment.map((eq) => (
                  <div key={eq.id} className="bg-surface-card rounded-xl border p-5 hover:shadow-sm transition">
                    <div className="flex items-start gap-3">
                      <span className={`w-3 h-3 rounded-full mt-1.5 flex-shrink-0 ${eq.status === 'online' ? 'bg-green-500' : eq.status === 'offline' ? 'bg-red-500' : 'bg-gray-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <p className="font-semibold text-ink">{eq.name}</p>
                            <p className="text-xs text-ink-muted">{EQUIP_TYPE_LABEL[eq.type] || eq.type} · {eq.brand} {eq.model}</p>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${eq.status === 'online' ? 'bg-green-100 text-green-700' : 'bg-surface-raised text-gray-600'}`}>
                            {eq.status === 'online' ? 'Online' : 'Offline'}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
                          <div>
                            <span className="text-gray-400">IP:</span>{' '}
                            {eq.ipAddress ? (
                              <DeviceIpLink
                                ip={eq.ipAddress}
                                className="font-mono text-blue-600 hover:underline"
                                title="Abrir interfaz web del equipo"
                              />
                            ) : (
                              <span className="font-mono">—</span>
                            )}
                            {eq.credentials?.resolvedIp && eq.credentials.connectionMode !== 'static' && (
                              <>
                                {' '}
                                <DeviceIpLink
                                  ip={eq.credentials.resolvedIp}
                                  className="text-emerald-600 font-mono hover:underline"
                                  title="Abrir IP resuelta en el navegador"
                                />
                              </>
                            )}
                          </div>
                          <div><span className="text-gray-400">MAC:</span> <span className="font-mono">{eq.macAddress || '—'}</span></div>
                          <div className="col-span-2"><span className="text-gray-400">Nodo:</span> {eq.siteName || 'Sin nodo'} {eq.siteCity ? `· ${eq.siteCity}` : ''}</div>
                          {(eq.hasSnmpCommunity || eq.snmpCommunitySet) && <div className="col-span-2"><span className="text-gray-400">SNMP:</span> configurado</div>}
                          {eq.credentials?.lastMetrics && (
                            <div className="col-span-2">
                              <SignalBadge metrics={eq.credentials.lastMetrics} />
                            </div>
                          )}
                          {eq.credentials?.connectionMode && eq.credentials.connectionMode !== 'static' && (
                            <div className="col-span-2">
                              <span className="text-gray-400">Modo:</span>{' '}
                              <span className={`font-medium ${eq.credentials.connectionMode === 'dhcp' ? 'text-blue-600' : 'text-purple-600'}`}>
                                {eq.credentials.connectionMode === 'dhcp' ? 'DHCP dinámico' : `PPPoE · ${eq.credentials.pppoeUsername || '—'}`}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 mt-4 flex-wrap">
                          <button onClick={() => openEditEquip(eq)}
                            className="px-3 py-1.5 text-xs bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 flex items-center gap-1">
                            <Pencil className="h-3 w-3" /> Editar
                          </button>
                          {(eq.snmpCommunity || eq.hasSnmpCommunity || eq.snmpCommunitySet) && (
                            <button
                              onClick={() => expandedMetricsId === eq.id ? setExpandedMetricsId(null) : loadMetrics(eq.id)}
                              className="px-3 py-1.5 text-xs bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 flex items-center gap-1">
                              📶 {expandedMetricsId === eq.id ? 'Ocultar' : 'Ver señal 24h'}
                            </button>
                          )}
                          <button onClick={() => unlinkEquipment(eq.id, eq.name)}
                            className="px-3 py-1.5 text-xs bg-surface text-gray-600 rounded-lg hover:bg-surface-raised">
                            Desvincular
                          </button>
                        </div>
                        {expandedMetricsId === eq.id && (
                          <div className="mt-3 pt-3 border-t border-line">
                            <p className="text-xs font-medium text-ink-muted mb-2">Señal últimas 24h</p>
                            <SignalChart data={metricsData[eq.id] || []} />
                          </div>
                        )}
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
              <p className="text-sm text-ink-muted">Gestiona planes, provisión MikroTik y conectividad del abonado</p>
              <button onClick={() => setShowServiceForm(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2">
                <Plus className="h-4 w-4" /> Nuevo servicio
              </button>
            </div>
          <div className="bg-surface-card rounded-xl shadow-sm border border-line">
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
                        <h3 className="font-bold text-lg text-ink">{s.plan?.name}</h3>
                          <p className="text-ink-muted">${Number(s.plan?.price || 0).toLocaleString('es-CL')}/mes</p>
                          <p className="text-xs text-gray-400 mt-1">Servicio #{s.id}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColor[s.status] || 'bg-surface-raised'}`}>
                        {statusLabel[s.status] || s.status}
                      </span>
                      {(s.status === 'suspended' || s.status === 'cut' || s.networkMeta?.suspendState) && (
                        <NetworkSuspendStatus
                          serviceStatus={s.status}
                          suspendState={s.networkMeta?.suspendState}
                          compact
                        />
                      )}
                      </div>
                    </div>

                      {(s.status === 'suspended' || s.status === 'cut' || s.networkMeta?.suspendState) && (
                        <div className="mb-4">
                          <NetworkSuspendStatus
                            serviceStatus={s.status}
                            suspendState={s.networkMeta?.suspendState}
                          />
                        </div>
                      )}

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

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm bg-surface rounded-lg p-4">
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
                              <div key={eq.id} className="flex items-center gap-2 text-xs text-ink-soft">
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
                            <select className="border rounded-lg px-3 py-2 text-sm bg-surface-card min-w-[160px]"
                              value={provisionRouterId || s.routerId || ''} onChange={e => {
                                const id = parseInt(e.target.value) || null
                                setProvisionRouterId(id)
                                const r = routers.find((x) => x.id === id)
                                if (r) {
                                  setRouterCredForm({
                                    routerUser: r.credentials?.routerUser || 'admin',
                                    routerPass: '',
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
                            <select className="border rounded-lg px-3 py-2 text-sm bg-surface-card min-w-[200px]" value={provisionMode}
                              onChange={e => setProvisionMode(e.target.value)}>
                              <option value="both">PPPoE + Simple Queue</option>
                              <option value="pppoe">Solo PPPoE</option>
                              <option value="queue">Solo Simple Queue</option>
                              <option value="static">IP estática + cola + DHCP lease</option>
                            </select>
                            {pppProfiles.length > 0 && (provisionMode === 'both' || provisionMode === 'pppoe') && (
                              <select className="border rounded-lg px-3 py-2 text-sm bg-surface-card min-w-[140px]"
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
          <div className="bg-surface-card rounded-xl shadow-sm border border-line">
            {invoices.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <DollarSign className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="font-medium">Sin facturas registradas</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-surface border-b">
                  <tr>
                    {['Nº Factura', 'Período', 'Neto', 'IVA', 'Total', 'Vencimiento', 'Estado', 'Acción'].map(h => (
                      <th key={h} className="text-left p-4 text-xs font-semibold text-ink-muted uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoices.map(inv => (
                    <tr key={inv.id} className="hover:bg-surface-raised">
                      <td className="p-4 font-mono text-sm text-blue-600 font-medium">{inv.invoiceNumber}</td>
                      <td className="p-4 text-sm">{inv.billingPeriod || '—'}</td>
                      <td className="p-4 text-sm">${Number(inv.amount).toLocaleString('es-CL')}</td>
                      <td className="p-4 text-sm">${Number(inv.tax).toLocaleString('es-CL')}</td>
                      <td className="p-4 font-bold">${Number(inv.total).toLocaleString('es-CL')}</td>
                      <td className="p-4 text-sm text-ink-muted">{formatDateCL(inv.dueDate)}</td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[inv.status] || 'bg-surface-raised'}`}>
                          {statusLabel[inv.status] || inv.status}
                        </span>
                      </td>
                      <td className="p-4">
                        {(inv.status === 'pending' || inv.status === 'overdue') && (
                          <button onClick={() => openPayModal(inv)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700">
                            Registrar pago
                          </button>
                        )}
                        {inv.status === 'paid' && <span className="text-green-600 text-xs flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> Pagada</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-surface border-t">
                  <tr>
                    <td colSpan={4} className="p-4 text-sm font-semibold text-ink-soft">Total pendiente</td>
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
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 min-h-[480px]">
            <div className="lg:col-span-2 bg-surface-card rounded-xl shadow-sm border border-line overflow-hidden">
              <div className="p-4 border-b bg-surface">
                <h3 className="font-semibold text-ink">Tickets de {client.user?.fullName}</h3>
                <p className="text-xs text-ink-muted mt-0.5">{openTicketsCount} abiertos · visible en portal cliente</p>
              </div>
            {tickets.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Ticket className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="font-medium">Sin tickets registrados</p>
              </div>
            ) : (
                <div className="divide-y max-h-[520px] overflow-y-auto">
                {tickets.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => loadTicketDetail(t.id)}
                      className={`w-full text-left p-4 hover:bg-blue-50/50 transition ${selectedTicketId === t.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''}`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <p className="font-medium text-ink text-sm">{t.subject}</p>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${statusColor[t.status] || 'bg-surface-raised'}`}>
                          {statusLabel[t.status] || t.status}
                        </span>
                        </div>
                      <p className="text-xs text-gray-400 mt-1 font-mono">{t.ticketNumber}</p>
                    </button>
                  ))}
                        </div>
              )}
                      </div>

            <div className="lg:col-span-3 bg-surface-card rounded-xl shadow-sm border border-line flex flex-col">
              {!selectedTicketId ? (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8">
                  <MessageSquare className="h-12 w-12 mb-3 opacity-20" />
                  <p className="text-sm">Selecciona un ticket para responder o cerrar</p>
                </div>
              ) : ticketLoading && !ticketDetail ? (
                <div className="flex-1 flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
              ) : ticketDetail ? (
                <>
                  <div className="p-5 border-b">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-ink">{ticketDetail.subject}</h3>
                        <p className="text-xs text-gray-400 font-mono mt-1">{ticketDetail.ticketNumber}</p>
                        <p className="text-xs text-ink-muted mt-1">
                          Cliente: <span className="font-medium text-ink-soft">{ticketDetail.client?.fullName}</span>
                          {' · '}{ticketDetail.client?.email}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <select
                          value={ticketDetail.status}
                          onChange={(e) => changeTicketStatus(e.target.value)}
                          className="text-xs border rounded-lg px-2 py-1.5 bg-surface-card"
                        >
                          {['open', 'in_progress', 'waiting_client', 'resolved', 'closed'].map(s => (
                            <option key={s} value={s}>{statusLabel[s] || s}</option>
                          ))}
                        </select>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[ticketDetail.priority] || 'bg-surface-raised'}`}>
                          {statusLabel[ticketDetail.priority] || ticketDetail.priority}
                      </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-5 space-y-4 max-h-[340px]">
                    {(ticketDetail.messages?.length ? ticketDetail.messages : [{
                      id: 0,
                      message: ticketDetail.description,
                      authorName: ticketDetail.client?.fullName,
                      authorRole: 'client',
                      createdAt: ticketDetail.createdAt,
                      isInternal: false,
                    }]).map((msg: any) => (
                      <div key={msg.id} className={`flex ${msg.authorRole === 'client' ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-[85%] rounded-xl px-4 py-3 ${
                          msg.isInternal ? 'bg-amber-50 border border-amber-200 text-amber-900'
                            : msg.authorRole === 'client' ? 'bg-surface-raised text-gray-800'
                            : 'bg-blue-600 text-white'
                        }`}>
                          <p className="text-xs font-semibold mb-1 opacity-80">
                            {msg.authorName || 'Usuario'} {msg.isInternal ? '(interno)' : ''}
                          </p>
                          <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                          <p className="text-[10px] opacity-60 mt-2">{new Date(msg.createdAt).toLocaleString('es-CL')}</p>
                    </div>
                  </div>
                ))}
              </div>

                  {!['closed', 'resolved'].includes(ticketDetail.status) && (
                    <form onSubmit={sendTicketReply} className="p-4 border-t bg-surface">
                      <label className="text-xs font-medium text-gray-600 mb-2 block">
                        Respuesta al cliente (visible en su portal)
                      </label>
                      <div className="flex gap-2">
                        <textarea
                          className="flex-1 border rounded-lg px-3 py-2 text-sm min-h-[72px] resize-none"
                          placeholder="Escribe la respuesta o instrucciones..."
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          required
                        />
                        <button
                          type="submit"
                          disabled={sendingReply || !replyText.trim()}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 self-end flex items-center gap-2 text-sm font-medium"
                        >
                          <Send className="h-4 w-4" /> Enviar
                        </button>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button type="button" onClick={() => changeTicketStatus('waiting_client')}
                          className="text-xs px-3 py-1.5 border rounded-lg hover:bg-surface-card">
                          Marcar: esperando cliente
                        </button>
                        <button type="button" onClick={() => changeTicketStatus('resolved')}
                          className="text-xs px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100">
                          Resolver y cerrar
                        </button>
                      </div>
                    </form>
                  )}
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* Vista inmersiva del enlace */}
      {linkFullscreen && (
        <div className="fixed inset-0 z-[100] bg-[#020408]/95 backdrop-blur-md flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
            <div>
              <p className="text-[10px] uppercase tracking-[0.25em] text-cyan-500/60">Monitor de enlace</p>
              <h2 className="text-lg font-semibold text-white">{client.user?.fullName} · {primaryAntenna?.name || 'CPE'}</h2>
            </div>
            <button
              type="button"
              onClick={() => setLinkFullscreen(false)}
              className="p-2.5 rounded-xl bg-surface-card/[0.05] border border-white/[0.1] text-ink-muted hover:text-white transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 sm:p-8 overflow-auto">
            <div className="w-full max-w-5xl">
              <CpeLinkVisualizer
                equipment={primaryAntenna || null}
                siteName={primaryAntenna?.siteName}
                immersive
                isStale={primaryAntenna?.isStale ?? false}
                onRefresh={primaryAntenna ? refreshSnmpPoll : undefined}
                refreshing={snmpRefreshing}
              />
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
          {toasts.map((t) => (
            <div key={t.id} className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border backdrop-blur-sm max-w-sm pointer-events-auto ${
              t.type === 'error'   ? 'bg-red-950/90 border-red-500/30 text-red-200' :
              t.type === 'success' ? 'bg-emerald-950/90 border-emerald-500/30 text-emerald-200' :
              t.type === 'warning' ? 'bg-amber-950/90 border-amber-500/30 text-amber-200' :
                                     'bg-surface-card/90 border-white/10 text-ink'
            }`}>
              <span className="text-sm leading-snug flex-1">{t.msg}</span>
              <button
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                className="shrink-0 opacity-50 hover:opacity-100 text-lg leading-none"
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SignalBadge({ metrics }: { metrics?: any }) {
  if (!metrics?.signal || metrics.signal === 0) return null
  const s = metrics.signal
  const level = s >= -65 ? 'Excelente' : s >= -75 ? 'Buena' : s >= -85 ? 'Regular' : 'Débil'
  const color = s >= -65 ? 'bg-green-100 text-green-700' : s >= -75 ? 'bg-blue-100 text-blue-700' : s >= -85 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium font-mono ${color}`}>{s} dBm · {level}</span>
      {metrics.txCcq > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">CCQ {metrics.txCcq}%</span>}
      {metrics.cinr !== 0 && metrics.cinr != null && <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">CINR {metrics.cinr} dB</span>}
      {metrics.noise !== 0 && metrics.noise != null && <span className="text-xs px-2 py-0.5 rounded-full bg-surface-raised text-ink-muted font-medium">Ruido {metrics.noise} dBm</span>}
    </div>
  )
}

function SignalChart({ data }: { data: any[] }) {
  const pts = data.filter(d => d.signal && d.signal !== 0)
  if (pts.length < 2) return <p className="text-xs text-gray-400 py-2">Sin datos suficientes aún</p>
  const W = 300, H = 56
  const sigs = pts.map(d => d.signal)
  const min = Math.min(...sigs) - 2, max = Math.max(...sigs) + 2
  const range = max - min || 1
  const polyline = pts.map((d, i) => {
    const x = ((i / (pts.length - 1)) * W).toFixed(1)
    const y = (H - ((d.signal - min) / range) * H).toFixed(1)
    return `${x},${y}`
  }).join(' ')
  const ccqPts = pts.filter(d => d.txCcq > 0)
  const ccqLine = ccqPts.map((d, i) => {
    const x = ((i / Math.max(ccqPts.length - 1, 1)) * W).toFixed(1)
    const y = (H - (d.txCcq / 100) * H).toFixed(1)
    return `${x},${y}`
  }).join(' ')
  const fmt = (s: string) => new Date(s).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14 overflow-visible">
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#e5e7eb" strokeWidth="0.5" />
        <polyline fill="none" stroke="#3b82f6" strokeWidth="1.5" points={polyline} />
        {ccqLine && <polyline fill="none" stroke="#a855f7" strokeWidth="1" strokeDasharray="3,2" points={ccqLine} />}
      </svg>
      <div className="flex justify-between text-xs text-gray-400 mt-0.5">
        <span>{fmt(pts[0].sampledAt)}</span>
        <span className="text-blue-500 font-medium">{min.toFixed(0)}…{max.toFixed(0)} dBm</span>
        <span>{fmt(pts[pts.length - 1].sampledAt)}</span>
      </div>
      <p className="text-xs text-gray-300 mt-1">— señal (azul) · - - CCQ (morado)</p>
    </div>
  )
}