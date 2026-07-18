import { useState, useEffect, useCallback } from 'react'
import {
  X, Trash2, RefreshCw, CheckCircle, AlertTriangle, Clock,
  Wifi, Users, ChevronDown, ChevronUp, XCircle, Zap, PlayCircle, Plus,
} from 'lucide-react'
import axios from 'axios'

interface Props {
  API: string
  router: any
  onClose: () => void
}


function QueueBadge({ q, pendingCmds }: { q: any; pendingCmds: any[] }) {
  if (!q) return (
    <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
      Sin queue
    </span>
  )
  const isInQueue = pendingCmds.some((c: any) => c.id === q.cmdId && c.type === 'queue_add')
  const status = isInQueue ? 'pending' : q.status

  if (status === 'active') return (
    <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
      <CheckCircle className="h-3 w-3" /> Activo · {q.iface}
    </span>
  )
  if (status === 'pending') return (
    <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
      <Clock className="h-3 w-3 animate-pulse" /> Pendiente
    </span>
  )
  if (status === 'error') return (
    <span className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
      <AlertTriangle className="h-3 w-3" /> Error
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
      {status}
    </span>
  )
}

export default function EdgeOSManager({ API, router, onClose }: Props) {
  const [tab, setTab] = useState<'networks' | 'subscribers'>('networks')
  const [status, setStatus] = useState<any>(null)
  const [subscribers, setSubscribers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [subLoading, setSubLoading] = useState(false)
  const [expandedCmd, setExpandedCmd] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string>('')
  const [selectedIface, setSelectedIface] = useState<string>('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [showNetForm, setShowNetForm] = useState(false)
  const [netForm, setNetForm] = useState({ iface: 'eth2', ipCidr: '', description: '', dhcp: true, poolStart: '', poolEnd: '' })
  const [netSaving, setNetSaving] = useState(false)
  const [netError, setNetError] = useState('')

  const api = useCallback(() =>
    axios.create({ baseURL: API, headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } }),
  [API])

  const loadStatus = useCallback(async () => {
    try {
      const res = await api().get(`/edgeos/${router.id}/status`)
      setStatus(res.data)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [api, router.id])

  const loadSubscribers = useCallback(async () => {
    setSubLoading(true)
    try {
      const res = await api().get(`/edgeos/${router.id}/subscribers`)
      setSubscribers(res.data)
    } catch { /* silent */ }
    finally { setSubLoading(false) }
  }, [api, router.id])

  useEffect(() => {
    loadStatus()
    loadSubscribers()
    const statusInterval = setInterval(loadStatus, 15000)
    return () => { clearInterval(statusInterval) }
  }, [loadStatus, loadSubscribers])

  // Sincronizar iface seleccionada con la LAN del router
  useEffect(() => {
    if (!selectedIface) {
      const def = status?.lanInterface || router.credentials?.lanInterface || 'eth2'
      setSelectedIface(def)
    }
  }, [status, router.credentials, selectedIface])

  async function createNetwork() {
    const cidr = netForm.ipCidr.trim()
    if (!cidr) { setNetError('IP/CIDR es requerido (ej: 192.168.3.1/24)'); return }
    if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(cidr)) { setNetError('Formato inválido — usa IP/prefijo, ej: 192.168.3.1/24'); return }
    if (!confirm(`¿Aplicar red ${netForm.iface} ${cidr} en el EdgeRouter?`)) return
    setNetSaving(true)
    setNetError('')
    try {
      await api().post(`/edgeos/${router.id}/network`, { ...netForm, confirm: true })
      setShowNetForm(false)
      setNetForm({ iface: 'eth2', ipCidr: '', description: '', dhcp: true, poolStart: '', poolEnd: '' })
      await loadStatus()
    } catch (e: any) {
      setNetError(e.response?.data?.error || 'Error al crear red')
    } finally { setNetSaving(false) }
  }

  async function deleteNetwork(iface: string) {
    if (!confirm(`¿Eliminar interfaz ${iface} y su DHCP del EdgeRouter?`)) return
    setActionLoading(`del-net-${iface}`)
    try {
      await api().delete(`/edgeos/${router.id}/network/${iface}?confirm=true`)
      await loadStatus()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error al eliminar red')
    } finally { setActionLoading('') }
  }

  async function cancelCmd(cmdId: string) {
    setActionLoading(`cancel-${cmdId}`)
    try {
      await api().delete(`/edgeos/${router.id}/queue/${cmdId}`)
      await loadStatus()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error al cancelar comando')
    } finally { setActionLoading('') }
  }

  async function clearQueue() {
    if (!confirm('¿Cancelar todos los comandos pendientes?')) return
    setActionLoading('clear-queue')
    try {
      await api().delete(`/edgeos/${router.id}/queue`)
      await loadStatus()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error al limpiar cola')
    } finally { setActionLoading('') }
  }

  async function provisionSubscriber(serviceId: number) {
    if (!confirm('¿Provisionar cola remota en el EdgeRouter para este abonado?')) return
    setActionLoading(`prov-${serviceId}`)
    try {
      await api().post(`/edgeos/${router.id}/provision/${serviceId}`, { iface: selectedIface, confirm: true })
      await loadSubscribers()
      await loadStatus()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error al provisionar')
    } finally { setActionLoading('') }
  }

  async function deprovisionSubscriber(serviceId: number) {
    if (!confirm('¿Eliminar la queue de este abonado del EdgeRouter? El tráfico quedará sin límite hasta que se vuelva a aplicar.')) return
    setActionLoading(`deprov-${serviceId}`)
    try {
      await api().delete(`/edgeos/${router.id}/provision/${serviceId}?confirm=true`)
      await loadSubscribers()
      await loadStatus()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error al eliminar queue')
    } finally { setActionLoading('') }
  }

  async function applyAllQueues() {
    const without = subscribers.filter(s => !s.edgeosQueue && s.ipAddress)
    if (!without.length) return
    if (!confirm(`¿Aplicar queue a ${without.length} abonados sin queue en interfaz ${selectedIface}?`)) return
    setBulkLoading(true)
    for (const s of without) {
      try {
        await api().post(`/edgeos/${router.id}/provision/${s.serviceId}`, { iface: selectedIface, confirm: true })
      } catch { /* continuar con el siguiente */ }
    }
    await loadSubscribers()
    await loadStatus()
    setBulkLoading(false)
  }

  const pendingCmds = status?.pendingCmds || []
  const lanIface = selectedIface || status?.lanInterface || router.credentials?.lanInterface || 'eth2'

  // Interfaces disponibles: redes configuradas + eth conocidas
  const availableIfaces = status?.networks?.length
    ? status.networks.map((n: any) => ({ iface: n.iface, label: `${n.iface} · ${n.ipCidr}` }))
    : ['eth0', 'eth1', 'eth2', 'eth3', 'switch0'].map(i => ({ iface: i, label: i }))

  // Stats abonados
  const totalSubs = subscribers.length
  const withQueue = subscribers.filter(s => s.edgeosQueue?.status === 'active').length
  const pending = subscribers.filter(s => {
    const isInQueue = pendingCmds.some((c: any) => c.id === s.edgeosQueue?.cmdId)
    return s.edgeosQueue?.status === 'pending' || isInQueue
  }).length
  const withError = subscribers.filter(s => s.edgeosQueue?.status === 'error').length
  const withoutQueue = subscribers.filter(s => !s.edgeosQueue && s.ipAddress).length

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-3xl shadow-2xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${status?.connected ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
            <div>
              <h2 className="font-bold text-gray-900">EdgeOS — {router.name}</h2>
              <p className="text-xs text-gray-400">
                {status?.connected ? 'Conectado' : 'Sin conexión'}
                {status?.lastHeartbeat ? ` · último heartbeat ${new Date(status.lastHeartbeat).toLocaleTimeString('es-CL')}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadStatus} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
              <RefreshCw className="h-4 w-4" />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-6 shrink-0">
          <button onClick={() => setTab('networks')}
            className={`pb-3 pt-2 px-1 mr-6 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${tab === 'networks' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            <Wifi className="h-3.5 w-3.5" /> Redes ({status?.networks?.length ?? 0})
          </button>
          <button onClick={() => { setTab('subscribers'); loadSubscribers() }}
            className={`pb-3 pt-2 px-1 mr-6 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${tab === 'subscribers' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            <Users className="h-3.5 w-3.5" /> Simple Queue ({totalSubs})
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Cargando…
            </div>
          ) : tab === 'networks' ? (
            <div className="space-y-4">
              {/* Alert primera conexión */}
              {!status?.lastHeartbeat ? (
                <div className="flex gap-2 items-start bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
                  <div>
                    <p className="font-medium">Esperando primera conexión</p>
                    <p className="mt-0.5 text-blue-700">Instala el agente en el EdgeRouter usando el script de instalación del panel principal.</p>
                  </div>
                </div>
              ) : !status?.connected ? (
                <div className="flex gap-2 items-start bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>El EdgeRouter no está enviando heartbeat. Los comandos se encolarán y se ejecutarán cuando recupere la conexión.</span>
                </div>
              ) : null}

              {/* Redes configuradas */}
              {(status?.networks || []).length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase text-gray-400 mb-2">Interfaces configuradas</h3>
                  <div className="space-y-2">
                    {status.networks.map((net: any) => (
                      <div key={net.iface} className="flex items-center justify-between bg-slate-50 rounded-lg px-4 py-3 border border-slate-100">
                        <div className="flex items-center gap-3">
                          <Wifi className="h-4 w-4 text-emerald-500 shrink-0" />
                          <div>
                            <p className="text-sm font-semibold text-gray-800">{net.iface} — <span className="font-mono">{net.ipCidr}</span></p>
                            {net.description && <p className="text-xs text-gray-400">{net.description}</p>}
                            <p className="text-xs text-gray-400 mt-0.5">
                              {net.dhcp ? `DHCP ${net.poolStart}–${net.poolEnd}` : 'Sin DHCP'}
                            </p>
                          </div>
                        </div>
                        <button onClick={() => deleteNetwork(net.iface)} disabled={actionLoading === `del-net-${net.iface}`}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition disabled:opacity-50">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Nueva red / interfaz */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase text-gray-400">Agregar interfaz</h3>
                  <button
                    onClick={() => { setShowNetForm(v => !v); setNetError('') }}
                    className="flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900 font-medium">
                    <Plus className="h-3.5 w-3.5" /> {showNetForm ? 'Cancelar' : 'Nueva red'}
                  </button>
                </div>
                {showNetForm && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 space-y-3">
                    {/* Fila 1: iface + ip/cidr */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Interfaz</label>
                        <select
                          value={netForm.iface}
                          onChange={e => setNetForm(f => ({ ...f, iface: e.target.value }))}
                          className="w-full text-xs border rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono">
                          {['eth0','eth1','eth2','eth3','eth4','switch0','vtun0','pppoe0'].map(i => (
                            <option key={i} value={i}>{i}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">IP / Prefijo</label>
                        <input
                          type="text"
                          placeholder="192.168.3.1/24"
                          value={netForm.ipCidr}
                          onChange={e => setNetForm(f => ({ ...f, ipCidr: e.target.value }))}
                          className="w-full text-xs border rounded-lg px-2 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                      </div>
                    </div>
                    {/* Descripción */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Descripción (opcional)</label>
                      <input
                        type="text"
                        placeholder="Ej: Red clientes zona norte"
                        value={netForm.description}
                        onChange={e => setNetForm(f => ({ ...f, description: e.target.value }))}
                        className="w-full text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                    </div>
                    {/* DHCP toggle */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setNetForm(f => ({ ...f, dhcp: !f.dhcp }))}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${netForm.dhcp ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${netForm.dhcp ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                      <span className="text-xs font-medium text-gray-700">Habilitar servidor DHCP</span>
                    </div>
                    {/* Pool DHCP (solo si dhcp=true) */}
                    {netForm.dhcp && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Pool inicio</label>
                          <input
                            type="text"
                            placeholder="192.168.3.10"
                            value={netForm.poolStart}
                            onChange={e => setNetForm(f => ({ ...f, poolStart: e.target.value }))}
                            className="w-full text-xs border rounded-lg px-2 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Pool fin</label>
                          <input
                            type="text"
                            placeholder="192.168.3.254"
                            value={netForm.poolEnd}
                            onChange={e => setNetForm(f => ({ ...f, poolEnd: e.target.value }))}
                            className="w-full text-xs border rounded-lg px-2 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                        </div>
                      </div>
                    )}
                    {netError && (
                      <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">{netError}</p>
                    )}
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => { setShowNetForm(false); setNetError('') }}
                        className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100">
                        Cancelar
                      </button>
                      <button
                        onClick={createNetwork}
                        disabled={netSaving}
                        className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition">
                        {netSaving
                          ? <><RefreshCw className="h-3 w-3 animate-spin" /> Creando…</>
                          : <><Plus className="h-3 w-3" /> Crear red</>}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Cola de comandos */}
              {(status?.pendingCmds?.length > 0 || status?.cmdHistory?.length > 0) && (
                <div>
                  <div className="flex items-center justify-between mb-2 mt-2">
                    <h3 className="text-xs font-semibold uppercase text-gray-400">Actividad de comandos</h3>
                    {status.pendingCmds?.length > 0 && (
                      <button onClick={clearQueue} disabled={actionLoading === 'clear-queue'}
                        className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 disabled:opacity-50">
                        <XCircle className="h-3.5 w-3.5" />
                        {actionLoading === 'clear-queue' ? 'Limpiando…' : 'Limpiar cola'}
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {status.pendingCmds?.map((c: any) => {
                      const isRetry = (c.retries || 0) > 0
                      const nextRetry = c.nextRetryAt ? new Date(c.nextRetryAt) : null
                      return (
                        <div key={c.id} className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 border ${isRetry ? 'bg-orange-50 border-orange-100' : 'bg-amber-50 border-amber-100'}`}>
                          <Clock className={`h-3.5 w-3.5 shrink-0 ${isRetry ? 'text-orange-500' : 'text-amber-500'}`} />
                          <span className={`font-medium ${isRetry ? 'text-orange-800' : 'text-amber-800'}`}>{c.type}</span>
                          {isRetry && <span className="text-orange-500">intento {c.retries}/{c.maxRetries}</span>}
                          <span className={`${isRetry ? 'text-orange-600' : 'text-amber-600'}`}>
                            {nextRetry ? `reintento ${nextRetry.toLocaleTimeString('es-CL')}` : 'pendiente'}
                          </span>
                          <button onClick={() => cancelCmd(c.id)} disabled={actionLoading === `cancel-${c.id}`}
                            className="ml-auto text-gray-400 hover:text-red-500 disabled:opacity-50"
                            title="Cancelar este comando">
                            {actionLoading === `cancel-${c.id}` ? '…' : <XCircle className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      )
                    })}
                    {status.cmdHistory?.slice(0, 10).map((c: any) => (
                      <div key={c.id}>
                        <button onClick={() => setExpandedCmd(expandedCmd === c.id ? null : c.id)}
                          className={`w-full flex items-center gap-2 text-xs rounded-lg px-3 py-2 border text-left transition ${c.status === 'done' ? 'bg-green-50 border-green-100' : c.status === 'cancelled' ? 'bg-gray-50 border-gray-200' : 'bg-red-50 border-red-100'}`}>
                          {c.status === 'done'
                            ? <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                            : c.status === 'cancelled'
                              ? <XCircle className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                              : <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                          <span className={`font-medium ${c.status === 'done' ? 'text-green-800' : c.status === 'cancelled' ? 'text-gray-500 line-through' : 'text-red-800'}`}>{c.type}</span>
                          <span className="text-gray-400 ml-auto">{c.status === 'cancelled' ? 'cancelado' : c.executedAt ? new Date(c.executedAt).toLocaleTimeString('es-CL') : ''}</span>
                          {expandedCmd === c.id ? <ChevronUp className="h-3 w-3 text-gray-400" /> : <ChevronDown className="h-3 w-3 text-gray-400" />}
                        </button>
                        {expandedCmd === c.id && c.output && (
                          <pre className="text-xs bg-gray-900 text-green-300 rounded-b-lg px-3 py-2 font-mono whitespace-pre-wrap border-x border-b border-gray-700">{c.output}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

          ) : (
            /* ===== TAB SIMPLE QUEUE ===== */
            <div className="space-y-4">

              {/* Stats resumen */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Total', value: totalSubs, color: 'text-gray-700', bg: 'bg-gray-50 border-gray-200' },
                  { label: 'Activos', value: withQueue, color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
                  { label: 'Pendientes', value: pending, color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
                  { label: 'Sin queue', value: withoutQueue, color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200' },
                ].map(s => (
                  <div key={s.label} className={`rounded-lg border px-3 py-2 text-center ${s.bg}`}>
                    <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-[10px] text-gray-500 font-medium">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Selector de interfaz + acción masiva */}
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
                <span className="text-xs font-medium text-gray-600 shrink-0">Interfaz de aplicación:</span>
                <select
                  value={selectedIface}
                  onChange={e => setSelectedIface(e.target.value)}
                  className="flex-1 text-xs border rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono">
                  {availableIfaces.map((i: any) => (
                    <option key={i.iface} value={i.iface}>{i.label}</option>
                  ))}
                </select>
                {withoutQueue > 0 && (
                  <button
                    onClick={applyAllQueues}
                    disabled={bulkLoading || !status?.connected}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 shrink-0 transition">
                    {bulkLoading
                      ? <><RefreshCw className="h-3 w-3 animate-spin" /> Aplicando…</>
                      : <><Zap className="h-3 w-3" /> Aplicar a {withoutQueue}</>}
                  </button>
                )}
              </div>

              {withError > 0 && (
                <div className="flex gap-2 items-start bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{withError} abonado{withError > 1 ? 's' : ''} con error — verifica el historial de comandos en la pestaña Redes y vuelve a aplicar la queue.</span>
                </div>
              )}

              {subLoading ? (
                <div className="flex items-center justify-center py-10 text-gray-400">
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Cargando…
                </div>
              ) : subscribers.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>No hay abonados asignados a este nodo.</p>
                  <p className="text-xs mt-1">Asigna servicios a este router desde el panel de Clientes.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {subscribers.map((s: any) => {
                    const hasQ = !!s.edgeosQueue
                    const isInQueue = pendingCmds.some((c: any) => c.id === s.edgeosQueue?.cmdId)
                    const isActive = s.edgeosQueue?.status === 'active'
                    return (
                      <div key={s.serviceId}
                        className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition ${isActive ? 'bg-white border-emerald-200 hover:border-emerald-300' : hasQ ? 'bg-white border-amber-100' : 'bg-white border-gray-100 hover:border-gray-200'}`}>

                        {/* Estado visual izquierda */}
                        <div className={`w-1.5 self-stretch rounded-full shrink-0 ${isActive ? 'bg-emerald-400' : isInQueue || s.edgeosQueue?.status === 'pending' ? 'bg-amber-400 animate-pulse' : s.edgeosQueue?.status === 'error' ? 'bg-red-400' : 'bg-gray-200'}`} />

                        {/* Info abonado */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-gray-800 truncate">{s.fullName}</p>
                            <QueueBadge q={s.edgeosQueue} pendingCmds={pendingCmds} />
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {s.ipAddress
                              ? <span className="font-mono text-xs text-gray-500">{s.ipAddress}</span>
                              : <span className="text-xs text-red-500 font-medium">⚠ Sin IP — asigna una IP para poder aplicar queue</span>}
                            {s.ipAddress && <>
                              <span className="text-gray-300">·</span>
                              <span className="text-xs text-gray-500">{s.planName}</span>
                              <span className="text-gray-300">·</span>
                              <span className="text-xs font-medium text-emerald-600">↓{s.downloadSpeed}M ↑{s.uploadSpeed}M</span>
                            </>}
                          </div>
                          {isActive && s.edgeosQueue?.appliedAt && (
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              Aplicado {new Date(s.edgeosQueue.appliedAt).toLocaleString('es-CL')} · clase {s.edgeosQueue.classId}
                            </p>
                          )}
                        </div>

                        {/* Acciones */}
                        <div className="flex items-center gap-2 shrink-0">
                          {hasQ ? (
                            <button
                              onClick={() => deprovisionSubscriber(s.serviceId)}
                              disabled={actionLoading === `deprov-${s.serviceId}`}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-40"
                              title="Eliminar queue de este abonado">
                              {actionLoading === `deprov-${s.serviceId}`
                                ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          ) : (
                            <button
                              onClick={() => provisionSubscriber(s.serviceId)}
                              disabled={!s.ipAddress || actionLoading === `prov-${s.serviceId}` || !status?.connected}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition"
                              title={!s.ipAddress ? 'Asigna una IP al abonado primero' : !status?.connected ? 'Router sin conexión' : `Aplicar queue en ${lanIface}`}>
                              {actionLoading === `prov-${s.serviceId}`
                                ? <><RefreshCw className="h-3 w-3 animate-spin" /> Encolando…</>
                                : <><PlayCircle className="h-3 w-3" /> Aplicar queue</>}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <p className="text-[10px] text-gray-400 text-center pt-2">
                Queues usando traffic-policy shaper/limiter de Vyatta · Las políticas se aplican en ≤ 30 s cuando el router está conectado
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
