import { useState, useEffect } from 'react'
import { ArrowLeft, Plus, Server, RefreshCw, X, Copy, CheckCircle, AlertTriangle, Clock, Trash2, Terminal, Shield, Eye, EyeOff } from 'lucide-react'
import axios from 'axios'

interface Props { API: string; onBack: () => void }

const ROUTER_TYPES = [
  { value: 'mikrotik_v7', label: 'Mikrotik RouterOS 7', description: 'REST API nativa, recomendado' },
  { value: 'mikrotik_v6', label: 'Mikrotik RouterOS 6', description: 'API puerto 8728' },
  { value: 'ubiquiti', label: 'Ubiquiti UniFi/AirMax', description: 'UISP API' },
  { value: 'olt_huawei', label: 'OLT Huawei', description: 'SNMP + Telnet' },
  { value: 'olt_zte', label: 'OLT ZTE', description: 'SNMP + Telnet' },
  { value: 'snmp', label: 'Genérico SNMP', description: 'Cualquier dispositivo SNMP' },
]

export default function RouterManager({ API, onBack }: Props) {
  const [routers, setRouters] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<any>({ routerType: '' })
  const [newRouter, setNewRouter] = useState<any>(null)
  const [copied, setCopied] = useState('')
  const [showPass, setShowPass] = useState(false)

  function api() {
    return axios.create({ baseURL: API, headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } })
  }

  useEffect(() => { loadRouters() }, [])

  async function loadRouters() {
    setLoading(true)
    try {
      const res = await api().get('/routers')
      setRouters(Array.isArray(res.data) ? res.data : [])
    } catch { setRouters([]) }
    setLoading(false)
  }

  async function handleCreate() {
    try {
      const res = await api().post('/routers', form)
      setNewRouter(res.data)
      setStep(3)
      loadRouters()
    } catch (e: any) { alert('Error: ' + (e.response?.data?.error || e.message)) }
  }

  async function handleDelete(id: number) {
    if (!confirm('¿Eliminar router y revocar token del agente?')) return
    try { await api().delete(`/routers/${id}`); loadRouters() }
    catch (e: any) { alert('Error: ' + (e.response?.data?.error || e.message)) }
  }

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 2000)
  }

  const installCmd = newRouter ? `AGENT_TOKEN=${newRouter.agentToken} ROUTER_IP=${newRouter.ipAddress || '192.168.X.X'} ROUTER_TYPE=${form.routerType} ROUTER_USER=admin ROUTER_PASS=TU_PASSWORD node fibranexus-agent.js` : ''

  return (
    <div className="flex-1 overflow-auto bg-gray-50">
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-full max-w-2xl mx-4 shadow-2xl overflow-hidden">
            <div className="bg-blue-600 px-6 py-4 flex justify-between items-center">
              <div>
                <h2 className="text-white font-bold text-lg">
                  {step === 1 ? '① Tipo de router' : step === 2 ? '② Datos del router' : '③ Instalar agente'}
                </h2>
                <p className="text-blue-100 text-sm">
                  {step === 1 ? 'Elige el fabricante' : step === 2 ? 'Ingresa los datos' : 'Copia el comando de instalación'}
                </p>
              </div>
              <button onClick={() => { setShowForm(false); setStep(1); setForm({ routerType: '' }) }} className="text-white/80 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6">
              {step === 1 && (
                <div className="grid grid-cols-2 gap-3">
                  {ROUTER_TYPES.map(rt => (
                    <button key={rt.value} onClick={() => { setForm({ ...form, routerType: rt.value }); setStep(2) }}
                      className="text-left p-4 border-2 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition">
                      <div className="flex items-center gap-2 mb-1">
                        <Server className="h-4 w-4 text-blue-600" />
                        <p className="font-semibold text-sm">{rt.label}</p>
                      </div>
                      <p className="text-xs text-gray-500">{rt.description}</p>
                    </button>
                  ))}
                </div>
              )}
              {step === 2 && (
                <div className="space-y-4">
                  <div className="bg-blue-50 rounded-lg px-4 py-3 flex items-center gap-3">
                    <Server className="h-5 w-5 text-blue-600" />
                    <p className="text-sm font-semibold text-blue-900">{ROUTER_TYPES.find(t => t.value === form.routerType)?.label}</p>
                    <button onClick={() => setStep(1)} className="ml-auto text-xs text-blue-600 hover:underline">Cambiar</button>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nombre <span className="text-red-500">*</span></label>
                    <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" placeholder="ej: Router Nodo Central" value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">IP del router</label>
                      <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 font-mono" placeholder="192.168.1.1" value={form.ipAddress || ''} onChange={e => setForm({ ...form, ipAddress: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Ubicación/Nodo</label>
                      <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" placeholder="ej: Nodo Centro" value={form.location || ''} onChange={e => setForm({ ...form, location: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Modelo</label>
                    <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" placeholder="ej: L009, CCR1036, UAP-AC-Pro" value={form.model || ''} onChange={e => setForm({ ...form, model: e.target.value })} />
                  </div>
                  {form.routerType === 'snmp' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">SNMP Community</label>
                      <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 font-mono" placeholder="public" value={form.snmpCommunity || ''} onChange={e => setForm({ ...form, snmpCommunity: e.target.value })} />
                    </div>
                  )}
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-3">
                    <Shield className="h-5 w-5 text-amber-600 flex-shrink-0" />
                    <p className="text-xs text-amber-800">Las credenciales del router se configuran localmente en el agente — nunca pasan por nuestros servidores.</p>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setStep(1)} className="flex-1 py-2.5 border rounded-lg hover:bg-gray-50 font-medium">Atrás</button>
                    <button onClick={handleCreate} disabled={!form.name} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50">Registrar →</button>
                  </div>
                </div>
              )}
              {step === 3 && newRouter && (
                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
                    <CheckCircle className="h-6 w-6 text-green-600" />
                    <div>
                      <p className="font-semibold text-green-900">Router registrado</p>
                      <p className="text-sm text-green-700">Instala el agente en tu red para activarlo</p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                      <Shield className="h-4 w-4 text-blue-600" /> Token del agente
                      <span className="text-xs text-red-500">(guárdalo — no se mostrará de nuevo)</span>
                    </label>
                    <div className="flex gap-2">
                      <div className="flex-1 font-mono text-sm bg-gray-900 text-green-400 rounded-lg px-3 py-2 overflow-x-auto">
                        {showPass ? newRouter.agentToken : '••••••••••••••••••••••••••••••••••••'}
                      </div>
                      <button onClick={() => setShowPass(!showPass)} className="p-2 border rounded-lg hover:bg-gray-50">
                        {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                      <button onClick={() => copyText(newRouter.agentToken, 'token')} className="p-2 border rounded-lg hover:bg-gray-50">
                        {copied === 'token' ? <CheckCircle className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                      <Terminal className="h-4 w-4" /> Comando de instalación
                    </label>
                    <div className="bg-gray-900 rounded-lg p-3 relative">
                      <code className="text-green-400 text-xs block whitespace-pre-wrap break-all">{installCmd}</code>
                      <button onClick={() => copyText(installCmd, 'cmd')} className="absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-300">
                        {copied === 'cmd' ? <CheckCircle className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  <button onClick={() => { setShowForm(false); setStep(1); setForm({ routerType: '' }); setNewRouter(null) }}
                    className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Listo</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <header className="bg-white border-b px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft className="h-5 w-5" /></button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Gestión de Routers</h1>
            <p className="text-sm text-gray-500">{routers.length} router{routers.length !== 1 ? 's' : ''} registrado{routers.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={loadRouters} className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm font-medium flex items-center gap-2"><RefreshCw className="h-4 w-4" /> Actualizar</button>
          <button onClick={() => { setShowForm(true); setStep(1) }} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2"><Plus className="h-4 w-4" /> Agregar Router</button>
        </div>
      </header>
      <main className="p-8 max-w-6xl mx-auto">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex items-start gap-4">
          <Shield className="h-6 w-6 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-blue-900">Integración segura via agente</p>
            <p className="text-sm text-blue-700 mt-1">El agente se instala en tu red local y hace conexión saliente. No requiere IP pública ni abrir puertos. Compatible con Mikrotik, Ubiquiti, OLTs y SNMP.</p>
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div></div>
        ) : routers.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm text-center py-20 px-8">
            <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4"><Server className="h-8 w-8 text-blue-400" /></div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Sin routers registrados</h3>
            <p className="text-gray-500 mb-6 max-w-md mx-auto">Agrega tu primer router para gestionar tu red desde FibraNexus.</p>
            <button onClick={() => { setShowForm(true); setStep(1) }} className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium inline-flex items-center gap-2"><Plus className="h-4 w-4" /> Agregar primer router</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {routers.map((router: any) => (
              <div key={router.id} className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition p-5">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${router.status === 'online' ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                    <div>
                      <h3 className="font-bold text-gray-900">{router.name}</h3>
                      <p className="text-xs text-gray-500">{router.brand} {router.model}</p>
                    </div>
                  </div>
                  <button onClick={() => handleDelete(router.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="space-y-2 text-sm mb-4">
                  <div className="flex justify-between"><span className="text-gray-500">IP</span><span className="font-mono">{router.ipAddress || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Ubicación</span><span>{router.location || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Tipo</span><span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{ROUTER_TYPES.find(t => t.value === router.credentials?.routerType)?.label || router.brand}</span></div>
                </div>
                <div className={`rounded-lg px-3 py-2 flex items-center gap-2 text-sm ${router.agentConnected ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-amber-600'}`}>
                  {router.agentConnected ? <><CheckCircle className="h-4 w-4" /> Agente conectado</> : <><AlertTriangle className="h-4 w-4" /> Agente no conectado</>}
                  {router.lastSeen && <span className="ml-auto text-xs text-gray-400 flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(router.lastSeen).toLocaleTimeString('es-CL')}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
