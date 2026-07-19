import { useState, useEffect } from 'react'
import {
  ArrowLeft, Plus, RefreshCw, X, MapPin, Radio, Router, Server,
  ChevronRight, ChevronDown, Wifi, CheckCircle, AlertTriangle, Eye,
  Layers, Antenna, Network, Search, Pencil, User, Radar, Trash2
} from 'lucide-react'
import axios from 'axios'
import ThemeToggle from '../../components/ThemeToggle'
import SubscriberQueueCard from '../../components/SubscriberQueueCard'
import RouterNetworkConfig from '../../components/RouterNetworkConfig'
import NetworkTopologyMap from '../../components/NetworkTopologyMap'
import DetectedDevices from './DetectedDevices'
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

type NetworkView = 'topology' | 'tree' | 'detected'

const NETWORK_VIEWS: { id: NetworkView; label: string; icon: typeof MapPin }[] = [
  { id: 'topology', label: 'Topología', icon: Network },
  { id: 'tree', label: 'Árbol', icon: Layers },
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

function SiteNode({ site, depth, selectedId, onSelect, onEdit, expanded, onToggle }: any) {
  const isOpen = expanded.has(site.id)
  const hasChildren = site.children?.length > 0
  return (
    <div className="group/node">
      <div
        className={`flex items-center gap-0.5 rounded-lg ${selectedId === site.id ? 'bg-blue-100' : 'hover:bg-surface-raised'}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <button
          type="button"
          onClick={() => onSelect(site)}
          className={`flex-1 flex items-center gap-2 px-2 py-2 text-left text-sm min-w-0 ${selectedId === site.id ? 'text-blue-800' : 'text-ink-soft'}`}
        >
          {hasChildren ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onToggle(site.id) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onToggle(site.id) } }}
              className="p-0.5"
            >
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </span>
          ) : <span className="w-4" />}
          <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
          <span className="truncate font-medium">{site.name}</span>
          <span className="ml-auto text-xs text-gray-400 flex-shrink-0">{site.equipment?.length || 0}</span>
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(site) }}
          className="p-1.5 mr-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg opacity-0 group-hover/node:opacity-100 transition flex-shrink-0"
          title="Editar nodo"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
      {isOpen && site.children?.map((child: any) => (
        <SiteNode key={child.id} site={child} depth={depth + 1} selectedId={selectedId}
          onSelect={onSelect} onEdit={onEdit} expanded={expanded} onToggle={onToggle} />
      ))}
    </div>
  )
}

export default function NetworkManager({ API, onBack, onOpenClient }: Props) {
  const [tree, setTree] = useState<any[]>([])
  const [unassigned, setUnassigned] = useState<any[]>([])
  const [stats, setStats] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [selectedSite, setSelectedSite] = useState<any>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
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

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
    })
  }

  async function loadAll() {
    setLoading(true)
    try {
      const [sitesRes, routersRes, clientsRes] = await Promise.all([
        api().get('/sites'),
        api().get('/routers'),
        api().get('/clients', { params: { page: 1, limit: 200 } }),
      ])
      setTree(sitesRes.data.tree || [])
      setUnassigned(sitesRes.data.unassigned || [])
      setStats(sitesRes.data.stats || {})
      setRouters(routersRes.data || [])
      const clientData = clientsRes.data
      setClients(Array.isArray(clientData) ? clientData : clientData?.items || [])
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    }
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  function toggleExpand(id: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectSite(site: any) {
    setSelectedSite(site)
    setSelectedRouter(null)
    setRouterNetwork(null)
    setRouterPanelTab('subscribers')
    setExpanded(prev => new Set(prev).add(site.id))
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
          <p className="text-sm text-ink-muted">Jerarquía de nodos, routers y antenas — desde aquí ves toda la red</p>
        </div>
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
      ) : (
      <div className="flex-1 flex gap-4 px-6 pb-6 min-h-0">
        {networkView === 'tree' && (
        <aside className="w-72 flex-shrink-0 bg-surface-card rounded-xl border flex flex-col overflow-hidden">
          <div className="p-3 border-b flex justify-between items-center">
            <span className="text-sm font-semibold text-ink-soft">Jerarquía de red</span>
            <button onClick={openCreateSite} className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {tree.length === 0 && !loading && (
              <div className="text-center py-8 text-gray-400 text-sm px-4">
                <Layers className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>Sin sitios. Crea tu primer nodo (ej: Torre Panguipulli)</p>
              </div>
            )}
            {tree.map(site => (
              <SiteNode key={site.id} site={site} depth={0} selectedId={selectedSite?.id}
                onSelect={selectSite} onEdit={openEditSite} expanded={expanded} onToggle={toggleExpand} />
            ))}
          </div>
          {unassigned.length > 0 && (
            <div className="border-t p-2 bg-amber-50 max-h-40 overflow-y-auto">
              <p className="text-xs font-medium text-amber-700 px-2 mb-1">Sin asignar ({unassigned.length})</p>
              {unassigned.map((eq: any) => (
                <div key={eq.id} className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-600">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(eq)}`} />
                  <span className="truncate flex-1" title={eq.name}>{eq.name}</span>
                  {selectedSite && (
                    <button
                      onClick={() => assignToSite(eq.id, selectedSite.id)}
                      className="text-blue-600 hover:text-blue-800 font-medium flex-shrink-0"
                      title={`Asignar a ${selectedSite.name}`}
                    >
                      →
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>
        )}

        {networkView === 'topology' && (
          <div className="flex-1 min-w-0 min-h-[480px] flex flex-col">
            <NetworkTopologyMap
              tree={tree}
              selectedSiteId={selectedSite?.id}
              onSelectSite={selectSite}
              focusSiteId={topologyFocusId}
              onFocusSiteChange={setTopologyFocusId}
            />
          </div>
        )}

        <main className={`flex flex-col gap-4 min-w-0 ${networkView === 'topology' ? 'w-[min(100%,560px)] flex-shrink-0' : 'flex-1'}`}>
          {!selectedSite ? (
            <div className="flex-1 bg-surface-card rounded-xl border flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Radio className="h-16 w-16 mx-auto mb-4 opacity-20" />
                <p className="font-medium">
                  {networkView === 'topology' ? 'Selecciona un nodo en el mapa' : 'Selecciona un sitio o crea uno nuevo'}
                </p>
                <p className="text-sm mt-1">
                  {networkView === 'topology'
                    ? 'Clic en un nodo para entrar y ver routers y antenas · clic en IP para abrir interfaz web'
                    : 'Desde aquí agregas routers, switches y antenas del nodo'}
                </p>
                {networkView === 'topology' && (
                  <button
                    type="button"
                    onClick={() => setNetworkView('tree')}
                    className="mt-4 text-sm text-blue-600 hover:underline"
                  >
                    Ver jerarquía en Árbol →
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="bg-surface-card rounded-xl border p-5 space-y-4">
                <div className={networkView === 'topology' ? 'space-y-3' : 'flex justify-between items-start gap-4'}>
                  <div>
                    <h2 className="text-lg font-bold text-ink flex items-center gap-2">
                      {selectedSite.name}
                      <button
                        type="button"
                        onClick={() => openEditSite(selectedSite)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="Editar nodo"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </h2>
                    <p className="text-sm text-ink-muted mt-0.5">
                      {selectedSite.city || selectedSite.address || SITE_TYPES.find(t => t.value === selectedSite.type)?.label}
                    </p>
                  </div>
                  <div className={`flex flex-wrap gap-2 ${networkView === 'topology' ? '' : 'justify-end'}`}>
                    <button onClick={openRouterModal}
                      className="px-3 py-2 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-200 flex items-center gap-1.5">
                      <Router className="h-4 w-4" /> Router
                    </button>
                    <button onClick={() => {
                      const routers = (selectedSite?.equipment || []).filter((e: any) => e.type === 'router')
                      setEquipForm({
                        ...equipForm,
                        siteId: selectedSite.id,
                        type: 'cpe',
                        brand: 'Ubiquiti',
                        parentId: routers.length === 1 ? routers[0].id : '',
                      })
                      setIpSuggestHint('')
                      setShowEquipForm(true)
                    }}
                      className="px-3 py-2 bg-orange-100 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-200 flex items-center gap-1.5">
                      <Antenna className="h-4 w-4" /> Antena CPE
                    </button>
                    <button onClick={() => { setEquipForm({ ...equipForm, siteId: selectedSite.id, type: 'switch' }); setShowEquipForm(true) }}
                      className="px-3 py-2 bg-surface-raised text-ink-soft rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-1.5">
                      <Server className="h-4 w-4" /> Switch
                    </button>
                  </div>
                </div>
              </div>

              <div className={`grid gap-4 flex-1 min-h-0 ${networkView === 'tree' ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
                {/* Equipos del sitio */}
                <div className="bg-surface-card rounded-xl border flex flex-col overflow-hidden">
                  <div className="px-4 py-3 border-b bg-surface">
                    <h3 className="font-semibold text-gray-800 text-sm">Equipos en este nodo</h3>
                    <p className="text-xs text-ink-muted mt-0.5">Routers, antenas y switches instalados aquí</p>
                  </div>
                  {siteRouters.length === 0 && linkableRouters.length > 0 && (
                    <div className="p-4 border-b bg-amber-50 space-y-3">
                      <p className="text-sm text-amber-900 font-medium">
                        Este nodo no tiene router asignado
                        {siteCpe.length > 0 ? ` (${siteCpe.length} antena(s) sin router local)` : ''}
                      </p>
                      <p className="text-xs text-amber-800">
                        Si el EdgeRouter o MikroTik de este sector está registrado en otro nodo (ej. torre padre), muévelo aquí.
                        Las antenas CPE se vincularán automáticamente.
                      </p>
                      <div className="space-y-2">
                        {linkableRouters.slice(0, 4).map((r: any) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => quickLinkRouter(r.id)}
                            className="w-full flex items-center gap-2 p-2.5 bg-surface-card border border-amber-200 rounded-lg hover:border-purple-400 hover:bg-purple-50 text-left text-sm transition"
                          >
                            <Router className="h-4 w-4 text-purple-600 flex-shrink-0" />
                            <span className="flex-1 min-w-0">
                              <span className="font-medium block truncate">{r.name}</span>
                              <span className="text-xs text-ink-muted">
                                {routerTypeLabel(r)} · {siteNameById(tree, r.siteId)}
                                {r.credentials?.tunnelHostname || r.ipAddress
                                  ? ` · ${r.credentials?.tunnelHostname || r.ipAddress}` : ''}
                              </span>
                            </span>
                            <span className="text-xs font-medium text-purple-700 flex-shrink-0">Mover aquí →</span>
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={openRouterModal}
                        className="text-xs text-purple-700 hover:underline font-medium"
                      >
                        Ver todos los routers disponibles…
                      </button>
                    </div>
                  )}
                  <div className="flex-1 overflow-y-auto divide-y">
                    {siteEquipment.length === 0 ? (
                      <div className="p-6 text-center text-gray-400 text-sm space-y-3">
                        <p>Sin equipos en este nodo</p>
                        {linkableRouters.length > 0 && (
                          <button onClick={openRouterModal}
                            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700">
                            Vincular router existente ({linkableRouters.length})
                          </button>
                        )}
                        {unassignedRouters.length > 0 && !linkableRouters.length && (
                          <p className="text-xs text-amber-600">Hay routers sin nodo en la barra lateral →</p>
                        )}
                      </div>
                    ) : siteEquipment.map((eq: any) => (
                      <div key={eq.id} className="p-4 hover:bg-surface-raised/80 transition-colors">
                        <div className="flex gap-3">
                          <span className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${statusDot(eq)}`} title={eq.status === 'online' ? 'Online' : 'Offline'} />
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold text-ink leading-snug">{eq.name}</p>
                              {eq.type === 'cpe' && (
                                <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full font-medium ${eq.status === 'online' ? 'bg-green-100 text-green-700' : 'bg-surface-raised text-ink-muted'}`}>
                                  {eq.status === 'online' ? 'Online' : 'Offline'}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[11px] px-2 py-0.5 rounded-md bg-surface-raised text-ink-soft font-medium">
                                {eq.type === 'router' ? routerTypeLabel(eq) : (EQUIP_TYPES.find((t) => t.value === eq.type)?.label || eq.type)}
                              </span>
                              {(eq.brand || eq.model) && (
                                <span className="text-xs text-ink-muted">{[eq.brand, eq.model].filter(Boolean).join(' ')}</span>
                              )}
                            </div>
                            {eq.ipAddress ? (
                              <p className="text-xs flex flex-wrap items-center gap-1.5">
                                <span className="text-gray-400">IP</span>
                                <DeviceIpLink
                                  ip={eq.ipAddress}
                                  className="font-mono text-blue-600 hover:underline break-all"
                                  showIcon
                                />
                              </p>
                            ) : (
                              <p className="text-xs text-amber-600">Sin IP asignada</p>
                            )}
                            {eq.type === 'cpe' && eq.clientName && eq.clientId && onOpenClient && (
                              <button
                                type="button"
                                onClick={() => onOpenClient(eq.clientId, 'overview')}
                                className="text-xs text-blue-600 flex items-center gap-1 hover:underline"
                              >
                                <User className="h-3 w-3 shrink-0" /> Abonado: {eq.clientName}
                              </button>
                            )}
                            {eq.type === 'cpe' && eq.clientName && !onOpenClient && (
                              <p className="text-xs text-blue-600 flex items-center gap-1">
                                <User className="h-3 w-3 shrink-0" /> Abonado: {eq.clientName}
                              </p>
                            )}
                            {eq.type === 'cpe' && !eq.clientName && (
                              <p className="text-xs text-amber-600">Sin abonado asignado</p>
                            )}
                            {eq.type === 'cpe' && (() => {
                              const rid = eq.parentId || eq.credentials?.routerId
                              const r = rid ? siteRouters.find((x: any) => x.id === rid) : null
                              return r ? (
                                <p className="text-xs text-ink-muted flex items-center gap-1">
                                  <Router className="h-3 w-3 shrink-0" /> Conectado a {r.name}
                                </p>
                              ) : siteRouters.length > 1 ? (
                                <p className="text-xs text-amber-600">Sin router padre asignado</p>
                              ) : null
                            })()}
                          </div>
                        </div>
                        {eq.type === 'router' && (
                          <div className="mt-3 ml-5 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => openEditRouter(eq)}
                              className="px-3 py-1.5 text-xs border border-line text-ink-soft rounded-lg hover:bg-surface-raised flex items-center gap-1.5"
                            >
                              <Pencil className="h-3.5 w-3.5" /> Editar
                            </button>
                            <button
                              onClick={() => loadRouterNetwork(eq, 'subscribers')}
                              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1.5"
                            >
                              <Eye className="h-3.5 w-3.5" /> Abonados
                            </button>
                            <button
                              onClick={() => loadRouterNetwork(eq, 'infra')}
                              className="px-3 py-1.5 text-xs bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 flex items-center gap-1.5"
                            >
                              <Server className="h-3.5 w-3.5" /> DHCP / Infra
                            </button>
                          </div>
                        )}
                        {eq.type === 'cpe' && (
                          <div className="mt-3 ml-5">
                            <button
                              onClick={() => openEditCpe(eq)}
                              className="px-3 py-1.5 text-xs border border-line text-ink-soft rounded-lg hover:bg-surface-raised flex items-center gap-1.5"
                              title="Editar antena / abonado"
                            >
                              <Pencil className="h-3.5 w-3.5" /> Editar antena
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-surface-card rounded-xl border flex flex-col overflow-hidden min-h-[280px]">
                  <div className="px-4 py-3 border-b bg-surface flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
                        <Wifi className="h-4 w-4 text-green-600 shrink-0" />
                        <span className="truncate">{selectedRouter ? selectedRouter.name : 'Router del nodo'}</span>
                      </h3>
                      {selectedRouter ? (
                        <p className="text-xs text-ink-muted mt-0.5">
                          {routerTypeLabel(selectedRouter)}
                          {routerPanelTab === 'subscribers' ? ' · Colas y PPPoE' : ' · DHCP y SNMP'}
                        </p>
                      ) : (
                        <p className="text-xs text-ink-muted mt-0.5">
                          {siteRouters.length === 0
                            ? 'Vincula un MikroTik o EdgeRouter a este nodo'
                            : 'Elige un router para ver abonados y configuración'}
                        </p>
                      )}
                    </div>
                    {selectedRouter && (
                      <div className="flex gap-1 bg-surface-raised rounded-lg p-0.5">
                        <button onClick={() => loadRouterNetwork(selectedRouter, 'subscribers')}
                          className={`text-xs px-2 py-1 rounded-md ${routerPanelTab === 'subscribers' ? 'bg-surface-card shadow font-medium' : 'text-ink-muted'}`}>
                          Abonados
                        </button>
                        <button onClick={() => loadRouterNetwork(selectedRouter, 'infra')}
                          className={`text-xs px-2 py-1 rounded-md ${routerPanelTab === 'infra' ? 'bg-surface-card shadow font-medium' : 'text-ink-muted'}`}>
                          Infra
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 min-h-0">
                    {!selectedRouter ? (
                      <div className="text-center py-8 text-gray-400 text-sm space-y-3">
                        {siteRouters.length === 0 ? (
                          <>
                            <p>No hay router en este nodo</p>
                            <p className="text-xs text-ink-muted max-w-xs mx-auto">
                              Vincula un EdgeRouter o MikroTik ya registrado, o créalo en <strong>Routers y agentes</strong> y asígnalo aquí.
                            </p>
                            {linkableRouters.length > 0 ? (
                              <button
                                type="button"
                                onClick={openRouterModal}
                                className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700"
                              >
                                Vincular router ({linkableRouters.length})
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={openRouterModal}
                                className="px-4 py-2 border border-purple-300 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-50"
                              >
                                + Agregar router
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            <p className="text-ink-muted">Selecciona un router</p>
                            <p className="text-xs text-gray-400 max-w-xs mx-auto">
                              Abre colas PPPoE, abonados conectados y DHCP del equipo que atiende este nodo.
                            </p>
                          </>
                        )}
                        {siteRouters.length > 0 && (
                          <div className="mt-4 space-y-2 text-left">
                            {siteRouters.map((r: any) => (
                              <button
                                key={r.id}
                                onClick={() => loadRouterNetwork(r)}
                                className="w-full p-4 border rounded-xl hover:border-blue-300 hover:bg-blue-50/50 text-left transition"
                              >
                                <div className="flex items-center gap-3">
                                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDot(r)}`} />
                                  <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-ink">{r.name}</p>
                                    <p className="text-xs text-ink-muted mt-0.5">{routerTypeLabel(r)}</p>
                                    {r.credentials?.tunnelHostname || r.ipAddress ? (
                                      <p className="text-xs font-mono text-blue-600 mt-1 truncate">
                                        {r.credentials?.tunnelHostname || r.ipAddress}
                                      </p>
                                    ) : null}
                                  </div>
                                  <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : routerPanelTab === 'infra' ? (
                      <RouterNetworkConfig
                        API={API}
                        routerId={selectedRouter.id}
                        routerName={selectedRouter.name}
                        siteEquipment={siteEquipment}
                      />
                    ) : routerNetwork?.error ? (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex gap-2">
                        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        {routerNetwork.error}
                      </div>
                    ) : !routerNetwork ? (
                      <div className="text-center py-8"><RefreshCw className="h-6 w-6 animate-spin mx-auto text-blue-500" /></div>
                    ) : (
                      <div className="space-y-5">
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
                          <p className="text-sm text-gray-400 text-center py-4">Sin colas configuradas</p>
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
              </div>
            </>
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
              <h3 className="font-bold text-lg">Editar antena CPE</h3>
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
