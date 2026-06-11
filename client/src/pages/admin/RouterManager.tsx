import { useState, useEffect } from 'react'
import { ArrowLeft, Plus, Server, RefreshCw, X, Copy, CheckCircle, AlertTriangle, Clock, Trash2, Terminal, Shield, Eye, EyeOff, Wifi, Globe, Lock, Monitor } from 'lucide-react'
import axios from 'axios'

interface Props { API: string; onBack: () => void }

const ROUTER_TYPES = [
  { value: 'mikrotik_v7', label: 'Mikrotik RouterOS 7', description: 'REST API nativa (recomendado)', brand: 'Mikrotik' },
  { value: 'mikrotik_v6', label: 'Mikrotik RouterOS 6', description: 'API puerto 8728', brand: 'Mikrotik' },
  { value: 'ubiquiti', label: 'Ubiquiti UniFi/AirMax', description: 'UISP API', brand: 'Ubiquiti' },
  { value: 'olt_huawei', label: 'OLT Huawei', description: 'SNMP + Telnet', brand: 'Huawei' },
  { value: 'olt_zte', label: 'OLT ZTE', description: 'SNMP + Telnet', brand: 'ZTE' },
  { value: 'snmp', label: 'Genérico SNMP', description: 'Cualquier dispositivo SNMP', brand: 'Generic' },
]

const CONNECTION_METHODS = [
  {
    value: 'direct',
    label: 'IP pública directa',
    icon: Globe,
    description: 'El router tiene IP pública o DDNS. Conexión directa sin intermediarios.',
    pros: ['Sin agente', 'Más simple', 'Tiempo real'],
    cons: ['Requiere IP pública o DDNS'],
    fields: ['routerIp', 'routerPort', 'routerUser', 'routerPass'],
  },
  {
    value: 'vpn',
    label: 'VPN WireGuard',
    icon: Lock,
    description: 'Túnel cifrado entre tu red y FibraNexus. Máxima seguridad.',
    pros: ['Sin IP pública', 'Máxima seguridad', 'Sin agente'],
    cons: ['Configuración en Mikrotik requerida'],
    fields: ['routerIp', 'routerPort', 'routerUser', 'routerPass', 'vpnEndpoint'],
  },
  {
    value: 'agent',
    label: 'Agente en PC local',
    icon: Monitor,
    description: 'Instala un programa en cualquier PC de tu red. Funciona sin IP pública.',
    pros: ['Sin IP pública', 'Funciona detrás de NAT', 'Fácil de instalar'],
    cons: ['Necesita PC encendido'],
    fields: ['routerIp', 'routerUser', 'routerPass'],
  },
]

export default function RouterManager({ API, onBack }: Props) {
  const [routers, setRouters] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [step, setStep] = useState(1) // 1=tipo, 2=método, 3=datos, 4=token
  const [form, setForm] = useState<any>({ routerType: '', connectionMethod: '' })
  const [newRouter, setNewRouter] = useState<any>(null)
  const [copied, setCopied] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)
  const [mikrotikScript, setMikrotikScript] = useState<any>(null)

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
      // Si es Mikrotik, obtener el script automáticamente
      if (form.routerType?.startsWith('mikrotik') && res.data.id) {
        try {
          const scriptRes = await api().get(`/routers/${res.data.id}/mikrotik-script`)
          setMikrotikScript(scriptRes.data)
        } catch { }
      }
      setStep(4)
      loadRouters()
    } catch (e: any) { alert('Error: ' + (e.response?.data?.error || e.message)) }
  }

  async function handleTestConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await api().post('/routers/test-connection', {
        routerType: form.routerType,
        connectionMethod: form.connectionMethod,
        routerIp: form.routerIp,
        routerPort: form.routerPort,
        routerUser: form.routerUser,
        routerPass: form.routerPass,
      })
      setTestResult({ success: true, data: res.data })
    } catch (e: any) {
      setTestResult({ success: false, error: e.response?.data?.error || e.message })
    }
    setTesting(false)
  }

  async function handleDelete(id: number) {
    if (!confirm('¿Eliminar router y revocar token?')) return
    try { await api().delete(`/routers/${id}`); loadRouters() }
    catch (e: any) { alert('Error: ' + (e.response?.data?.error || e.message)) }
  }

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 2000)
  }

  function resetForm() {
    setShowForm(false)
    setStep(1)
    setForm({ routerType: '', connectionMethod: '' })
    setNewRouter(null)
    setTestResult(null)
    setMikrotikScript(null)
  }

  const selectedType = ROUTER_TYPES.find(t => t.value === form.routerType)
  const selectedMethod = CONNECTION_METHODS.find(m => m.value === form.connectionMethod)
  const defaultPort = form.routerType === 'mikrotik_v6' ? '8728' : '443'

  const installCmd = newRouter ? `AGENT_TOKEN=${newRouter.agentToken} ROUTER_IP=${form.routerIp || '192.168.X.X'} ROUTER_TYPE=${form.routerType} ROUTER_USER=${form.routerUser || 'admin'} ROUTER_PASS=${form.routerPass || 'TU_PASSWORD'} node fibranexus-agent.js` : ''

  return (
    <div className="flex-1 overflow-auto bg-gray-50">
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="bg-blue-600 px-6 py-4 flex justify-between items-center sticky top-0">
              <div>
                <h2 className="text-white font-bold text-lg">
                  {step === 1 ? '① Tipo de dispositivo' : step === 2 ? '② Método de conexión' : step === 3 ? '③ Credenciales' : '④ Configuración lista'}
                </h2>
                <div className="flex gap-1 mt-1">
                  {[1,2,3,4].map(s => (
                    <div key={s} className={`h-1 w-8 rounded-full ${s <= step ? 'bg-white' : 'bg-white/30'}`}></div>
                  ))}
                </div>
              </div>
              <button onClick={resetForm} className="text-white/80 hover:text-white"><X className="h-5 w-5" /></button>
            </div>

            <div className="p-6">
              {/* PASO 1 — Tipo de router */}
              {step === 1 && (
                <div>
                  <p className="text-sm text-gray-500 mb-4">¿Qué tipo de dispositivo quieres agregar?</p>
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
                </div>
              )}

              {/* PASO 2 — Método de conexión */}
              {step === 2 && (
                <div>
                  <div className="bg-blue-50 rounded-lg px-4 py-2 flex items-center gap-3 mb-4">
                    <Server className="h-4 w-4 text-blue-600" />
                    <p className="text-sm font-medium text-blue-900">{selectedType?.label}</p>
                    <button onClick={() => setStep(1)} className="ml-auto text-xs text-blue-600 hover:underline">Cambiar</button>
                  </div>
                  <p className="text-sm text-gray-500 mb-4">¿Cómo se conectará FibraNexus a tu router?</p>
                  <div className="space-y-3">
                    {CONNECTION_METHODS.map(m => (
                      <button key={m.value} onClick={() => { setForm({ ...form, connectionMethod: m.value }); setStep(3) }}
                        className="w-full text-left p-4 border-2 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition">
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                            <m.icon className="h-5 w-5 text-blue-600" />
                          </div>
                          <div className="flex-1">
                            <p className="font-semibold text-sm mb-1">{m.label}</p>
                            <p className="text-xs text-gray-500 mb-2">{m.description}</p>
                            <div className="flex flex-wrap gap-2">
                              {m.pros.map(p => <span key={p} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ {p}</span>)}
                              {m.cons.map(c => <span key={c} className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">⚠ {c}</span>)}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* PASO 3 — Credenciales */}
              {step === 3 && (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <div className="bg-blue-50 rounded-lg px-3 py-2 flex items-center gap-2 flex-1">
                      <Server className="h-4 w-4 text-blue-600" />
                      <p className="text-sm font-medium text-blue-900">{selectedType?.label}</p>
                      <button onClick={() => setStep(1)} className="ml-auto text-xs text-blue-600 hover:underline">Cambiar</button>
                    </div>
                    {selectedMethod && (
                      <div className="bg-purple-50 rounded-lg px-3 py-2 flex items-center gap-2 flex-1">
                        <selectedMethod.icon className="h-4 w-4 text-purple-600" />
                        <p className="text-sm font-medium text-purple-900">{selectedMethod.label}</p>
                        <button onClick={() => setStep(2)} className="ml-auto text-xs text-purple-600 hover:underline">Cambiar</button>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del equipo <span className="text-red-500">*</span></label>
                    <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" placeholder="ej: Router Nodo Central" value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {form.connectionMethod === 'agent' ? 'IP local del router' : 'IP pública o dominio'}
                        <span className="text-red-500"> *</span>
                      </label>
                      <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 font-mono" 
                        placeholder={form.connectionMethod === 'agent' ? '192.168.1.1' : 'router.miempresa.cl'} 
                        value={form.routerIp || ''} onChange={e => setForm({ ...form, routerIp: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Puerto</label>
                      <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 font-mono" 
                        placeholder={defaultPort} 
                        value={form.routerPort || ''} onChange={e => setForm({ ...form, routerPort: e.target.value })} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Usuario del router <span className="text-red-500">*</span></label>
                      <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" 
                        placeholder="admin" 
                        value={form.routerUser || ''} onChange={e => setForm({ ...form, routerUser: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña <span className="text-red-500">*</span></label>
                      <div className="flex gap-1">
                        <input type={showPass ? 'text' : 'password'} className="flex-1 border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" 
                          placeholder="••••••••" 
                          value={form.routerPass || ''} onChange={e => setForm({ ...form, routerPass: e.target.value })} />
                        <button onClick={() => setShowPass(!showPass)} className="p-2 border rounded-lg hover:bg-gray-50">
                          {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Ubicación/Nodo</label>
                      <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" placeholder="ej: Nodo Centro" value={form.location || ''} onChange={e => setForm({ ...form, location: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Modelo</label>
                      <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" placeholder="ej: L009, CCR1036" value={form.model || ''} onChange={e => setForm({ ...form, model: e.target.value })} />
                    </div>
                  </div>

                  {/* Test de conexión (solo para IP pública y VPN) */}
                  {form.connectionMethod !== 'agent' && form.routerIp && form.routerUser && form.routerPass && (
                    <div>
                      <button onClick={handleTestConnection} disabled={testing}
                        className="w-full py-2.5 border-2 border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                        {testing ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div> Probando conexión...</> : <><Wifi className="h-4 w-4" /> Probar conexión</>}
                      </button>
                      {testResult && (
                        <div className={`mt-2 p-3 rounded-lg text-sm flex items-start gap-2 ${testResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                          {testResult.success ? <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />}
                          <div>
                            {testResult.success ? (
                              <><p className="font-medium">Conexión exitosa</p><p className="text-xs mt-1">{JSON.stringify(testResult.data).slice(0, 100)}</p></>
                            ) : (
                              <><p className="font-medium">Error de conexión</p><p className="text-xs mt-1">{testResult.error}</p></>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
                    <Shield className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800">Las credenciales se guardan cifradas con AES-256 y nunca se muestran en texto plano.</p>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button onClick={() => setStep(2)} className="flex-1 py-2.5 border rounded-lg hover:bg-gray-50 font-medium">Atrás</button>
                    <button onClick={handleCreate} disabled={!form.name || !form.routerIp || !form.routerUser || !form.routerPass}
                      className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50">
                      Registrar router →
                    </button>
                  </div>
                </div>
              )}

              {/* PASO 4 — Token / instrucciones */}
              {step === 4 && newRouter && (
                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
                    <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-green-900">Router registrado exitosamente</p>
                      <p className="text-sm text-green-700">
                        {form.connectionMethod === 'agent' ? 'Instala el agente en tu red para activarlo' : 'Las credenciales están guardadas de forma segura'}
                      </p>
                    </div>
                  </div>

                  {/* Mikrotik RouterScript — la opción más elegante */}
                  {form.routerType?.startsWith('mikrotik') && mikrotikScript ? (
                    <div className="space-y-4">
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <p className="font-semibold text-blue-900 text-sm mb-1 flex items-center gap-2">
                          📡 Script para instalar directo en el Mikrotik
                        </p>
                        <p className="text-xs text-blue-700">Sin agente, sin Node.js — el script corre dentro del propio router.</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Script (copiar en Winbox → System → Scripts)</label>
                        <div className="bg-gray-900 rounded-lg p-3 relative">
                          <code className="text-green-400 text-xs block whitespace-pre-wrap break-all font-mono">{mikrotikScript.script}</code>
                          <button onClick={() => copyText(mikrotikScript.script, 'script')} className="absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded">
                            {copied === 'script' ? <CheckCircle className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5 text-gray-300" />}
                          </button>
                        </div>
                      </div>

                      <div className="bg-gray-50 rounded-lg p-4">
                        <p className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                          <Terminal className="h-4 w-4" /> Pasos de instalación en Winbox
                        </p>
                        <ol className="space-y-1.5">
                          {mikrotikScript.installInstructions.map((step: string, i: number) => (
                            <li key={i} className="text-xs text-gray-600 flex items-start gap-2">
                              <span className="font-mono bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-xs flex-shrink-0">{i + 1}</span>
                              {step.replace(/^\d+\. /, '')}
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  ) : form.connectionMethod === 'agent' ? (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                          <Shield className="h-4 w-4 text-blue-600" /> Token del agente
                          <span className="text-xs text-red-500">(guárdalo — no se mostrará de nuevo)</span>
                        </label>
                        <div className="flex gap-2">
                          <div className="flex-1 font-mono text-sm bg-gray-900 text-green-400 rounded-lg px-3 py-2 overflow-x-auto">
                            {showToken ? newRouter.agentToken : '••••••••••••••••••••••••••••••••••••'}
                          </div>
                          <button onClick={() => setShowToken(!showToken)} className="p-2 border rounded-lg hover:bg-gray-50">
                            {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
                          <button onClick={() => copyText(installCmd, 'cmd')} className="absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded">
                            {copied === 'cmd' ? <CheckCircle className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5 text-gray-300" />}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="bg-blue-50 rounded-lg p-4">
                      <p className="text-sm font-medium text-blue-900 mb-2">Conexión configurada via {selectedMethod?.label}</p>
                      <div className="space-y-1 text-sm text-blue-700">
                        <div className="flex justify-between"><span>IP/Host:</span><span className="font-mono">{form.routerIp}:{form.routerPort || defaultPort}</span></div>
                        <div className="flex justify-between"><span>Usuario:</span><span className="font-mono">{form.routerUser}</span></div>
                        <div className="flex justify-between"><span>Tipo:</span><span>{selectedType?.label}</span></div>
                      </div>
                    </div>
                  )}

                  <button onClick={resetForm} className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Listo</button>
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
          <Shield className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-blue-900 text-sm">Integración segura — 3 métodos disponibles</p>
            <p className="text-sm text-blue-700 mt-0.5">IP pública directa · VPN WireGuard · Agente en PC local. Compatible con Mikrotik, Ubiquiti, OLTs y SNMP.</p>
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
            {routers.map((router: any) => {
              const method = router.credentials?.connectionMethod || 'agent'
              const methodInfo = CONNECTION_METHODS.find(m => m.value === method)
              const MethodIcon = methodInfo?.icon || Monitor
              return (
                <div key={router.id} className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition p-5">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${router.status === 'online' ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></div>
                      <div>
                        <h3 className="font-bold text-gray-900">{router.name}</h3>
                        <p className="text-xs text-gray-500">{router.brand} {router.model}</p>
                      </div>
                    </div>
                    <button onClick={() => handleDelete(router.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="space-y-2 text-sm mb-4">
                    <div className="flex justify-between"><span className="text-gray-500">IP/Host</span><span className="font-mono text-xs">{router.ipAddress || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Ubicación</span><span>{router.location || '—'}</span></div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Tipo</span>
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                        {ROUTER_TYPES.find(t => t.value === router.credentials?.routerType)?.label || router.brand}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Conexión</span>
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <MethodIcon className="h-3 w-3" /> {methodInfo?.label || 'Agente'}
                      </span>
                    </div>
                  </div>
                  <div className={`rounded-lg px-3 py-2 flex items-center gap-2 text-sm ${router.status === 'online' ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-amber-600'}`}>
                    {router.status === 'online' ? <><CheckCircle className="h-4 w-4" /> Conectado</> : <><AlertTriangle className="h-4 w-4" /> Sin conexión</>}
                    {router.lastSeen && <span className="ml-auto text-xs text-gray-400 flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(router.lastSeen).toLocaleTimeString('es-CL')}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
