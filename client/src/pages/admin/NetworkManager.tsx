import { useState, useEffect } from 'react'
import {
  ArrowLeft, Plus, RefreshCw, X, MapPin, Radio, Router, Server,
  Wifi, CheckCircle, AlertTriangle, Eye,
  Antenna, Network, Search, Pencil, User, Radar, Trash2
} from 'lucide-react'
import axios from 'axios'
import ThemeToggle from '../../components/ThemeToggle'
import SubscriberQueueCard from '../../components/SubscriberQueueCard'
import RouterNetworkConfig from '../../components/RouterNetworkConfig'
import NetworkTopologyMap, { isHomeRouterEquip } from '../../components/NetworkTopologyMap'
import DetectedDevices from './DetectedDevices'
import NetworksIpPools from './NetworksIpPools'
import DeviceIpLink from '../../components/DeviceIpLink'

interface Props {
  API: string
  onBack: () => void
  onOpenClient?: (clientId: number, tab?: string) => void
}

const SITE_TYPES = [
  { value: 'pop', label: 'POP / Central' },
  { value: 'tower', label: 'Torre / Nodo' },
  { value: 'node', label: 'Nodo secundario' },
  { value: 'office', label: 'Oficina' },
]

type NetworkView = 'topology' | 'pools' | 'detected'

const NETWORK_VIEWS: { id: NetworkView; label: string; icon: typeof MapPin }[] = [
  { id: 'topology', label: 'Topología', icon: Network },
  { id: 'pools', label: 'Redes & Pools de IPs', icon: Server },
  { id: 'detected', label: 'Detectados', icon: Radar },
]

const EQUIP_TYPES = [
  { value: 'router', label: 'Router' },
  { value: 'switch', label: 'Switch' },
  { value: 'ap', label: 'Access Point' },
  { value: 'cpe', label: 'CPE / Antena cliente' },
  { value: 'olt', label: 'OLT' },
  { value: 'other', label: 'Otro' },
]

function statusDot(item: any) {
  const online = item.agentConnected || item.status === 'online'
  if (item.type === 'cpe') {
    return online ? 'bg-green-500' : item.status === 'offline' ? 'bg-red-500' : 'bg-gray-400'
  }
  return online ? 'bg-green-500' : 'bg-gray-400'
}

function flattenSites(nodes: any[], out: any[] = []): any[] {
  for (const n of nodes) {
    out.push(n)
    if (n.children?.length) flattenSites(n.children, out)
  }
  return out
}

function collectDescendantIds(site: any, ids = new Set<number>()): Set<number> {
  ids.add(site.id)
  for (const c of site.children || []) collectDescendantIds(c, ids)
  return ids
}

function findSiteInTree(nodes: any[], id: number): any | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children?.length) {
      const found = findSiteInTree(n.children, id)
      if (found) return found
    }
  }
  return null
}

function siteNameById(tree: any[], siteId: number | null | undefined): string {
  if (!siteId) return 'Sin nodo'
  return flattenSites(tree).find((s) => s.id === siteId)?.name || `Nodo #${siteId}`
}

function routerTypeLabel(r: any): string {
  const t = String(r.credentials?.routerType || '')
  if (t.startsWith('edgerouter')) return 'EdgeRouter'
  if (t.startsWith('mikrotik')) return 'MikroTik'
  return r.brand || 'Router'
}

function sortLinkableRouters(linkable: any[], site: any | null): any[] {
  if (!site) return linkable
  const parentId = site.parentId
  const siteName = String(site.name || '').toLowerCase()
  return [...linkable].sort((a, b) => {
    const score = (r: any) => {
      let s = 0
      if (parentId && r.siteId === parentId) s -= 10
      if (String(r.name || '').toLowerCase().includes(siteName)) s -= 5
      if (!r.siteId) s -= 2
      return s
    }
    return score(a) - score(b) || String(a.name).localeCompare(String(b.name))
  })
}

export default function NetworkManager({ API, onBack, onOpenClient }: Props) {
  const [tree, setTree] = useState<any[]>([])
  const [unassigned, setUnassigned] = useState<any[]>([])
  const [stats, setStats] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [selectedSite, setSelectedSite] = useState<any>(null)
  const [showSiteForm, setShowSiteForm] = useState(false)
  const [siteFormMode, setSiteFormMode] = useState<'create' | 'edit'>('create')
  const [editingSiteId, setEditingSiteId] = useState<number | null>(null)
  const [showEquipForm, setShowEquipForm] = useState(false)
  const [showRouterModal, setShowRouterModal] = useState(false)
  const [routerModalTab, setRouterModalTab] = useState<'link' | 'create'>('link')
  const [linkRouterId, setLinkRouterId] = useState<number | ''>('')
  const [siteForm, setSiteForm] = useState<any>({ type: 'node' })
  const [equipForm, setEquipForm] = useState<any>({ type: 'cpe', brand: 'Ubiquiti' })
  const [routerNetwork, setRouterNetwork] = useState<any>(null)
  const [selectedRouter, setSelectedRouter] = useState<any>(null)
  const [routerPanelTab, setRouterPanelTab] = useState<'subscribers' | 'infra'>('subscribers')
  const [routers, setRouters] = useState<any[]>([])
  const [suggestingIp, setSuggestingIp] = useState(false)
  const [ipSuggestHint, setIpSuggestHint] = useState('')
  const [clients, setClients] = useState<any[]>([])
  const [editingEquip, setEditingEquip] = useState<any>(null)
  const [editEquipForm, setEditEquipForm] = useState<any>({})
  const [editingRouter, setEditingRouter] = useState<any>(null)
  const [editRouterForm, setEditRouterForm] = useState<any>({})
  const [networkView, setNetworkView] = useState<NetworkView>('topology')
  const [topologyFocusId, setTopologyFocusId] = useState<number | null>(null)
  const [selectedEquip, setSelectedEquip] = useState<any>(null)

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
    })
  }

  function isSectorialEquip(eq: any): boolean {
    if (!eq || eq.type === 'router') return false
    if (eq.type === 'ap') return true
    if (eq.clientId) return false
    const blob = `${eq.name || ''} ${eq.notes || ''}`
    if (/sector|ap\b|base|tower|torre/i.test(blob)) return true
    return eq.type === 'cpe' && /ubiquiti|airmax|airos|nanostation|litebeam|powerbeam|rocket|iso.?station|\bloco\b/i.test(
      `${eq.brand || ''} ${eq.model || ''} ${eq.name || ''}`,
    )
  }

  async function loadAll(opts: { quiet?: boolean } = {}) {
    if (!opts.quiet) setLoading(true)
    try {
      const [sitesRes, routersRes, clientsRes] = await Promise.all([
        api().get('/sites'),
        api().get('/routers'),
        api().get('/clients', { params: { page: 1, limit: 200 } }),
      ])
      const nextTree = sitesRes.data.tree || []
      setTree(nextTree)
      setUnassigned(sitesRes.data.unassigned || [])
      setStats(sitesRes.data.stats || {})
      setRouters(routersRes.data || [])
      const clientData = clientsRes.data
      setClients(Array.isArray(clientData) ? clientData : clientData?.items || [])
      // Mantener selección de sitio/equipo sincronizada con datos frescos
      if (selectedSite) {
        const fresh = findSiteInTree(nextTree, selectedSite.id)
        if (fresh) setSelectedSite(fresh)
      }
      if (selectedEquip) {
        const flat = flattenSites(nextTree).flatMap((s) => s.equipment || [])
        const freshEq = flat.find((e: any) => e.id === selectedEquip.id)
        setSelectedEquip(freshEq || null)
      }
    } catch (e: any) {
      if (!opts.quiet) alert('Error: ' + (e.response?.data?.error || e.message))
    }
    if (!opts.quiet) setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  // Topología: refresco vivo cada 30s (presencia estaciones vía sync backend)
  useEffect(() => {
    if (networkView !== 'topology') return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      void loadAll({ quiet: true })
    }, 30000)
    return () => window.clearInterval(timer)
  }, [networkView])


  function selectSite(site: any) {
    setSelectedSite(site)
    setSelectedRouter(null)
    setRouterNetwork(null)
    setRouterPanelTab('subscribers')
    setSelectedEquip(null)
    setTopologyFocusId(site.id)
  }

  useEffect(() => {
    if (networkView === 'topology' && selectedSite?.id) {
      setTopologyFocusId(selectedSite.id)
    }
  }, [networkView, selectedSite?.id])

  async function refreshSelectedSite() {
    if (!selectedSite) return
    const res = await api().get('/sites')
    const findSite = (nodes: any[]): any => {
      for (const n of nodes) {
        if (n.id === selectedSite.id) return n
        const found = findSite(n.children || [])
        if (found) return found
      }
      return null
    }
    const updated = findSite(res.data.tree || [])
    if (updated) setSelectedSite(updated)
    setTree(res.data.tree || [])
    setUnassigned(res.data.unassigned || [])
    setStats(res.data.stats || {})
  }

  async function createSite() {
    try {
      await api().post('/sites', {
        ...siteForm,
        parentId: siteForm.parentId || selectedSite?.id || null,
      })
      closeSiteForm()
      loadAll()
    } catch (e: any) { alert(e.response?.data?.error || e.message) }
  }

  async function updateSite() {
    if (!editingSiteId) return
    try {
      await api().patch(`/sites/${editingSiteId}`, {
        name: siteForm.name,
        type: siteForm.type,
        city: siteForm.city,
        address: siteForm.address,
        latitude: siteForm.latitude || null,
        longitude: siteForm.longitude || null,
        parentId: siteForm.parentId || null,
        notes: siteForm.notes,
      })
      closeSiteForm()
      await loadAll()
      await refreshSelectedSite()
    } catch (e: any) { alert(e.response?.data?.error || e.message) }
  }

  async function deleteSite() {
    if (!editingSiteId) return
    const site = findSiteInTree(tree, editingSiteId)
    if (!site) return
    if (!confirm(`¿Eliminar el nodo "${site.name}"? Los equipos quedarán sin nodo asignado.`)) return
    try {
      await api().delete(`/sites/${editingSiteId}`)
      closeSiteForm()
      setSelectedSite(null)
      loadAll()
    } catch (e: any) { alert(e.response?.data?.error || e.message) }
  }

  function closeSiteForm() {
    setShowSiteForm(false)
    setSiteFormMode('create')
    setEditingSiteId(null)
    setSiteForm({ type: 'node' })
  }

  function openCreateSite() {
    setSiteForm({ type: 'node', parentId: selectedSite?.id || '' })
    setSiteFormMode('create')
    setEditingSiteId(null)
    setShowSiteForm(true)
  }

  function openEditSite(site: any) {
    setSiteForm({
      name: site.name || '',
      type: site.type || 'node',
      city: site.city || '',
      address: site.address || '',
      latitude: site.latitude ?? '',
      longitude: site.longitude ?? '',
      parentId: site.parentId || '',
      notes: site.notes || '',
    })
    setSiteFormMode('edit')
    setEditingSiteId(site.id)
    setShowSiteForm(true)
  }

  async function createEquipment() {
    try {
      await api().post('/sites/equipment', {
        ...equipForm,
        siteId: equipForm.siteId || selectedSite?.id,
        clientId: equipForm.clientId || null,
        parentId: equipForm.parentId || null,
      })
      setShowEquipForm(false)
      setEquipForm({ type: 'cpe', brand: 'Ubiquiti' })
      setIpSuggestHint('')
      await refreshSelectedSite()
      loadAll()
    } catch (e: any) { alert(e.response?.data?.error || e.message) }
  }

  function openEditCpe(eq: any) {
    setEditingEquip(eq)
    setEditEquipForm({
      name: eq.name || '',
      brand: eq.brand || 'Ubiquiti',
      model: eq.model || '',
      ipAddress: eq.ipAddress || '',
      macAddress: eq.macAddress || '',
      snmpCommunity: '',
      clientId: eq.clientId || '',
      parentId: eq.parentId || eq.credentials?.routerId || '',
    })
    setIpSuggestHint('')
  }

  async function saveEditEquipment() {
    if (!editingEquip) return
    try {
      await api().patch(`/sites/equipment/${editingEquip.id}`, {
        ...editEquipForm,
        clientId: editEquipForm.clientId || null,
        parentId: editEquipForm.parentId || null,
      })
      setEditingEquip(null)
      setEditEquipForm({})
      setIpSuggestHint('')
      await refreshSelectedSite()
      loadAll()
    } catch (e: any) { alert(e.response?.data?.error || e.message) }
  }

  async function lookupMacForIp(ip: string, siteId: number, form: 'create' | 'edit') {
    const cleanIp = String(ip || '').split('/')[0].trim()
    if (!cleanIp || !siteId) return
    try {
      const formParentId = form === 'edit' ? editEquipForm.parentId : equipForm.parentId
      const routerId = formParentId || siteRouters[0]?.id || selectedRouter?.id
      const q = routerId ? `&routerId=${routerId}` : ''
      const res = await api().get(`/network/sites/${siteId}/mac-for-ip?ip=${encodeURIComponent(cleanIp)}${q}`)
      if (!res.data.macAddress) return
      if (form === 'edit') setEditEquipForm((f: any) => ({ ...f, macAddress: res.data.macAddress }))
      else setEquipForm((f: any) => ({ ...f, macAddress: res.data.macAddress }))
      setIpSuggestHint((h) => h.includes('MAC') ? h : `${h} · MAC ${res.data.macAddress} (DHCP)`)
    } catch { /* sin lease */ }
  }

  async function suggestFreeIpForEdit() {
    const siteId = selectedSite?.id
    if (!siteId) {
      alert('Selecciona un nodo en el árbol primero')
      return
    }
    setSuggestingIp(true)
    setIpSuggestHint('')
    try {
      const routerId = editEquipForm.parentId || siteRouters[0]?.id || selectedRouter?.id
      const q = routerId ? `?routerId=${routerId}` : ''
      const res = await api().get(`/network/sites/${siteId}/next-free-ip${q}`)
      setEditEquipForm((f: any) => ({
        ...f,
        ipAddress: res.data.ip,
        ...(res.data.macAddress ? { macAddress: res.data.macAddress } : {}),
      }))
      setIpSuggestHint(`Asignada desde pool ${res.data.pool} · ${res.data.ranges}${res.data.macAddress ? ` · MAC ${res.data.macAddress}` : ''}`)
      if (!res.data.macAddress) await lookupMacForIp(res.data.ip, siteId, 'edit')
    } catch (e: any) {
      alert(e.response?.data?.error || e.message)
    }
    setSuggestingIp(false)
  }

  async function suggestFreeIp() {
    const siteId = equipForm.siteId || selectedSite?.id
    if (!siteId) {
      alert('Selecciona un nodo en el árbol primero')
      return
    }
    setSuggestingIp(true)
    setIpSuggestHint('')
    try {
      const routerId = equipForm.parentId || siteRouters[0]?.id || selectedRouter?.id
      const q = routerId ? `?routerId=${routerId}` : ''
      const res = await api().get(`/network/sites/${siteId}/next-free-ip${q}`)
      setEquipForm((f: any) => ({
        ...f,
        ipAddress: res.data.ip,
        siteId,
        ...(res.data.macAddress ? { macAddress: res.data.macAddress } : {}),
      }))
      setIpSuggestHint(`Asignada desde pool ${res.data.pool} · ${res.data.ranges}${res.data.macAddress ? ` · MAC ${res.data.macAddress}` : ''}`)
      if (!res.data.macAddress) await lookupMacForIp(res.data.ip, siteId, 'create')
    } catch (e: any) {
      alert(e.response?.data?.error || e.message)
    }
    setSuggestingIp(false)
  }

  function clientLabel(c: any) {
    const name = c.user?.fullName || c.fullName || `Abonado #${c.id}`
    const extra = c.user?.email || c.rut || ''
    return extra ? `${name} (${extra})` : name
  }

  async function assignToSite(equipmentId: number, siteId: number | null) {
    try {
      await api().post(`/sites/equipment/${equipmentId}/assign`, { siteId })
      await refreshSelectedSite()
      loadAll()
    } catch (e: any) { alert(e.response?.data?.error || e.message) }
  }

  async function linkExistingRouter() {
    if (!linkRouterId || !selectedSite) return
    const linkedId = Number(linkRouterId)
    try {
      await assignToSite(linkedId, selectedSite.id)
      const orphans = (selectedSite.equipment || []).filter(
        (e: any) => e.type === 'cpe' && !e.parentId && !e.credentials?.routerId,
      )
      for (const cpe of orphans) {
        await api().patch(`/sites/equipment/${cpe.id}`, { parentId: linkedId })
      }
      setShowRouterModal(false)
      setLinkRouterId('')
      if (orphans.length) {
        alert(`Router vinculado. ${orphans.length} antena(s) CPE asignada(s) automáticamente a este router.`)
      }
      await refreshSelectedSite()
      loadAll()
    } catch (e: any) { alert(e.response?.data?.error || e.message) }
  }

  async function quickLinkRouter(routerId: number) {
    if (!selectedSite) return
    try {
      await assignToSite(routerId, selectedSite.id)
      const orphans = (selectedSite.equipment || []).filter(
        (e: any) => e.type === 'cpe' && !e.parentId && !e.credentials?.routerId,
      )
      for (const cpe of orphans) {
        await api().patch(`/sites/equipment/${cpe.id}`, { parentId: routerId })
      }
      await refreshSelectedSite()
      loadAll()
    } catch (e: any) { alert(e.response?.data?.error || e.message) }
  }

  function openEditRouter(eq: any) {
    setEditingRouter(eq)
    setEditRouterForm({
      name: eq.name || '',
      siteId: eq.siteId || '',
      parentRouterId: eq.credentials?.parentRouterId || '',
    })
  }

  async function saveEditRouter() {
    if (!editingRouter) return
    try {
      const newSiteId = editRouterForm.siteId ? Number(editRouterForm.siteId) : null
      if (newSiteId !== editingRouter.siteId) {
        await api().post(`/sites/equipment/${editingRouter.id}/assign`, { siteId: newSiteId })
      }
      if (editRouterForm.name?.trim() && editRouterForm.name !== editingRouter.name) {
        await api().patch(`/sites/equipment/${editingRouter.id}`, { name: editRouterForm.name.trim() })
      }
      const prevParent = editingRouter.credentials?.parentRouterId || null
      const newParent = editRouterForm.parentRouterId ? Number(editRouterForm.parentRouterId) : null
      if (String(prevParent || '') !== String(newParent || '')) {
        await api().patch(`/routers/${editingRouter.id}`, { parentRouterId: newParent })
      }
      setEditingRouter(null)
      setEditRouterForm({})
      await refreshSelectedSite()
      loadAll()
    } catch (e: any) { alert(e.response?.data?.error || e.message) }
  }

  async function unlinkRouterFromSite(eq: any) {
    if (!confirm(`¿Quitar "${eq.name}" de este nodo? El router seguirá en tu inventario (sin nodo asignado).`)) return
    await assignToSite(eq.id, null)
  }

  function openRouterModal() {
    const linkable = sortLinkableRouters(
      routers.filter((r) => r.siteId !== selectedSite?.id),
      selectedSite,
    )
    const suggested = linkable.find((r) => {
      const n = String(selectedSite?.name || '').toLowerCase()
      return n && String(r.name || '').toLowerCase().includes(n)
    })
    setRouterModalTab(linkable.length > 0 ? 'link' : 'create')
    setLinkRouterId(suggested?.id || (linkable.length === 1 ? linkable[0].id : ''))
    setEquipForm({ ...equipForm, siteId: selectedSite?.id, type: 'router', brand: 'MikroTik' })
    setShowRouterModal(true)
  }

  async function loadRouterNetwork(router: any, tab: 'subscribers' | 'infra' = 'subscribers') {
    setSelectedRouter(router)
    setRouterPanelTab(tab)
    setRouterNetwork(null)
    if (tab === 'infra') return
    try {
      const res = await api().get(`/sites/router/${router.id}/network`)
      setRouterNetwork(res.data)
    } catch (e: any) {
      setRouterNetwork({ error: e.response?.data?.error || e.message })
    }
  }

  const siteEquipment = selectedSite?.equipment || []
  const siteRouters = siteEquipment.filter((e: any) => e.type === 'router')
  const siteCpe = siteEquipment.filter((e: any) => e.type === 'cpe')
  const linkableRouters = sortLinkableRouters(
    routers.filter((r) => r.siteId !== selectedSite?.id),
    selectedSite,
  )
  const unassignedRouters = unassigned.filter((e) => e.type === 'router')
  const allSites = flattenSites(tree)
  const upstreamRouters = routers.filter(
    (r) => r.id !== editingRouter?.id && String(r.credentials?.routerType || '').startsWith('mikrotik'),
  )

  return (
    <div className="flex-1 flex flex-col bg-surface min-h-screen">
      <header className="bg-surface-card border-b border-line px-6 py-4 flex items-center gap-4 sticky top-0 z-10">
        <button onClick={onBack} className="p-2 hover:bg-surface-raised rounded-lg text-ink"><ArrowLeft className="h-5 w-5" /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-ink flex items-center gap-2">
            <Network className="h-5 w-5 text-blue-600" /> Red ISP
          </h1>
          <p className="text-sm text-ink-muted">Nodos, topología, pools de IPs y dispositivos detectados</p>
        </div>
        <button
          type="button"
          onClick={openCreateSite}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line text-sm text-ink-soft hover:bg-surface-raised"
        >
          <Plus className="h-4 w-4" /> Nuevo nodo
        </button>
        <ThemeToggle />
      </header>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-4">
        {[
          { label: 'Sitios / nodos', value: stats.sites || 0, icon: MapPin, color: 'text-blue-600' },
          { label: 'Routers', value: stats.routers || 0, icon: Router, color: 'text-purple-600' },
          { label: 'Online', value: stats.online || 0, icon: Wifi, color: 'text-green-600' },
          { label: 'CPE / antenas', value: stats.cpe || 0, icon: Antenna, color: 'text-orange-600' },
        ].map(s => (
          <div key={s.label} className="bg-surface-card rounded-xl border p-4 flex items-center gap-3">
            <s.icon className={`h-8 w-8 ${s.color} opacity-80`} />
            <div>
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-ink-muted">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="px-6 pb-3">
        <div className="inline-flex gap-1 bg-surface-card border rounded-xl p-1 shadow-sm">
          {NETWORK_VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setNetworkView(v.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
                networkView === v.id ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-surface-raised'
              }`}
            >
              <v.icon className="h-4 w-4" />
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {networkView === 'detected' ? (
        <div className="flex-1 px-6 pb-6 overflow-auto min-h-0">
          <DetectedDevices API={API} onOpenClient={onOpenClient ? (id) => onOpenClient(id, 'overview') : undefined} />
        </div>
      ) : networkView === 'pools' ? (
        <div className="flex-1 px-6 pb-6 overflow-auto min-h-0">
          <NetworksIpPools API={API} />
        </div>
      ) : (
      <div className="flex-1 flex gap-4 px-6 pb-6 min-h-0">
        {networkView === 'topology' && (
          <div className="flex-1 min-w-0 min-h-[480px] flex flex-col">
            <NetworkTopologyMap
              tree={tree}
              selectedSiteId={selectedSite?.id}
              onSelectSite={selectSite}
              focusSiteId={topologyFocusId}
              onFocusSiteChange={(id) => {
                setTopologyFocusId(id)
                if (id == null) {
                  setSelectedSite(null)
                  setSelectedEquip(null)
                  setSelectedRouter(null)
                  setRouterNetwork(null)
                }
              }}
              selectedEquipId={selectedEquip?.id ?? null}
              onSelectEquip={(eq) => {
                setSelectedEquip(eq)
                if (eq?.type === 'router') {
                  setSelectedRouter(eq)
                  setRouterPanelTab('subscribers')
                  setRouterNetwork(null)
                } else {
                  setSelectedRouter(null)
                  setRouterNetwork(null)
                }
              }}
              onOpenClient={onOpenClient ? (id) => onOpenClient(id, 'overview') : undefined}
            />
          </div>
        )}

        <main className="flex flex-col gap-4 min-w-0 w-[min(100%,560px)] flex-shrink-0">
          {!selectedSite ? (
            <div className="flex-1 bg-surface-card rounded-xl border flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Radio className="h-16 w-16 mx-auto mb-4 opacity-20" />
                <p className="font-medium">Selecciona un nodo en el mapa</p>
                <p className="text-sm mt-1">
                  Clic en un equipo del mapa para ver solo ese dispositivo y sus configuraciones
                </p>
                <button
                  type="button"
                  onClick={openCreateSite}
                  className="mt-4 text-sm text-blue-600 hover:underline"
                >
                  + Crear nodo
                </button>
              </div>
            </div>
          ) : (
            (() => {
              const eq = selectedEquip
              if (!eq) {
                return (
                  <div className="flex-1 bg-surface-card rounded-xl border flex items-center justify-center text-gray-400 p-6">
                    <div className="text-center max-w-xs">
                      <Radio className="h-12 w-12 mx-auto mb-3 opacity-25" />
                      <p className="font-medium text-ink">Selecciona un equipo en el mapa</p>
                      <p className="text-sm mt-1">
                        Router MikroTik, sectorial, CPE o WiFi de casa — aquí verás solo ese equipo y lo que puedes editar.
                      </p>
                    </div>
                  </div>
                )
              }

              const online = Boolean(eq.agentConnected || eq.status === 'online')
              const isRouter = eq.type === 'router'
              const isSectorial = isSectorialEquip(eq)
              const isHomeWifi = isHomeRouterEquip(eq)
              const isCpe = !isRouter && !isHomeWifi && (eq.type === 'cpe' || eq.clientId || isSectorial)
              const siteEquip = selectedSite.equipment || []
              const stations = isSectorial
                ? siteEquip
                  .filter((e: any) => e.clientId && e.id !== eq.id && !isHomeRouterEquip(e))
                  .sort((a: any, b: any) => Number(b.status === 'online') - Number(a.status === 'online')
                    || String(a.clientName || a.name).localeCompare(String(b.clientName || b.name)))
                : []
              const homeRouterByClient = new Map<number, any>()
              for (const hr of siteEquip.filter(isHomeRouterEquip)) {
                if (hr.clientId && !homeRouterByClient.has(hr.clientId)) homeRouterByClient.set(hr.clientId, hr)
              }
              const linkedHome = eq.clientId ? homeRouterByClient.get(eq.clientId) : null
              const parentRouterId = eq.parentId || eq.credentials?.routerId
              const parentRouter = parentRouterId
                ? siteEquip.find((x: any) => x.id === parentRouterId)
                : null
              const roleLabel = isRouter
                ? routerTypeLabel(eq)
                : isSectorial
                  ? 'Sectorial / AP'
                  : isHomeWifi
                    ? 'Router WiFi casa'
                    : (EQUIP_TYPES.find((t) => t.value === eq.type)?.label || 'Equipo')

              return (
                <div className="flex flex-col gap-4 min-h-0 flex-1 overflow-y-auto">
                  <div className="bg-surface-card rounded-xl border overflow-hidden">
                    <div className={`px-4 py-3 border-b flex items-start justify-between gap-3 ${
                      isRouter ? 'bg-violet-50/70' : isSectorial ? 'bg-teal-50/70' : isHomeWifi ? 'bg-indigo-50/70' : 'bg-sky-50/70'
                    }`}>
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-widest font-semibold text-ink-muted">
                          {selectedSite.name}
                        </p>
                        <h3 className="text-base font-bold text-ink truncate mt-0.5">{eq.name}</h3>
                        <p className="text-xs text-ink-muted mt-0.5">
                          {roleLabel}
                          {(eq.brand || eq.model) ? ` · ${[eq.brand, eq.model].filter(Boolean).join(' ')}` : ''}
                        </p>
                      </div>
                      <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                        online ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {online ? 'Online' : 'Offline'}
                      </span>
                    </div>

                    <div className="px-4 py-3 space-y-2 border-b">
                      {eq.ipAddress || eq.displayIp ? (
                        <p className="text-xs flex flex-wrap items-center gap-1.5">
                          <span className="text-ink-muted w-14">IP</span>
                          <DeviceIpLink
                            ip={eq.displayIp || eq.ipAddress}
                            className="font-mono text-blue-600 hover:underline break-all"
                            showIcon
                          />
                        </p>
                      ) : (
                        <p className="text-xs text-amber-600">Sin IP asignada</p>
                      )}
                      {eq.macAddress && (
                        <p className="text-xs flex items-center gap-1.5">
                          <span className="text-ink-muted w-14">MAC</span>
                          <span className="font-mono text-ink">{eq.macAddress}</span>
                        </p>
                      )}
                      {eq.wirelessSignal != null && (
                        <p className="text-xs flex items-center gap-1.5">
                          <span className="text-ink-muted w-14">Señal</span>
                          <span className="text-ink">{eq.wirelessSignal} dBm
                            {eq.wirelessCcq != null ? ` · CCQ ${eq.wirelessCcq}%` : ''}
                          </span>
                        </p>
                      )}
                      {eq.clientName && (
                        <p className="text-xs flex items-center gap-1.5">
                          <span className="text-ink-muted w-14">Abonado</span>
                          {eq.clientId && onOpenClient ? (
                            <button
                              type="button"
                              onClick={() => onOpenClient(eq.clientId, 'overview')}
                              className="text-blue-600 hover:underline inline-flex items-center gap-1"
                            >
                              <User className="h-3 w-3" /> {eq.clientName}
                            </button>
                          ) : (
                            <span className="text-ink">{eq.clientName}</span>
                          )}
                        </p>
                      )}
                      {parentRouter && (
                        <p className="text-xs flex items-center gap-1.5">
                          <span className="text-ink-muted w-14">Router</span>
                          <span className="text-ink inline-flex items-center gap-1">
                            <Router className="h-3 w-3" /> {parentRouter.name}
                          </span>
                        </p>
                      )}
                      {linkedHome && !isHomeWifi && (
                        <p className="text-xs flex items-center gap-1.5">
                          <span className="text-ink-muted w-14">WiFi</span>
                          <button
                            type="button"
                            onClick={() => setSelectedEquip(linkedHome)}
                            className="text-blue-600 hover:underline truncate"
                          >
                            {linkedHome.name}
                            {linkedHome.ipAddress ? ` · ${linkedHome.ipAddress}` : ''}
                          </button>
                        </p>
                      )}
                    </div>

                    <div className="px-4 py-3 space-y-2">
                      <p className="text-[10px] uppercase tracking-widest font-semibold text-ink-muted">
                        Acciones
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {isRouter && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditRouter(eq)}
                              className="px-3 py-1.5 text-xs border border-line text-ink-soft rounded-lg hover:bg-surface-raised flex items-center gap-1.5"
                            >
                              <Pencil className="h-3.5 w-3.5" /> Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => loadRouterNetwork(eq, 'subscribers')}
                              className={`px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 ${
                                selectedRouter?.id === eq.id && routerPanelTab === 'subscribers'
                                  ? 'bg-blue-700 text-white'
                                  : 'bg-blue-600 text-white hover:bg-blue-700'
                              }`}
                            >
                              <Eye className="h-3.5 w-3.5" /> Abonados / PPPoE
                            </button>
                            <button
                              type="button"
                              onClick={() => loadRouterNetwork(eq, 'infra')}
                              className={`px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 ${
                                selectedRouter?.id === eq.id && routerPanelTab === 'infra'
                                  ? 'bg-purple-700 text-white'
                                  : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                              }`}
                            >
                              <Server className="h-3.5 w-3.5" /> DHCP / Infra
                            </button>
                          </>
                        )}
                        {(isCpe || isSectorial || isHomeWifi || eq.type === 'other' || eq.type === 'switch') && !isRouter && (
                          <button
                            type="button"
                            onClick={() => openEditCpe(eq)}
                            className="px-3 py-1.5 text-xs border border-line text-ink-soft rounded-lg hover:bg-surface-raised flex items-center gap-1.5"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            {isHomeWifi ? 'Editar router WiFi' : isSectorial ? 'Editar sectorial' : 'Editar equipo'}
                          </button>
                        )}
                        {eq.clientId && onOpenClient && (
                          <button
                            type="button"
                            onClick={() => onOpenClient(eq.clientId, 'overview')}
                            className="px-3 py-1.5 text-xs bg-sky-100 text-sky-800 rounded-lg hover:bg-sky-200 flex items-center gap-1.5"
                          >
                            <User className="h-3.5 w-3.5" /> Ver abonado
                          </button>
                        )}
                        {isSectorial && (
                          <button
                            type="button"
                            onClick={() => {
                              const routers = siteEquip.filter((e: any) => e.type === 'router')
                              setEquipForm({
                                ...equipForm,
                                siteId: selectedSite.id,
                                type: 'cpe',
                                brand: 'Ubiquiti',
                                parentId: routers.length === 1 ? routers[0].id : (eq.parentId || ''),
                              })
                              setIpSuggestHint('')
                              setShowEquipForm(true)
                            }}
                            className="px-3 py-1.5 text-xs bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 flex items-center gap-1.5"
                          >
                            <Plus className="h-3.5 w-3.5" /> Agregar CPE
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {isRouter && selectedRouter?.id === eq.id && (
                    <div className="bg-surface-card rounded-xl border flex flex-col overflow-hidden min-h-[280px] flex-1">
                      <div className="px-4 py-3 border-b bg-surface flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-gray-800 text-sm truncate">
                            {routerPanelTab === 'subscribers' ? 'Abonados · colas y PPPoE' : 'DHCP e infraestructura'}
                          </h3>
                          <p className="text-xs text-ink-muted mt-0.5">{routerTypeLabel(eq)}</p>
                        </div>
                        <div className="flex gap-1 bg-surface-raised rounded-lg p-0.5">
                          <button
                            type="button"
                            onClick={() => loadRouterNetwork(eq, 'subscribers')}
                            className={`text-xs px-2 py-1 rounded-md ${routerPanelTab === 'subscribers' ? 'bg-surface-card shadow font-medium' : 'text-ink-muted'}`}
                          >
                            Abonados
                          </button>
                          <button
                            type="button"
                            onClick={() => loadRouterNetwork(eq, 'infra')}
                            className={`text-xs px-2 py-1 rounded-md ${routerPanelTab === 'infra' ? 'bg-surface-card shadow font-medium' : 'text-ink-muted'}`}
                          >
                            Infra
                          </button>
                        </div>
                      </div>
                      <div className="flex-1 overflow-y-auto p-4 min-h-0">
                        {routerPanelTab === 'infra' ? (
                          <RouterNetworkConfig
                            API={API}
                            routerId={eq.id}
                            routerName={eq.name}
                            siteEquipment={siteEquip}
                          />
                        ) : routerNetwork?.error ? (
                          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex gap-2">
                            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                            {routerNetwork.error}
                          </div>
                        ) : !routerNetwork ? (
                          <div className="text-center py-10 space-y-3">
                            <p className="text-sm text-ink-muted">Carga las colas y sesiones PPPoE de este router.</p>
                            <button
                              type="button"
                              onClick={() => loadRouterNetwork(eq, 'subscribers')}
                              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                            >
                              Cargar abonados
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-5">
                            {routerNetwork.foreignOnRouter?.total > 0 && (
                              <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                                Este MikroTik tiene {routerNetwork.foreignOnRouter.total} cola(s)/PPPoE que no pertenecen a tu ISP
                                (se ocultan). En lab compartido es normal; en producción cada ISP debe usar su propio router.
                              </p>
                            )}
                            {(routerNetwork.simpleQueues || []).length > 0 ? (
                              <div>
                                <p className="text-xs font-semibold text-ink-muted uppercase mb-3 tracking-wide">
                                  Simple Queues ({routerNetwork.simpleQueues.length})
                                </p>
                                <div className="space-y-3">
                                  {(routerNetwork.simpleQueues || []).map((q: any) => (
                                    <SubscriberQueueCard
                                      key={q['.id'] || q.name}
                                      name={q.name}
                                      target={q.target}
                                      maxLimit={q['max-limit']}
                                      comment={q.comment}
                                      disabled={q.disabled === 'true'}
                                    />
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-gray-400 text-center py-4">Sin colas de tu ISP en este router</p>
                            )}
                            <div className="border-t pt-4">
                              <p className="text-xs font-semibold text-ink-muted uppercase mb-2 tracking-wide">
                                PPPoE conectados ({routerNetwork.pppoeActive?.filter((a: any) => a.name)?.length || 0})
                              </p>
                              <div className="space-y-1">
                                {(routerNetwork.pppoeActive || []).filter((a: any) => a.name).map((a: any) => (
                                  <div key={a['.id'] || a.name} className="flex items-center gap-2 text-sm bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                                    <CheckCircle className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                                    <span className="font-medium truncate">{a.name}</span>
                                    <span className="text-xs text-ink-muted font-mono ml-auto">{a.address}</span>
                                  </div>
                                ))}
                                {!(routerNetwork.pppoeActive || []).some((a: any) => a.name) && (
                                  <p className="text-xs text-gray-400 py-2">Nadie conectado por PPPoE ahora</p>
                                )}
                              </div>
                            </div>
                            {(routerNetwork.pppoeSecrets || []).length > 0 && (
                              <div className="border-t pt-4">
                                <p className="text-xs font-semibold text-ink-muted uppercase mb-2 tracking-wide">
                                  Usuarios PPPoE ({routerNetwork.pppoeSecrets.length})
                                </p>
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                  {(routerNetwork.pppoeSecrets || []).slice(0, 15).map((s: any) => (
                                    <div key={s['.id']} className="flex items-center gap-2 text-xs border rounded-lg px-3 py-2 bg-surface">
                                      <span className={`w-2 h-2 rounded-full ${s.disabled === 'true' ? 'bg-red-400' : 'bg-green-400'}`} />
                                      <span className="font-medium">{s.name}</span>
                                      <span className="text-gray-400 ml-auto">{s.profile}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {isSectorial && (
                    <div className="bg-surface-card rounded-xl border overflow-hidden">
                      <div className="px-4 py-3 border-b bg-teal-50/60">
                        <p className="text-[10px] uppercase tracking-widest text-teal-700/80 font-semibold">Estaciones enlazadas</p>
                        <p className="text-xs text-ink-muted mt-0.5">
                          {stations.length} CPE · {stations.filter((s: any) => s.status === 'online').length} online
                        </p>
                      </div>
                      {stations.length === 0 ? (
                        <p className="px-4 py-6 text-sm text-ink-muted text-center">
                          Sin abonados inventariados bajo esta sectorial.
                        </p>
                      ) : (
                        <ul className="divide-y max-h-[360px] overflow-auto">
                          {stations.map((st: any) => {
                            const stOnline = st.status === 'online'
                            const home = st.clientId ? homeRouterByClient.get(st.clientId) : null
                            return (
                              <li key={st.id}>
                                <button
                                  type="button"
                                  onClick={() => setSelectedEquip(st)}
                                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-surface-raised/60 text-left"
                                >
                                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${stOnline ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-ink truncate">{st.clientName || st.name}</p>
                                    <p className="text-xs text-ink-muted font-mono truncate">
                                      {st.displayIp || st.ipAddress || '—'}
                                      {st.wirelessSignal != null ? ` · ${st.wirelessSignal} dBm` : ''}
                                    </p>
                                    {home && (
                                      <p className="text-[11px] text-ink-muted truncate mt-0.5">
                                        WiFi: {home.name}
                                      </p>
                                    )}
                                  </div>
                                  <span className={`text-[10px] font-semibold uppercase ${stOnline ? 'text-emerald-600' : 'text-red-600'}`}>
                                    {stOnline ? 'online' : 'offline'}
                                  </span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )
            })()
          )}
        </main>
      </div>
      )}

      {/* Modal sitio */}
      {showSiteForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between mb-4">
              <h3 className="font-bold text-lg">{siteFormMode === 'edit' ? 'Editar sitio / nodo' : 'Nuevo sitio / nodo'}</h3>
              <button onClick={closeSiteForm}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Nombre *</label>
                <input className="w-full border rounded-lg px-3 py-2 mt-1" placeholder="Torre Panguipulli Centro"
                  value={siteForm.name || ''} onChange={e => setSiteForm({ ...siteForm, name: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Tipo</label>
                <select className="w-full border rounded-lg px-3 py-2 mt-1" value={siteForm.type || 'node'}
                  onChange={e => setSiteForm({ ...siteForm, type: e.target.value })}>
                  {SITE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Nodo padre</label>
                <select
                  className="w-full border rounded-lg px-3 py-2 mt-1"
                  value={siteForm.parentId || ''}
                  onChange={e => setSiteForm({ ...siteForm, parentId: e.target.value ? parseInt(e.target.value, 10) : '' })}
                >
                  <option value="">Sin padre (nodo raíz)</option>
                  {flattenSites(tree)
                    .filter((s) => {
                      if (siteFormMode !== 'edit' || !editingSiteId) return true
                      const blocked = collectDescendantIds(findSiteInTree(tree, editingSiteId) || { id: editingSiteId, children: [] })
                      return !blocked.has(s.id)
                    })
                    .map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
                <p className="text-xs text-ink-muted mt-1">
                  {siteFormMode === 'edit'
                    ? 'Define la jerarquía: ej. Nodo2 depende de Torre Pangui.'
                    : 'Opcional: crea este nodo como hijo de una torre o POP existente.'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Ciudad</label>
                <input className="w-full border rounded-lg px-3 py-2 mt-1" value={siteForm.city || ''}
                  onChange={e => setSiteForm({ ...siteForm, city: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Dirección</label>
                <input className="w-full border rounded-lg px-3 py-2 mt-1" value={siteForm.address || ''}
                  onChange={e => setSiteForm({ ...siteForm, address: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-sm font-medium">Latitud</label>
                  <input type="number" step="any" className="w-full border rounded-lg px-3 py-2 mt-1 font-mono text-sm"
                    placeholder="-39.6436"
                    value={siteForm.latitude ?? ''}
                    onChange={e => setSiteForm({ ...siteForm, latitude: e.target.value || null })} />
                </div>
                <div>
                  <label className="text-sm font-medium">Longitud</label>
                  <input type="number" step="any" className="w-full border rounded-lg px-3 py-2 mt-1 font-mono text-sm"
                    placeholder="-72.3312"
                    value={siteForm.longitude ?? ''}
                    onChange={e => setSiteForm({ ...siteForm, longitude: e.target.value || null })} />
                </div>
              </div>
              <p className="text-xs text-ink-muted">Coordenadas opcionales para ubicar el nodo en mapas (Google Maps → clic derecho → copiar coordenadas).</p>
            </div>
            <div className="flex gap-3 mt-6">
              {siteFormMode === 'edit' && (
                <button type="button" onClick={deleteSite} className="py-2 px-3 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 flex items-center gap-1">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <button onClick={closeSiteForm} className="flex-1 py-2 border rounded-lg">Cancelar</button>
              <button
                onClick={siteFormMode === 'edit' ? updateSite : createSite}
                disabled={!siteForm.name?.trim()}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {siteFormMode === 'edit' ? 'Guardar' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal vincular / crear router */}
      {showRouterModal && selectedSite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
            <div className="flex justify-between mb-4">
              <h3 className="font-bold text-lg">Router en {selectedSite.name}</h3>
              <button onClick={() => setShowRouterModal(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="flex gap-1 bg-surface-raised rounded-lg p-1 mb-4">
              <button
                onClick={() => setRouterModalTab('link')}
                className={`flex-1 py-2 rounded-md text-sm font-medium ${routerModalTab === 'link' ? 'bg-surface-card shadow text-purple-700' : 'text-ink-muted'}`}
              >
                Vincular existente
              </button>
              <button
                onClick={() => setRouterModalTab('create')}
                className={`flex-1 py-2 rounded-md text-sm font-medium ${routerModalTab === 'create' ? 'bg-surface-card shadow text-purple-700' : 'text-ink-muted'}`}
              >
                Crear nuevo
              </button>
            </div>
            {routerModalTab === 'link' ? (
              <div className="space-y-4">
                {linkableRouters.length === 0 ? (
                  <p className="text-sm text-ink-muted text-center py-4">
                    No hay routers disponibles. Créalos en <strong>Gestión Routers</strong> o usa la pestaña Crear nuevo.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-ink-muted">
                      Mueve un router registrado a <strong>{selectedSite.name}</strong>. Si está en la torre padre, solo cambia el nodo — el túnel Cloudflare sigue igual.
                    </p>
                    <select
                      className="w-full border rounded-lg px-3 py-2 bg-surface-card text-sm"
                      value={linkRouterId}
                      onChange={(e) => setLinkRouterId(e.target.value ? Number(e.target.value) : '')}
                    >
                      <option value="">Elegir router…</option>
                      {linkableRouters.map((r: any) => (
                        <option key={r.id} value={r.id}>
                          {r.name} · {routerTypeLabel(r)} — {siteNameById(tree, r.siteId)}
                          {r.credentials?.tunnelHostname || r.ipAddress
                            ? ` (${r.credentials?.tunnelHostname || r.ipAddress})` : ''}
                          {r.agentConnected || r.status === 'online' ? ' · online' : ''}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <div className="flex gap-3">
                  <button onClick={() => setShowRouterModal(false)} className="flex-1 py-2 border rounded-lg">Cancelar</button>
                  <button
                    onClick={linkExistingRouter}
                    disabled={!linkRouterId}
                    className="flex-1 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                  >
                    Vincular al nodo
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Nombre *</label>
                  <input className="w-full border rounded-lg px-3 py-2 mt-1" value={equipForm.name || ''}
                    onChange={e => setEquipForm({ ...equipForm, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-sm font-medium">Marca</label>
                    <input className="w-full border rounded-lg px-3 py-2 mt-1" value={equipForm.brand || 'MikroTik'}
                      onChange={e => setEquipForm({ ...equipForm, brand: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Modelo</label>
                    <input className="w-full border rounded-lg px-3 py-2 mt-1" value={equipForm.model || ''}
                      onChange={e => setEquipForm({ ...equipForm, model: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">IP / hostname</label>
                  <input className="w-full border rounded-lg px-3 py-2 mt-1" value={equipForm.ipAddress || ''}
                    onChange={e => setEquipForm({ ...equipForm, ipAddress: e.target.value })} />
                </div>
                <p className="text-xs text-ink-muted">
                  Para <strong>EdgeRouter</strong> o MikroTik con túnel Cloudflare, créalo en <strong>Routers y agentes</strong> (menú lateral) y luego vincúlalo aquí en «Vincular existente».
                </p>
                <div className="flex gap-3 mt-4">
                  <button onClick={() => setShowRouterModal(false)} className="flex-1 py-2 border rounded-lg">Cancelar</button>
                  <button
                    onClick={async () => {
                      await createEquipment()
                      setShowRouterModal(false)
                    }}
                    className="flex-1 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                  >
                    Crear en nodo
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal equipo (CPE, switch, etc.) */}
      {showEquipForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
            <div className="flex justify-between mb-4">
              <h3 className="font-bold text-lg">Agregar equipo al nodo</h3>
              <button onClick={() => setShowEquipForm(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Nombre *</label>
                <input className="w-full border rounded-lg px-3 py-2 mt-1" value={equipForm.name || ''}
                  onChange={e => setEquipForm({ ...equipForm, name: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Tipo</label>
                <select className="w-full border rounded-lg px-3 py-2 mt-1" value={equipForm.type}
                  onChange={e => {
                    const t = e.target.value
                    if (t === 'router') {
                      setShowEquipForm(false)
                      openRouterModal()
                      return
                    }
                    setEquipForm({ ...equipForm, type: t })
                  }}>
                  {EQUIP_TYPES.filter(t => t.value !== 'router').map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-sm font-medium">Marca</label>
                  <input className="w-full border rounded-lg px-3 py-2 mt-1" value={equipForm.brand || ''}
                    onChange={e => setEquipForm({ ...equipForm, brand: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium">Modelo</label>
                  <input className="w-full border rounded-lg px-3 py-2 mt-1" value={equipForm.model || ''}
                    onChange={e => setEquipForm({ ...equipForm, model: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">IP / hostname</label>
                <div className="flex gap-2 mt-1">
                  <input className="flex-1 border rounded-lg px-3 py-2 font-mono text-sm" placeholder="172.16.140.50"
                    value={equipForm.ipAddress || ''}
                    onChange={e => setEquipForm({ ...equipForm, ipAddress: e.target.value })}
                    onBlur={e => lookupMacForIp(e.target.value, equipForm.siteId || selectedSite?.id, 'create')} />
                  <button type="button" onClick={suggestFreeIp} disabled={suggestingIp || !selectedSite}
                    className="shrink-0 px-3 py-2 border rounded-lg text-sm font-medium text-blue-700 hover:bg-blue-50 hover:border-blue-300 disabled:opacity-40 flex items-center gap-1.5"
                    title="Buscar siguiente IP libre en el MikroTik del nodo">
                    <Search className={`h-4 w-4 ${suggestingIp ? 'animate-pulse' : ''}`} />
                    {suggestingIp ? '…' : 'IP libre'}
                  </button>
                </div>
                {ipSuggestHint && <p className="text-xs text-emerald-700 mt-1">{ipSuggestHint}</p>}
                <p className="text-xs text-ink-muted mt-1">Usa el pool DHCP del router (leases, equipos y abonados ya registrados).</p>
              </div>
              {equipForm.type === 'cpe' && (
                <>
                  {siteRouters.length > 0 && (
                    <div>
                      <label className="text-sm font-medium">Router del nodo</label>
                      <select className="w-full border rounded-lg px-3 py-2 mt-1 bg-surface-card"
                        value={equipForm.parentId || ''}
                        onChange={e => setEquipForm({ ...equipForm, parentId: e.target.value ? Number(e.target.value) : '' })}>
                        <option value="">Automático (único router o primero)</option>
                        {siteRouters.map((r: any) => (
                          <option key={r.id} value={r.id}>{r.name}{r.ipAddress ? ` · ${r.ipAddress}` : ''}</option>
                        ))}
                      </select>
                      <p className="text-xs text-ink-muted mt-1">Define bajo qué router aparece la antena en la topología y el pool DHCP para IP libre.</p>
                    </div>
                  )}
                  <div>
                    <label className="text-sm font-medium">Abonado</label>
                    <select className="w-full border rounded-lg px-3 py-2 mt-1 bg-surface-card"
                      value={equipForm.clientId || ''}
                      onChange={e => setEquipForm({ ...equipForm, clientId: e.target.value ? Number(e.target.value) : '' })}>
                      <option value="">Sin asignar (elegir después)</option>
                      {clients.map((c: any) => (
                        <option key={c.id} value={c.id}>{clientLabel(c)}</option>
                      ))}
                    </select>
                    <p className="text-xs text-ink-muted mt-1">Vincula la antena al abonado. La IP y MAC se copian al servicio activo del cliente.</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">MAC antena</label>
                    <input className="w-full border rounded-lg px-3 py-2 mt-1 font-mono" placeholder="AA:BB:CC:DD:EE:FF"
                      value={equipForm.macAddress || ''} onChange={e => setEquipForm({ ...equipForm, macAddress: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">SNMP Community</label>
                    <input className="w-full border rounded-lg px-3 py-2 mt-1 font-mono" placeholder="public"
                      value={equipForm.snmpCommunity || ''} onChange={e => setEquipForm({ ...equipForm, snmpCommunity: e.target.value })} />
                    <p className="text-xs text-ink-muted mt-1">Para Ubiquiti AirMax: activa SNMP en la antena y usa la misma community.</p>
                  </div>
                </>
              )}
              <p className="text-xs text-ink-muted">
                {equipForm.type === 'router'
                  ? 'Para MikroTik completo con túnel Cloudflare, usa también "Gestión Routers" del menú.'
                  : equipForm.type === 'cpe'
                    ? 'Estado online/offline vía SNMP automático (IP + community). Consulta cada ~3 min.'
                    : ''}
              </p>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowEquipForm(false)} className="flex-1 py-2 border rounded-lg">Cancelar</button>
              <button onClick={createEquipment} className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Agregar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal editar CPE */}
      {editingEquip && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between mb-4">
              <h3 className="font-bold text-lg">
                {editingEquip?.type === 'router'
                  ? 'Editar router'
                  : isHomeRouterEquip(editingEquip)
                    ? 'Editar router WiFi'
                    : isSectorialEquip(editingEquip)
                      ? 'Editar sectorial'
                      : 'Editar antena / equipo'}
              </h3>
              <button onClick={() => { setEditingEquip(null); setIpSuggestHint('') }}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Nombre *</label>
                <input className="w-full border rounded-lg px-3 py-2 mt-1" value={editEquipForm.name || ''}
                  onChange={e => setEditEquipForm({ ...editEquipForm, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-sm font-medium">Marca</label>
                  <input className="w-full border rounded-lg px-3 py-2 mt-1" value={editEquipForm.brand || ''}
                    onChange={e => setEditEquipForm({ ...editEquipForm, brand: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium">Modelo</label>
                  <input className="w-full border rounded-lg px-3 py-2 mt-1" value={editEquipForm.model || ''}
                    onChange={e => setEditEquipForm({ ...editEquipForm, model: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Abonado</label>
                <select className="w-full border rounded-lg px-3 py-2 mt-1 bg-surface-card"
                  value={editEquipForm.clientId || ''}
                  onChange={e => setEditEquipForm({ ...editEquipForm, clientId: e.target.value ? Number(e.target.value) : '' })}>
                  <option value="">Sin abonado</option>
                  {clients.map((c: any) => (
                    <option key={c.id} value={c.id}>{clientLabel(c)}</option>
                  ))}
                </select>
              </div>
              {siteRouters.length > 0 && (
                <div>
                  <label className="text-sm font-medium">Router del nodo</label>
                  <select className="w-full border rounded-lg px-3 py-2 mt-1 bg-surface-card"
                    value={editEquipForm.parentId || ''}
                    onChange={e => setEditEquipForm({ ...editEquipForm, parentId: e.target.value ? Number(e.target.value) : '' })}>
                    <option value="">Automático (único router o primero)</option>
                    {siteRouters.map((r: any) => (
                      <option key={r.id} value={r.id}>{r.name}{r.ipAddress ? ` · ${r.ipAddress}` : ''}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-sm font-medium">IP / hostname</label>
                <div className="flex gap-2 mt-1">
                  <input className="flex-1 border rounded-lg px-3 py-2 font-mono text-sm"
                    value={editEquipForm.ipAddress || ''}
                    onChange={e => setEditEquipForm({ ...editEquipForm, ipAddress: e.target.value })}
                    onBlur={e => lookupMacForIp(e.target.value, selectedSite?.id, 'edit')} />
                  <button type="button" onClick={suggestFreeIpForEdit} disabled={suggestingIp || !selectedSite}
                    className="shrink-0 px-3 py-2 border rounded-lg text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40 flex items-center gap-1.5">
                    <Search className={`h-4 w-4 ${suggestingIp ? 'animate-pulse' : ''}`} />
                    IP libre
                  </button>
                </div>
                {ipSuggestHint && <p className="text-xs text-emerald-700 mt-1">{ipSuggestHint}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">MAC antena</label>
                <input className="w-full border rounded-lg px-3 py-2 mt-1 font-mono"
                  value={editEquipForm.macAddress || ''}
                  onChange={e => setEditEquipForm({ ...editEquipForm, macAddress: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">SNMP Community</label>
                <input className="w-full border rounded-lg px-3 py-2 mt-1 font-mono"
                  value={editEquipForm.snmpCommunity || ''}
                  onChange={e => setEditEquipForm({ ...editEquipForm, snmpCommunity: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setEditingEquip(null); setIpSuggestHint('') }} className="flex-1 py-2 border rounded-lg">Cancelar</button>
              <button onClick={saveEditEquipment} className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal editar router */}
      {editingRouter && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between mb-4">
              <div>
                <h3 className="font-bold text-lg">Editar router</h3>
                <p className="text-sm text-ink-muted">{routerTypeLabel(editingRouter)} · {editingRouter.brand} {editingRouter.model}</p>
              </div>
              <button type="button" onClick={() => setEditingRouter(null)}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Nombre</label>
                <input className="w-full border rounded-lg px-3 py-2 mt-1" value={editRouterForm.name || ''}
                  onChange={e => setEditRouterForm({ ...editRouterForm, name: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Nodo / sitio</label>
                <select className="w-full border rounded-lg px-3 py-2 mt-1 bg-surface-card"
                  value={editRouterForm.siteId || ''}
                  onChange={e => setEditRouterForm({ ...editRouterForm, siteId: e.target.value ? Number(e.target.value) : '' })}>
                  <option value="">Sin nodo (inventario)</option>
                  {allSites.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <p className="text-xs text-ink-muted mt-1">Ej: mover el EdgeRouter de Torre Pangui a Nodo2.</p>
              </div>
              {String(editingRouter.credentials?.routerType || '').startsWith('edgerouter') && upstreamRouters.length > 0 && (
                <div>
                  <label className="text-sm font-medium">MikroTik de borde (upstream)</label>
                  <select className="w-full border rounded-lg px-3 py-2 mt-1 bg-surface-card text-sm"
                    value={editRouterForm.parentRouterId || ''}
                    onChange={e => setEditRouterForm({ ...editRouterForm, parentRouterId: e.target.value || '' })}>
                    <option value="">— Ninguno —</option>
                    {upstreamRouters.map((r: any) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({siteNameById(tree, r.siteId)})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-ink-muted mt-1">El túnel Cloudflare sigue en el MikroTik; el EdgeRouter es la IP local del sector.</p>
                </div>
              )}
              {editingRouter.siteId === selectedSite?.id && (
                <button
                  type="button"
                  onClick={() => { unlinkRouterFromSite(editingRouter); setEditingRouter(null) }}
                  className="w-full py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                >
                  Quitar de este nodo
                </button>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button type="button" onClick={() => setEditingRouter(null)} className="flex-1 py-2 border rounded-lg">Cancelar</button>
              <button type="button" onClick={saveEditRouter} className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
