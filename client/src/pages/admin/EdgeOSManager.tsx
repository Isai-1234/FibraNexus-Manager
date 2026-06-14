import { useState, useEffect, useCallback } from 'react'
import { X, Trash2, RefreshCw, CheckCircle, AlertTriangle, Clock, Wifi, Users, ChevronDown, ChevronUp, XCircle, Activity } from 'lucide-react'
import axios from 'axios'

interface Props {
  API: string
  router: any
  onClose: () => void
}

const INTERFACES = ['eth0', 'eth1', 'eth2', 'eth3', 'eth4', 'switch0']

function fmtBps(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`
  return `${bps} bps`
}

export default function EdgeOSManager({ API, router, onClose }: Props) {
  const [tab, setTab] = useState<'networks' | 'subscribers'>('networks')
  const [status, setStatus] = useState<any>(null)
  const [bandwidth, setBandwidth] = useState<any>(null)
  const [subscribers, setSubscribers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [subLoading, setSubLoading] = useState(false)
  const [expandedCmd, setExpandedCmd] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string>('')

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

  const loadBandwidth = useCallback(async () => {
    try {
      const res = await api().get(`/edgeos/${router.id}/bandwidth`)
      setBandwidth(res.data)
    } catch { /* silent */ }
  }, [api, router.id])

  useEffect(() => {
    loadStatus()
    loadSubscribers()
    loadBandwidth()
    const interval = setInterval(loadStatus, 15000)
    const bwInterval = setInterval(loadBandwidth, 28000)
    return () => { clearInterval(interval); clearInterval(bwInterval) }
  }, [loadStatus, loadSubscribers, loadBandwidth])

  async function deleteNetwork(iface: string) {
    if (!confirm(`¿Eliminar interfaz ${iface} y su DHCP del EdgeRouter?`)) return
    setActionLoading(`del-net-${iface}`)
    try {
      await api().delete(`/edgeos/${router.id}/network/${iface}`)
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

  async function provisionSubscriber(serviceId: number, iface: string) {
    setActionLoading(`prov-${serviceId}`)
    try {
      await api().post(`/edgeos/${router.id}/provision/${serviceId}`, { iface })
      await loadSubscribers()
      await loadStatus()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error al provisionar')
    } finally { setActionLoading('') }
  }

  async function deprovisionSubscriber(serviceId: number) {
    if (!confirm('¿Eliminar queue de este abonado del EdgeRouter?')) return
    setActionLoading(`deprov-${serviceId}`)
    try {
      await api().delete(`/edgeos/${router.id}/provision/${serviceId}`)
      await loadSubscribers()
      await loadStatus()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error al eliminar queue')
    } finally { setActionLoading('') }
  }

  function queueStatusBadge(q: any) {
    if (!q) return <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Sin queue</span>
    const colors: Record<string, string> = { pending: 'bg-amber-100 text-amber-700', active: 'bg-green-100 text-green-700', error: 'bg-red-100 text-red-700' }
    return <span className={`text-xs px-2 py-0.5 rounded-full ${colors[q.status] || 'bg-gray-100 text-gray-500'}`}>{q.status}</span>
  }

  const lanIface = status?.lanInterface || router.credentials?.lanInterface || 'eth2'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-3xl shadow-2xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${status?.connected ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
            <div>
              <h2 className="font-bold text-gray-900">EdgeOS — {router.name}</h2>
              <p className="text-xs text-gray-400">{status?.connected ? 'Conectado' : 'Sin conexión'}{status?.lastHeartbeat ? ` · último heartbeat ${new Date(status.lastHeartbeat).toLocaleTimeString('es-CL')}` : ''}</p>
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
          <button onClick={() => setTab('subscribers')}
            className={`pb-3 pt-2 px-1 mr-6 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${tab === 'subscribers' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            <Users className="h-3.5 w-3.5" /> Abonados ({subscribers.length})
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mr-2" /> Cargando…</div>
          ) : tab === 'networks' ? (
            <div className="space-y-4">
              {/* Alert primera conexión / sin heartbeat */}
              {!status?.lastHeartbeat ? (
                <div className="flex gap-2 items-start bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
                  <div>
                    <p className="font-medium">Esperando primera conexión</p>
                    <p className="mt-0.5 text-blue-700">Instala el agente en el EdgeRouter usando el script de instalación del panel principal. Una vez conectado, podrás gestionar las redes desde aquí.</p>
                  </div>
                </div>
              ) : !status?.connected ? (
                <div className="flex gap-2 items-start bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>El EdgeRouter no está enviando heartbeat. Los comandos se encolarán y se ejecutarán cuando recupere la conexión.</span>
                </div>
              ) : null}

              {/* Redes existentes */}
              {(status?.networks || []).length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase text-gray-400 mb-2">Interfaces configuradas</h3>
                  <div className="space-y-2">
                    {status.networks.map((net: any) => {
                      const lastSample = bandwidth?.samples?.slice(-1)[0]
                      const ifaceBw = lastSample?.ifaces?.find((i: any) => i.iface === net.iface)
                      return (
                        <div key={net.iface} className="flex items-center justify-between bg-slate-50 rounded-lg px-4 py-3 border border-slate-100">
                          <div className="flex items-center gap-3">
                            <Wifi className="h-4 w-4 text-emerald-500 shrink-0" />
                            <div>
                              <p className="text-sm font-semibold text-gray-800">{net.iface} — <span className="font-mono">{net.ipCidr}</span></p>
                              {net.description && <p className="text-xs text-gray-400">{net.description}</p>}
                              <p className="text-xs text-gray-400 mt-0.5">
                                {net.dhcp ? `DHCP ${net.poolStart}–${net.poolEnd}` : 'Sin DHCP'}
                              </p>
                              {ifaceBw && (
                                <p className="text-xs text-emerald-600 mt-0.5 flex items-center gap-1">
                                  <Activity className="h-3 w-3" />
                                  ↓ {fmtBps(ifaceBw.rxBps)} · ↑ {fmtBps(ifaceBw.txBps)}
                                </p>
                              )}
                            </div>
                          </div>
                          <button onClick={() => deleteNetwork(net.iface)} disabled={actionLoading === `del-net-${net.iface}`}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition disabled:opacity-50">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}


              {/* Cola de comandos */}
              {(status?.pendingCmds?.length > 0 || status?.cmdHistory?.length > 0) && (
                <div>
                  <div className="flex items-center justify-between mb-2 mt-2">
                    <h3 className="text-xs font-semibold uppercase text-gray-400">Actividad de comandos</h3>
                    {status.pendingCmds?.length > 0 && (
                      <button
                        onClick={clearQueue}
                        disabled={actionLoading === 'clear-queue'}
                        className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                        title="Cancelar todos los comandos pendientes">
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
                          <button
                            onClick={() => cancelCmd(c.id)}
                            disabled={actionLoading === `cancel-${c.id}`}
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
            /* Subscribers tab */
            <div className="space-y-3">
              <p className="text-xs text-gray-500">Abonados asignados a este nodo. Usa "Aplicar queue" para crear una política de tráfico en el EdgeRouter según el plan contratado.</p>
              {subLoading ? (
                <div className="flex items-center justify-center py-10 text-gray-400"><RefreshCw className="h-4 w-4 animate-spin mr-2" /> Cargando…</div>
              ) : subscribers.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">No hay abonados asignados a este nodo.</div>
              ) : (
                <div className="space-y-2">
                  {subscribers.map((s: any) => (
                    <div key={s.serviceId} className="flex items-center justify-between bg-white border rounded-xl px-4 py-3 hover:border-emerald-200 transition">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{s.fullName}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-xs text-gray-500">{s.ipAddress || <span className="text-red-500">Sin IP</span>}</span>
                          <span className="text-gray-300">·</span>
                          <span className="text-xs text-gray-500">{s.planName}</span>
                          <span className="text-gray-300">·</span>
                          <span className="text-xs text-emerald-600 font-medium">↓{s.downloadSpeed}M ↑{s.uploadSpeed}M</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-3">
                        {queueStatusBadge(s.edgeosQueue)}
                        {s.edgeosQueue ? (
                          <button onClick={() => deprovisionSubscriber(s.serviceId)} disabled={!s.ipAddress || actionLoading === `deprov-${s.serviceId}`}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition disabled:opacity-40"
                            title="Eliminar queue">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button onClick={() => provisionSubscriber(s.serviceId, lanIface)} disabled={!s.ipAddress || actionLoading === `prov-${s.serviceId}`}
                            className="px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition"
                            title={!s.ipAddress ? 'Asigna una IP al abonado primero' : 'Crear queue en EdgeRouter'}>
                            {actionLoading === `prov-${s.serviceId}` ? '…' : 'Aplicar queue'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
