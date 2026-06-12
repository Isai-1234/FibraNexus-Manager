import { useState, useEffect } from 'react'
import {
  ArrowLeft, Plus, RefreshCw, X, MapPin, Radio, Router, Server,
  ChevronRight, ChevronDown, Wifi, CheckCircle, AlertTriangle, Eye,
  Layers, Antenna, Network
} from 'lucide-react'
import axios from 'axios'

interface Props { API: string; onBack: () => void }

const SITE_TYPES = [
  { value: 'pop', label: 'POP / Central' },
  { value: 'tower', label: 'Torre / Nodo' },
  { value: 'node', label: 'Nodo secundario' },
  { value: 'office', label: 'Oficina' },
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

function SiteNode({ site, depth, selectedId, onSelect, expanded, onToggle }: any) {
  const isOpen = expanded.has(site.id)
  const hasChildren = site.children?.length > 0
  return (
    <div>
      <button
        onClick={() => onSelect(site)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition ${selectedId === site.id ? 'bg-blue-100 text-blue-800' : 'hover:bg-gray-100 text-gray-700'}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {hasChildren ? (
          <span onClick={(e) => { e.stopPropagation(); onToggle(site.id) }} className="p-0.5">
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        ) : <span className="w-4" />}
        <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
        <span className="truncate font-medium">{site.name}</span>
        <span className="ml-auto text-xs text-gray-400">{site.equipment?.length || 0}</span>
      </button>
      {isOpen && site.children?.map((child: any) => (
        <SiteNode key={child.id} site={child} depth={depth + 1} selectedId={selectedId}
          onSelect={onSelect} expanded={expanded} onToggle={onToggle} />
      ))}
    </div>
  )
}

export default function NetworkManager({ API, onBack }: Props) {
  const [tree, setTree] = useState<any[]>([])
  const [unassigned, setUnassigned] = useState<any[]>([])
  const [stats, setStats] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [selectedSite, setSelectedSite] = useState<any>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [showSiteForm, setShowSiteForm] = useState(false)
  const [showEquipForm, setShowEquipForm] = useState(false)
  const [showRouterModal, setShowRouterModal] = useState(false)
  const [routerModalTab, setRouterModalTab] = useState<'link' | 'create'>('link')
  const [linkRouterId, setLinkRouterId] = useState<number | ''>('')
  const [siteForm, setSiteForm] = useState<any>({ type: 'node' })
  const [equipForm, setEquipForm] = useState<any>({ type: 'cpe', brand: 'Ubiquiti' })
  const [routerNetwork, setRouterNetwork] = useState<any>(null)
  const [selectedRouter, setSelectedRouter] = useState<any>(null)
  const [routers, setRouters] = useState<any[]>([])

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
    })
  }

  async function loadAll() {
    setLoading(true)
    try {
      const [sitesRes, routersRes] = await Promise.all([
        api().get('/sites'),
        api().get('/routers'),
      ])
      setTree(sitesRes.data.tree || [])
      setUnassigned(sitesRes.data.unassigned || [])
      setStats(sitesRes.data.stats || {})
      setRouters(routersRes.data || [])
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
    setExpanded(prev => new Set(prev).add(site.id))
  }

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
      setShowSiteForm(false)
      setSiteForm({ type: 'node' })
      loadAll()
    } catch (e: any) { alert(e.response?.data?.error || e.message) }
  }

  async function createEquipment() {
    try {
      await api().post('/sites/equipment', {
        ...equipForm,
        siteId: equipForm.siteId || selectedSite?.id,
      })
      setShowEquipForm(false)
      setEquipForm({ type: 'cpe', brand: 'Ubiquiti' })
      await refreshSelectedSite()
      loadAll()
    } catch (e: any) { alert(e.response?.data?.error || e.message) }
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
    await assignToSite(Number(linkRouterId), selectedSite.id)
    setShowRouterModal(false)
    setLinkRouterId('')
  }

  function openRouterModal() {
    const linkable = routers.filter((r) => r.siteId !== selectedSite?.id)
    setRouterModalTab(linkable.length > 0 ? 'link' : 'create')
    setLinkRouterId(linkable.length === 1 ? linkable[0].id : '')
    setEquipForm({ ...equipForm, siteId: selectedSite?.id, type: 'router', brand: 'MikroTik' })
    setShowRouterModal(true)
  }

  async function loadRouterNetwork(router: any) {
    setSelectedRouter(router)
    setRouterNetwork(null)
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
  const linkableRouters = routers.filter((r) => r.siteId !== selectedSite?.id)
  const unassignedRouters = unassigned.filter((e) => e.type === 'router')

  return (
    <div className="flex-1 flex flex-col bg-gray-50 min-h-screen">
      <header className="bg-white border-b px-6 py-4 flex items-center gap-4 sticky top-0 z-10">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft className="h-5 w-5" /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Network className="h-5 w-5 text-blue-600" /> Red ISP — Sitios y nodos
          </h1>
          <p className="text-sm text-gray-500">Organiza torres, routers MikroTik, switches y antenas Ubiquiti</p>
        </div>
        <button onClick={loadAll} className="p-2 hover:bg-gray-100 rounded-lg" title="Actualizar">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-4">
        {[
          { label: 'Sitios / nodos', value: stats.sites || 0, icon: MapPin, color: 'text-blue-600' },
          { label: 'Routers', value: stats.routers || 0, icon: Router, color: 'text-purple-600' },
          { label: 'Online', value: stats.online || 0, icon: Wifi, color: 'text-green-600' },
          { label: 'CPE / antenas', value: stats.cpe || 0, icon: Antenna, color: 'text-orange-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border p-4 flex items-center gap-3">
            <s.icon className={`h-8 w-8 ${s.color} opacity-80`} />
            <div>
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex-1 flex gap-4 px-6 pb-6 min-h-0">
        {/* Árbol sitios */}
        <aside className="w-72 flex-shrink-0 bg-white rounded-xl border flex flex-col overflow-hidden">
          <div className="p-3 border-b flex justify-between items-center">
            <span className="text-sm font-semibold text-gray-700">Jerarquía de red</span>
            <button onClick={() => setShowSiteForm(true)} className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
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
                onSelect={selectSite} expanded={expanded} onToggle={toggleExpand} />
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

        {/* Detalle sitio */}
        <main className="flex-1 flex flex-col gap-4 min-w-0">
          {!selectedSite ? (
            <div className="flex-1 bg-white rounded-xl border flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Radio className="h-16 w-16 mx-auto mb-4 opacity-20" />
                <p className="font-medium">Selecciona un sitio o crea uno nuevo</p>
                <p className="text-sm mt-1">Desde aquí agregas routers, switches y antenas del nodo</p>
              </div>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-xl border p-5">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">{selectedSite.name}</h2>
                    <p className="text-sm text-gray-500">{selectedSite.city || selectedSite.address || SITE_TYPES.find(t => t.value === selectedSite.type)?.label}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={openRouterModal}
                      className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-200 flex items-center gap-1">
                      <Router className="h-3.5 w-3.5" /> Router
                    </button>
                    <button onClick={() => { setEquipForm({ ...equipForm, siteId: selectedSite.id, type: 'cpe', brand: 'Ubiquiti' }); setShowEquipForm(true) }}
                      className="px-3 py-1.5 bg-orange-100 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-200 flex items-center gap-1">
                      <Antenna className="h-3.5 w-3.5" /> Antena CPE
                    </button>
                    <button onClick={() => { setEquipForm({ ...equipForm, siteId: selectedSite.id, type: 'switch' }); setShowEquipForm(true) }}
                      className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-1">
                      <Server className="h-3.5 w-3.5" /> Switch
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
                {/* Equipos del sitio */}
                <div className="bg-white rounded-xl border flex flex-col overflow-hidden">
                  <div className="p-4 border-b font-semibold text-gray-800">Equipos en este nodo</div>
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
                      <div key={eq.id} className="p-4 flex items-center gap-3 hover:bg-gray-50">
                        <span className={`w-3 h-3 rounded-full flex-shrink-0 ${statusDot(eq)}`} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">{eq.name}</p>
                          <p className="text-xs text-gray-500">{eq.type} · {eq.brand} {eq.model} · {eq.ipAddress || 'sin IP'}</p>
                        </div>
                        {eq.type === 'router' && (
                          <button onClick={() => loadRouterNetwork(eq)}
                            className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100 flex items-center gap-1">
                            <Eye className="h-3 w-3" /> PPPoE
                          </button>
                        )}
                        {eq.type === 'cpe' && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${eq.status === 'online' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {eq.status === 'online' ? 'Online' : 'Offline'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Vista router PPPoE / queues */}
                <div className="bg-white rounded-xl border flex flex-col overflow-hidden">
                  <div className="p-4 border-b font-semibold text-gray-800 flex items-center gap-2">
                    <Wifi className="h-4 w-4 text-green-600" />
                    {selectedRouter ? `Red — ${selectedRouter.name}` : 'PPPoE y Simple Queues'}
                  </div>
                  <div className="flex-1 overflow-y-auto p-4">
                    {!selectedRouter ? (
                      <div className="text-center py-8 text-gray-400 text-sm">
                        {siteRouters.length === 0
                          ? 'Agrega un router MikroTik a este nodo (o usa Gestión Routers para el wizard completo)'
                          : 'Haz clic en "PPPoE" en un router para ver usuarios y colas'}
                        {siteRouters.length > 0 && (
                          <div className="mt-4 space-y-2">
                            {siteRouters.map((r: any) => (
                              <button key={r.id} onClick={() => loadRouterNetwork(r)}
                                className="block w-full p-3 border rounded-lg hover:bg-gray-50 text-left">
                                <span className={`inline-block w-2 h-2 rounded-full mr-2 ${statusDot(r)}`} />
                                {r.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : routerNetwork?.error ? (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex gap-2">
                        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        {routerNetwork.error}
                      </div>
                    ) : !routerNetwork ? (
                      <div className="text-center py-8"><RefreshCw className="h-6 w-6 animate-spin mx-auto text-blue-500" /></div>
                    ) : (
                      <div className="space-y-4">
                        <div>
                          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">PPPoE activos ({routerNetwork.pppoeActive?.filter((a: any) => a.name)?.length || 0})</h3>
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {(routerNetwork.pppoeActive || []).filter((a: any) => a.name).map((a: any) => (
                              <div key={a['.id'] || a.name} className="flex items-center gap-2 text-sm bg-green-50 rounded px-2 py-1">
                                <CheckCircle className="h-3 w-3 text-green-600" />
                                <span className="font-mono">{a.name}</span>
                                <span className="text-xs text-gray-400 ml-auto">{a.address}</span>
                              </div>
                            ))}
                            {!(routerNetwork.pppoeActive || []).some((a: any) => a.name) && (
                              <p className="text-xs text-gray-400">Ningún cliente conectado por PPPoE</p>
                            )}
                          </div>
                        </div>
                        <div>
                          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Secrets PPPoE ({routerNetwork.pppoeSecrets?.length || 0})</h3>
                          <div className="space-y-1 max-h-40 overflow-y-auto">
                            {(routerNetwork.pppoeSecrets || []).slice(0, 20).map((s: any) => (
                              <div key={s['.id']} className="flex items-center gap-2 text-xs border rounded px-2 py-1">
                                <span className={`w-2 h-2 rounded-full ${s.disabled === 'true' ? 'bg-red-400' : 'bg-green-400'}`} />
                                <span className="font-mono">{s.name}</span>
                                <span className="text-gray-400 ml-auto">{s.profile}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Simple Queues ({routerNetwork.simpleQueues?.length || 0})</h3>
                          <div className="space-y-1 max-h-40 overflow-y-auto">
                            {(routerNetwork.simpleQueues || []).slice(0, 20).map((q: any) => (
                              <div key={q['.id']} className="flex items-center gap-2 text-xs border rounded px-2 py-1">
                                <span className="font-mono truncate">{q.name}</span>
                                <span className="text-gray-500 ml-auto">{q['max-limit']}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {/* Modal sitio */}
      {showSiteForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
            <div className="flex justify-between mb-4">
              <h3 className="font-bold text-lg">Nuevo sitio / nodo</h3>
              <button onClick={() => setShowSiteForm(false)}><X className="h-5 w-5" /></button>
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
                <label className="text-sm font-medium">Ciudad</label>
                <input className="w-full border rounded-lg px-3 py-2 mt-1" value={siteForm.city || ''}
                  onChange={e => setSiteForm({ ...siteForm, city: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Dirección</label>
                <input className="w-full border rounded-lg px-3 py-2 mt-1" value={siteForm.address || ''}
                  onChange={e => setSiteForm({ ...siteForm, address: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowSiteForm(false)} className="flex-1 py-2 border rounded-lg">Cancelar</button>
              <button onClick={createSite} className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Crear</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal vincular / crear router */}
      {showRouterModal && selectedSite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
            <div className="flex justify-between mb-4">
              <h3 className="font-bold text-lg">Router en {selectedSite.name}</h3>
              <button onClick={() => setShowRouterModal(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4">
              <button
                onClick={() => setRouterModalTab('link')}
                className={`flex-1 py-2 rounded-md text-sm font-medium ${routerModalTab === 'link' ? 'bg-white shadow text-purple-700' : 'text-gray-500'}`}
              >
                Vincular existente
              </button>
              <button
                onClick={() => setRouterModalTab('create')}
                className={`flex-1 py-2 rounded-md text-sm font-medium ${routerModalTab === 'create' ? 'bg-white shadow text-purple-700' : 'text-gray-500'}`}
              >
                Crear nuevo
              </button>
            </div>
            {routerModalTab === 'link' ? (
              <div className="space-y-4">
                {linkableRouters.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No hay routers disponibles. Créalos en <strong>Gestión Routers</strong> o usa la pestaña Crear nuevo.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-gray-500">Selecciona un router ya registrado en tu ISP (ej. L009 con túnel Cloudflare):</p>
                    <select
                      className="w-full border rounded-lg px-3 py-2 bg-white"
                      value={linkRouterId}
                      onChange={(e) => setLinkRouterId(e.target.value ? Number(e.target.value) : '')}
                    >
                      <option value="">Elegir router…</option>
                      {linkableRouters.map((r: any) => (
                        <option key={r.id} value={r.id}>
                          {r.name} — {r.credentials?.tunnelHostname || r.ipAddress || 'sin host'}
                          {r.siteId ? ' (en otro nodo)' : ' (sin nodo)'}
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
                <p className="text-xs text-gray-500">
                  Para MikroTik con túnel Cloudflare y scripts, usa <strong>Gestión Routers</strong> y luego vincúlalo aquí.
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
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
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
                  onChange={e => setEquipForm({ ...equipForm, type: e.target.value })}>
                  {EQUIP_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
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
                <input className="w-full border rounded-lg px-3 py-2 mt-1" value={equipForm.ipAddress || ''}
                  onChange={e => setEquipForm({ ...equipForm, ipAddress: e.target.value })} />
              </div>
              {equipForm.type === 'cpe' && (
                <div>
                  <label className="text-sm font-medium">MAC antena</label>
                  <input className="w-full border rounded-lg px-3 py-2 mt-1 font-mono" placeholder="AA:BB:CC:DD:EE:FF"
                    value={equipForm.macAddress || ''} onChange={e => setEquipForm({ ...equipForm, macAddress: e.target.value })} />
                </div>
              )}
              <p className="text-xs text-gray-500">
                {equipForm.type === 'router'
                  ? 'Para MikroTik completo con túnel Cloudflare, usa también "Gestión Routers" del menú.'
                  : equipForm.type === 'cpe'
                    ? 'Estado online vía SNMP/UISP — próxima fase. Por ahora se registra en el nodo.'
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
    </div>
  )
}
