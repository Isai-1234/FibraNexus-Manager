import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { Radar, RefreshCw, Check, EyeOff, Eye, ChevronDown, X, Loader2, AlertTriangle } from 'lucide-react'

interface DetectedDevice {
  id: number
  macAddress: string
  ipAddress: string | null
  hostname: string | null
  interfaceName: string | null
  source: string
  firstSeen: string
  lastSeen: string
  status: 'detected' | 'adopted' | 'ignored'
  effectiveStatus?: 'detected' | 'adopted' | 'ignored'
  adoptedAsClientServiceId: number | null
  equipmentId: number
  routerName: string | null
  routerBrand: string | null
  adoptedClientId: number | null
  adoptedClientName: string | null
  linkedEquipmentId?: number | null
}

interface Router {
  id: number
  name: string
}

interface Plan {
  id: number
  name: string
  price: string
  downloadSpeed: number
  uploadSpeed: number
}

interface Client {
  id: number
  user: { fullName: string; email: string }
  city: string | null
}

type AdoptMode = 'existing' | 'new'

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'detected', label: 'Detectados' },
  { value: 'adopted', label: 'Adoptados' },
  { value: 'ignored', label: 'Ignorados' },
]

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    detected: 'bg-blue-100 text-blue-700',
    adopted: 'bg-green-100 text-green-700',
    ignored: 'bg-surface-raised text-ink-muted',
  }
  const labels: Record<string, string> = {
    detected: 'Detectado',
    adopted: 'Adoptado',
    ignored: 'Ignorado',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg[status] || 'bg-surface-raised text-gray-600'}`}>
      {labels[status] || status}
    </span>
  )
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'ahora'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function effStatus(device: DetectedDevice) {
  const raw = device.effectiveStatus ?? device.status
  if (raw === 'adopted' && !device.adoptedClientId) return 'detected'
  return raw
}

function isReallyLinked(device: DetectedDevice) {
  return effStatus(device) === 'adopted' && Boolean(device.adoptedClientId)
}

function isGhostAdoption(device: DetectedDevice) {
  return device.status === 'adopted' && effStatus(device) === 'detected'
}

function filterForDisplay(rows: DetectedDevice[], filter: string) {
  if (filter === 'adopted') {
    return rows.filter((d) => isReallyLinked(d))
  }
  if (filter === 'detected') {
    return rows.filter((d) => effStatus(d) === 'detected')
  }
  if (filter === 'ignored') {
    return rows.filter((d) => d.status === 'ignored')
  }
  return rows
}

export default function DetectedDevices({ API, onOpenClient }: { API: string; onOpenClient?: (clientId: number) => void }) {
  const [devices, setDevices] = useState<DetectedDevice[]>([])
  const [routers, setRouters] = useState<Router[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const [ghostHint, setGhostHint] = useState('')
  const [reconciling, setReconciling] = useState(false)
  const [statusFilter, setStatusFilter] = useState('detected')
  const [routerFilter, setRouterFilter] = useState('')
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)

  // Adopt modal state
  const [adoptTarget, setAdoptTarget] = useState<DetectedDevice | null>(null)
  const [adoptMode, setAdoptMode] = useState<AdoptMode>('existing')
  const [adoptClientId, setAdoptClientId] = useState('')
  const [clientSearch, setClientSearch] = useState('')
  const [adoptPlanId, setAdoptPlanId] = useState('')
  const [newFullName, setNewFullName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [adoptLoading, setAdoptLoading] = useState(false)
  const [adoptError, setAdoptError] = useState('')

  const api = useCallback(() => axios.create({
    baseURL: API,
    headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
  }), [API])

  async function runReconcile() {
    setReconciling(true)
    setGhostHint('')
    setError('')
    try {
      await api().post('/devices/reconcile')
      await loadDevices(true)
      await loadScanStatus()
    } catch (err: any) {
      if (err.response?.status === 404) {
        setGhostHint(
          'El servidor aún no tiene limpieza automática. Ejecuta el SQL en Supabase (te lo envío en el chat) o pide deploy a Render.',
        )
      } else {
        setError(err.response?.data?.error || err.message)
      }
    }
    setReconciling(false)
  }

  async function loadDevices(skipAutoReconcile = false) {
    setLoading(true)
    if (!skipAutoReconcile) setError('')
    try {
      const params: Record<string, string> = {}
      if (statusFilter) params.status = statusFilter
      if (routerFilter) params.equipmentId = routerFilter
      const res = await api().get('/devices/detected', { params })
      const raw: DetectedDevice[] = Array.isArray(res.data) ? res.data : []
      const filtered = filterForDisplay(raw, statusFilter)

      if (!skipAutoReconcile && raw.some((d) => isGhostAdoption(d))) {
        try {
          await api().post('/devices/reconcile')
          return loadDevices(true)
        } catch {
          setGhostHint(
            'Quedaron registros viejos marcados como adoptados sin antena en Equipos. Pulsa «Limpiar ahora» o ejecuta SQL en Supabase.',
          )
        }
      } else {
        setGhostHint('')
      }

      setDevices(filtered)
    } catch (err: any) {
      setError(err.response?.data?.error || err.message)
    }
    setLoading(false)
  }

  async function loadScanStatus() {
    try {
      const res = await api().get('/devices/scan/status')
      setLastScan(res.data.lastScan)
      setPendingCount(res.data.pendingCount || 0)
    } catch { /* silencioso */ }
  }

  async function loadSupport() {
    try {
      const [rRes, pRes, cRes] = await Promise.all([
        api().get('/routers'),
        api().get('/plans'),
        api().get('/clients'),
      ])
      setRouters(Array.isArray(rRes.data) ? rRes.data : [])
      setPlans(Array.isArray(pRes.data) ? pRes.data.filter((p: any) => p.isActive !== false) : [])
      setClients(Array.isArray(cRes.data) ? cRes.data : [])
    } catch { /* silencioso */ }
  }

  useEffect(() => {
    loadDevices()
    loadScanStatus()
  }, [statusFilter, routerFilter])

  useEffect(() => {
    loadSupport()
  }, [])

  async function triggerScan() {
    setScanning(true)
    try {
      await api().post('/devices/scan')
      // Esperar 3s y recargar
      setTimeout(async () => {
        await loadDevices()
        await loadScanStatus()
        setScanning(false)
      }, 3000)
    } catch (err: any) {
      setError(err.response?.data?.error || err.message)
      setScanning(false)
    }
  }

  async function revertAdoption(device: DetectedDevice) {
    if (!confirm(`¿Desvincular ${device.macAddress}?\n\nQuedará como Detectado para adoptar al abonado correcto.`)) return
    setError('')
    try {
      try {
        await api().post(`/devices/${device.id}/revert-adoption`)
      } catch (err: any) {
        if (err.response?.status === 404) {
          await api().post(`/devices/${device.id}/unignore`)
        } else {
          throw err
        }
      }
      await loadDevices()
      await loadScanStatus()
    } catch (err: any) {
      setError(
        err.response?.data?.error
        || err.message
        || 'No se pudo desvincular. Si persiste, usa SQL en Supabase o deploy a Render.',
      )
    }
  }

  function showGhostUnlink(device: DetectedDevice) {
    return Boolean(device.adoptedAsClientServiceId)
      && device.status === 'adopted'
      && !isReallyLinked(device)
  }

  async function handleIgnore(device: DetectedDevice) {
    const action = device.status === 'ignored' ? 'unignore' : 'ignore'
    try {
      await api().post(`/devices/${device.id}/${action}`)
      setDevices(prev => prev.map(d =>
        d.id === device.id ? { ...d, status: action === 'ignore' ? 'ignored' : 'detected' } : d
      ))
    } catch (err: any) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  function openAdoptModal(device: DetectedDevice) {
    setAdoptTarget(device)
    setAdoptMode('existing')
    setAdoptClientId('')
    setClientSearch('')
    setAdoptPlanId('')
    setNewFullName('')
    setNewEmail('')
    setNewPhone('')
    setAdoptError('')
  }

  async function handleAdopt() {
    if (!adoptTarget) return
    if (!adoptPlanId) { setAdoptError('Selecciona un plan'); return }

    if (adoptMode === 'existing' && !adoptClientId) {
      setAdoptError('Selecciona un abonado existente'); return
    }
    if (adoptMode === 'new' && (!newFullName || !newEmail)) {
      setAdoptError('Nombre y email son obligatorios'); return
    }

    setAdoptLoading(true)
    setAdoptError('')
    try {
      const body: any = { planId: parseInt(adoptPlanId, 10) }
      if (adoptMode === 'existing') {
        body.clientId = parseInt(adoptClientId, 10)
      } else {
        body.newClient = { fullName: newFullName, email: newEmail, phone: newPhone || undefined }
      }

      await api().post(`/devices/${adoptTarget.id}/adopt`, body)
      setAdoptTarget(null)
      await loadDevices()
      await loadScanStatus()
    } catch (err: any) {
      setAdoptError(err.response?.data?.error || err.message)
    }
    setAdoptLoading(false)
  }

  const filteredClients = clientSearch
    ? clients.filter(c =>
        c.user?.fullName?.toLowerCase().includes(clientSearch.toLowerCase()) ||
        c.user?.email?.toLowerCase().includes(clientSearch.toLowerCase())
      )
    : clients

  const detected = devices.filter(d => effStatus(d) === 'detected').length

  return (
    <div className="space-y-5">

      {/* Header info bar */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Radar className="h-5 w-5 text-indigo-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-indigo-900">
              Detección automática cada 5 min vía DHCP+ARP
              {pendingCount > 0 && (
                <span className="ml-2 bg-indigo-600 text-white text-xs rounded-full px-2 py-0.5">{pendingCount} nuevos</span>
              )}
            </p>
            <p className="text-xs text-indigo-600">
              {lastScan ? `Último escaneo: ${timeAgo(lastScan)}` : 'Sin escaneos aún — haz clic en Escanear'}
            </p>
          </div>
        </div>
        <button
          onClick={triggerScan}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 text-sm font-medium transition"
        >
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
          {scanning ? 'Escaneando…' : 'Escanear ahora'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1 bg-surface-raised rounded-lg p-1">
          {STATUS_FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${statusFilter === opt.value ? 'bg-surface-card shadow-sm text-blue-600' : 'text-ink-muted hover:text-ink-soft'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <select
            className="pl-3 pr-8 py-1.5 border rounded-lg text-sm bg-surface-card appearance-none focus:ring-2 focus:ring-blue-500 text-ink-soft"
            value={routerFilter}
            onChange={e => setRouterFilter(e.target.value)}
          >
            <option value="">Todos los routers</option>
            {routers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-2 h-4 w-4 text-gray-400 pointer-events-none" />
        </div>

        <button
          onClick={loadDevices}
          className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg hover:bg-surface-raised text-sm text-gray-600"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Actualizar
        </button>
      </div>

      {ghostHint && (
        <div className="flex flex-wrap items-center gap-3 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600" />
          <span className="flex-1">{ghostHint}</span>
          <button
            type="button"
            onClick={runReconcile}
            disabled={reconciling}
            className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
          >
            {reconciling ? 'Limpiando…' : 'Limpiar ahora'}
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-surface-card rounded-xl shadow-sm border border-line overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
          </div>
        ) : devices.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Radar className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium text-ink-muted">
              {statusFilter === 'detected' ? 'Sin dispositivos detectados' : 'Sin registros en esta vista'}
            </p>
            <p className="text-sm mt-1">
              {statusFilter === 'detected' ? 'Haz clic en "Escanear ahora" para buscar dispositivos en tus routers' : 'Cambia el filtro de estado'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface border-b">
                <tr>
                  {['Router', 'MAC', 'IP', 'Hostname', 'Interfaz', 'Fuente', 'Última vez', 'Estado', 'Abonado', 'Acciones'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {devices.map(device => (
                  <tr key={device.id} className={`transition ${device.status === 'ignored' ? 'opacity-40' : 'hover:bg-blue-50/20'}`}>
                    <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">
                      {device.routerName || `Router #${device.equipmentId}`}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-soft whitespace-nowrap">
                      {device.macAddress}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                      {device.ipAddress || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 max-w-[140px] truncate text-gray-600">
                      {device.hostname || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-ink-muted text-xs whitespace-nowrap">
                      {device.interfaceName || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${device.source === 'dhcp' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                        {device.source.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {timeAgo(device.lastSeen)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={effStatus(device)} />
                    </td>
                    <td className="px-4 py-3 max-w-[160px]">
                      {device.adoptedClientName && device.adoptedClientId
                        ? (
                          <button
                            type="button"
                            onClick={() => onOpenClient?.(device.adoptedClientId!)}
                            className="text-xs font-medium text-green-700 truncate block text-left hover:underline"
                            title="Ver perfil del abonado"
                          >
                            {device.adoptedClientName}
                          </button>
                        )
                        : <span className="text-gray-300">—</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {effStatus(device) !== 'adopted' && (
                          <button
                            onClick={() => openAdoptModal(device)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 font-medium transition"
                          >
                            <Check className="h-3 w-3" />
                            Adoptar
                          </button>
                        )}
                        {effStatus(device) !== 'adopted' && (
                          <button
                            onClick={() => handleIgnore(device)}
                            className="flex items-center gap-1 px-2.5 py-1 border text-xs rounded-lg hover:bg-surface-raised text-ink-muted transition"
                            title={device.status === 'ignored' ? 'Restaurar' : 'Ignorar'}
                          >
                            {device.status === 'ignored' ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                          </button>
                        )}
                        {isReallyLinked(device) && (
                          <>
                            <span className="text-xs text-green-600 font-medium">✓ Vinculado</span>
                            <button
                              onClick={() => revertAdoption(device)}
                              className="text-xs text-ink-muted hover:text-red-600 underline"
                              type="button"
                            >
                              Desvincular
                            </button>
                          </>
                        )}
                        {isGhostAdoption(device) && (
                          <button
                            onClick={() => revertAdoption(device)}
                            className="flex items-center gap-1 px-2.5 py-1 border border-red-200 text-xs rounded-lg hover:bg-red-50 text-red-700 transition"
                            type="button"
                            title="Registro fantasma — limpia adopción obsoleta"
                          >
                            <EyeOff className="h-3 w-3" />
                            Limpiar fantasma
                          </button>
                        )}
                        {showGhostUnlink(device) && !isGhostAdoption(device) && (
                          <button
                            onClick={() => revertAdoption(device)}
                            className="flex items-center gap-1 px-2.5 py-1 border border-amber-300 text-xs rounded-lg hover:bg-amber-50 text-amber-700 transition"
                            type="button"
                          >
                            <EyeOff className="h-3 w-3" />
                            Desvincular
                          </button>
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

      <p className="text-xs text-gray-400 text-right">{devices.length} dispositivo{devices.length !== 1 ? 's' : ''}</p>

      {/* Adopt Modal */}
      {adoptTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setAdoptTarget(null)}>
          <div className="bg-surface-card rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-ink">Adoptar dispositivo</h2>
                <p className="text-xs text-ink-muted mt-0.5 font-mono">{adoptTarget.macAddress} · {adoptTarget.ipAddress || 'sin IP'}</p>
              </div>
              <button onClick={() => setAdoptTarget(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Modo adopción */}
              <div>
                <label className="block text-sm font-medium text-ink-soft mb-2">Asignar a</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setAdoptMode('existing')}
                    className={`flex-1 py-2 text-sm rounded-lg border font-medium transition ${adoptMode === 'existing' ? 'bg-blue-600 text-white border-blue-600' : 'bg-surface-card text-gray-600 border-line hover:bg-surface-raised'}`}
                  >
                    Abonado existente
                  </button>
                  <button
                    onClick={() => setAdoptMode('new')}
                    className={`flex-1 py-2 text-sm rounded-lg border font-medium transition ${adoptMode === 'new' ? 'bg-blue-600 text-white border-blue-600' : 'bg-surface-card text-gray-600 border-line hover:bg-surface-raised'}`}
                  >
                    Nuevo abonado
                  </button>
                </div>
              </div>

              {/* Abonado existente */}
              {adoptMode === 'existing' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-ink-soft mb-1">Buscar abonado</label>
                    <input
                      type="text"
                      placeholder="Nombre o email..."
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                      value={clientSearch}
                      onChange={e => setClientSearch(e.target.value)}
                    />
                  </div>
                  <div>
                    <select
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 bg-surface-card"
                      value={adoptClientId}
                      onChange={e => setAdoptClientId(e.target.value)}
                      size={Math.min(filteredClients.length + 1, 6)}
                    >
                      <option value="">Seleccionar abonado...</option>
                      {filteredClients.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.user?.fullName} — {c.user?.email}{c.city ? ` · ${c.city}` : ''}
                        </option>
                      ))}
                    </select>
                    {clients.length === 0 && (
                      <p className="text-xs text-amber-600 mt-1">Sin abonados — créalos en la sección Abonados</p>
                    )}
                  </div>
                </div>
              )}

              {/* Nuevo abonado */}
              {adoptMode === 'new' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-ink-soft mb-1">Nombre completo <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                      value={newFullName}
                      onChange={e => setNewFullName(e.target.value)}
                      placeholder="Ej: Juan Pérez"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-soft mb-1">Email <span className="text-red-500">*</span></label>
                    <input
                      type="email"
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                      value={newEmail}
                      onChange={e => setNewEmail(e.target.value)}
                      placeholder="juan@ejemplo.cl"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-soft mb-1">Teléfono</label>
                    <input
                      type="tel"
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                      value={newPhone}
                      onChange={e => setNewPhone(e.target.value)}
                      placeholder="+56 9 1234 5678"
                    />
                  </div>
                </div>
              )}

              {/* Plan */}
              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">Plan de internet <span className="text-red-500">*</span></label>
                <select
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 bg-surface-card"
                  value={adoptPlanId}
                  onChange={e => setAdoptPlanId(e.target.value)}
                >
                  <option value="">Seleccionar plan...</option>
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.downloadSpeed}/{p.uploadSpeed} Mbps · ${Number(p.price).toLocaleString('es-CL')}/mes
                    </option>
                  ))}
                </select>
                {plans.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">Sin planes activos — créalos en Planes de internet</p>
                )}
              </div>

              {/* Resumen */}
              {adoptTarget.ipAddress && (
                <div className="bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-800">
                  El servicio se creará con la IP detectada: <strong className="font-mono">{adoptTarget.ipAddress}</strong>
                </div>
              )}

              {adoptError && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-100 text-red-700 px-3 py-2 rounded-lg text-sm">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  {adoptError}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t flex gap-3">
              <button
                onClick={() => setAdoptTarget(null)}
                className="flex-1 py-2.5 border rounded-lg hover:bg-surface-raised text-sm font-medium text-ink-soft transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleAdopt}
                disabled={adoptLoading}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60 text-sm font-medium flex items-center justify-center gap-2 transition"
              >
                {adoptLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {adoptLoading ? 'Adoptando...' : 'Confirmar adopción'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
