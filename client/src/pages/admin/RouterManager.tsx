import { useState, useEffect } from 'react'
import { ArrowLeft, Plus, Server, RefreshCw, X, Copy, CheckCircle, AlertTriangle, Clock, Trash2, Terminal, Shield, Eye, EyeOff, Wifi, Globe, Lock, Monitor, Cloud } from 'lucide-react'
import axios from 'axios'
import EdgeOSManager from './EdgeOSManager'

interface Props { API: string; onBack: () => void }

const ROUTER_TYPES = [
  { value: 'mikrotik_v7', label: 'Mikrotik RouterOS 7', description: 'REST API nativa (recomendado)', brand: 'Mikrotik' },
  { value: 'mikrotik_v6', label: 'Mikrotik RouterOS 6', description: 'API puerto 8728', brand: 'Mikrotik' },
  { value: 'edgerouter_v4', label: 'Ubiquiti EdgeRouter 4', description: 'EdgeOS — nodo aguas abajo del MikroTik', brand: 'Ubiquiti' },
  { value: 'ubiquiti', label: 'Ubiquiti UniFi/AirMax', description: 'UISP API', brand: 'Ubiquiti' },
  { value: 'olt_huawei', label: 'OLT Huawei', description: 'SNMP + Telnet', brand: 'Huawei' },
  { value: 'olt_zte', label: 'OLT ZTE', description: 'SNMP + Telnet', brand: 'ZTE' },
  { value: 'snmp', label: 'Genérico SNMP', description: 'Cualquier dispositivo SNMP', brand: 'Generic' },
]

const DEVICE_PROFILES: Record<string, { defaultMethod: string; methods: string[]; hint: string }> = {
  mikrotik_v7: {
    defaultMethod: 'direct',
    methods: ['direct', 'vpn', 'agent', 'cloudflare_tunnel'],
    hint: 'CCR, RB, hAP con IP/DDNS → directo. Sin IP pública → VPN o agente. L009/containers → Cloudflare en router (avanzado).',
  },
  mikrotik_v6: {
    defaultMethod: 'direct',
    methods: ['direct', 'vpn', 'agent'],
    hint: 'RouterOS 6 usa API puerto 8728. Sin container mode — no aplica túnel Cloudflare en router.',
  },
  edgerouter_v4: {
    defaultMethod: 'cloudflare_tunnel',
    methods: ['cloudflare_tunnel', 'vpn', 'agent', 'direct'],
    hint: 'Cloudflare va en el MikroTik de borde (como tu L009). FibraNexus agrega un hostname extra que apunta al EdgeRouter — no instalas cloudflared en el EdgeRouter.',
  },
  ubiquiti: {
    defaultMethod: 'direct',
    methods: ['direct', 'vpn', 'agent'],
    hint: 'UniFi/AirMax vía IP pública, VPN o agente en la red del cliente.',
  },
  olt_huawei: {
    defaultMethod: 'direct',
    methods: ['direct', 'vpn', 'agent'],
    hint: 'OLT Huawei: FibraNexus se conecta por SNMP/Telnet si hay ruta de red (IP, VPN o agente).',
  },
  olt_zte: {
    defaultMethod: 'direct',
    methods: ['direct', 'vpn', 'agent'],
    hint: 'OLT ZTE: igual que Huawei — requiere acceso de red al equipo.',
  },
  snmp: {
    defaultMethod: 'direct',
    methods: ['direct', 'vpn', 'agent'],
    hint: 'Dispositivo SNMP genérico: polling desde FibraNexus cuando hay conectividad.',
  },
}

const CONNECTION_METHODS = [
  {
    value: 'direct',
    label: 'IP pública / DDNS',
    icon: Globe,
    description: 'El método más común. FibraNexus conecta directo al dispositivo.',
    pros: ['Sin agente', 'Tiempo real', 'Funciona con casi todo'],
    cons: ['Requiere IP pública, DDNS o túnel externo'],
    fields: ['routerIp', 'routerPort', 'routerUser', 'routerPass'],
    recommended: true,
  },
  {
    value: 'vpn',
    label: 'VPN WireGuard',
    icon: Lock,
    description: 'Túnel cifrado ISP ↔ FibraNexus. Ideal para redes sin IP pública.',
    pros: ['Sin IP pública', 'Seguro', 'Multi-dispositivo'],
    cons: ['Configuración VPN en el nodo'],
    fields: ['routerIp', 'routerPort', 'routerUser', 'routerPass', 'vpnEndpoint'],
  },
  {
    value: 'agent',
    label: 'Agente en red local',
    icon: Monitor,
    description: 'Un mini-agente en cualquier PC/Raspberry de la red del cliente.',
    pros: ['Sin IP pública', 'Universal', 'OLTs, switches, routers'],
    cons: ['Dispositivo siempre encendido'],
    fields: ['routerIp', 'routerUser', 'routerPass'],
  },
  {
    value: 'cloudflare_tunnel',
    label: 'Cloudflare en router (avanzado)',
    icon: Cloud,
    description: 'Solo MikroTik RouterOS 7 con container mode (L009, CHR, x86). Caso especial ARM32.',
    pros: ['Sin IP pública', 'Sin PC extra'],
    cons: ['Solo RouterOS 7 + container', 'ARM32 requiere imagen alternativa', 'Configuración compleja'],
    fields: ['routerIp', 'tunnelHostname', 'tunnelToken', 'routerUser', 'routerPass'],
    advanced: true,
  },
]

function methodsForDevice(routerType: string) {
  const profile = DEVICE_PROFILES[routerType]
  if (!profile) return CONNECTION_METHODS
  return CONNECTION_METHODS.filter(m => profile.methods.includes(m.value))
}

function resolveConnectionMethod(router: any) {
  if (router.connectionMethod && router.connectionMethod !== 'agent') return router.connectionMethod
  if (router.credentials?.connectionMethod && router.credentials.connectionMethod !== 'agent') {
    return router.credentials.connectionMethod
  }
  if (router.credentials?.tunnelHostname || router.credentials?.tunnelToken || (router.ipAddress && String(router.ipAddress).includes('fibranexus.cl'))) {
    return 'cloudflare_tunnel'
  }
  if (router.credentials?.connectionMethod === 'agent' && String(router.credentials?.routerType || '').startsWith('mikrotik') && router.routerInfo?.version) {
    return 'cloudflare_tunnel'
  }
  return router.credentials?.connectionMethod || 'direct'
}

function resolveHost(router: any) {
  return router.ipAddress || router.credentials?.tunnelHostname || null
}

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
  const [edgeosScript, setEdgeosScript] = useState<any>(null)
  const [editingRouter, setEditingRouter] = useState<any>(null)
  const [credForm, setCredForm] = useState<any>({})
  const [credSaving, setCredSaving] = useState(false)
  const [credTesting, setCredTesting] = useState(false)
  const [credTestResult, setCredTestResult] = useState<any>(null)
  const [credTab, setCredTab] = useState<'api' | 'heartbeat'>('api')
  const [credTokenValue, setCredTokenValue] = useState('')
  const [tokenRegenerating, setTokenRegenerating] = useState(false)
  const [edgeosManagerRouter, setEdgeosManagerRouter] = useState<any>(null)

  function api() {
    return axios.create({ baseURL: API, headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } })
  }

  useEffect(() => { loadRouters() }, [])

  useEffect(() => {
    const interval = setInterval(loadRouters, 30000)
    return () => clearInterval(interval)
  }, [])

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
      if (form.routerType === 'edgerouter_v4' && res.data.id) {
        try {
          const scriptRes = await api().get(`/routers/${res.data.id}/edgeos-script`)
          setEdgeosScript(scriptRes.data)
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
        tunnelHostname: form.tunnelHostname,
      })
      setTestResult({ success: true, data: res.data })
    } catch (e: any) {
      setTestResult({ success: false, error: e.response?.data?.error || e.message })
    }
    setTesting(false)
  }

  async function handleSetHost(id: number, current: string | null) {
    const host = prompt('Hostname del túnel Cloudflare (ej: l009-test.fibranexus.cl):', current || '')
    if (!host?.trim()) return
    try {
      await api().patch(`/routers/${id}`, { tunnelHostname: host.trim(), connectionMethod: 'cloudflare_tunnel' })
      loadRouters()
    } catch (e: any) { alert('Error: ' + (e.response?.data?.error || e.message)) }
  }

  async function openCredentials(router: any) {
    const isUbiquitiRouter = (router.brand || '').toLowerCase() === 'ubiquiti'
    setCredTab(isUbiquitiRouter ? 'heartbeat' : 'api')
    // Leer el token desde la lista (optimista). Luego verificar contra BD.
    setCredTokenValue(router.credentials?.agentToken || '')
    setEditingRouter(router)
    setCredForm({
      routerUser: router.credentials?.routerUser || 'admin',
      routerPass: router.credentials?.routerPass || '',
      tunnelHostname: router.credentials?.tunnelHostname || router.ipAddress || '',
      routerPort: router.credentials?.routerPort || '443',
      connectionMethod: resolveConnectionMethod(router),
    })
    setCredTestResult(null)
    // Sincronizar el token con BD (force=false → nunca modifica nada)
    // Esto corrige el caso donde la lista tenía el token en caché pero BD tiene otro
    try {
      const res = await api().post(`/routers/${router.id}/token`, { force: false })
      setCredTokenValue(res.data.agentToken)
    } catch { /* silencioso: el campo ya tiene el valor de la lista */ }
  }

  async function saveCredentials() {
    if (!editingRouter) return
    if (!credForm.routerUser || !credForm.routerPass) {
      alert('Usuario y contraseña API son obligatorios')
      return
    }
    setCredSaving(true)
    try {
      await api().patch(`/routers/${editingRouter.id}`, {
        routerUser: credForm.routerUser,
        routerPass: credForm.routerPass,
        tunnelHostname: credForm.tunnelHostname,
        routerPort: credForm.routerPort,
        connectionMethod: credForm.connectionMethod,
      })
      setEditingRouter(null)
      loadRouters()
      alert('Credenciales API guardadas')
    } catch (e: any) { alert('Error: ' + (e.response?.data?.error || e.message)) }
    setCredSaving(false)
  }

  async function testStoredCredentials() {
    if (!editingRouter) return
    setCredTesting(true)
    setCredTestResult(null)
    try {
      if (credForm.routerUser && credForm.routerPass) {
        await api().patch(`/routers/${editingRouter.id}`, {
          routerUser: credForm.routerUser,
          routerPass: credForm.routerPass,
          tunnelHostname: credForm.tunnelHostname,
          routerPort: credForm.routerPort,
          connectionMethod: credForm.connectionMethod,
        })
      }
      const res = await api().post(`/routers/${editingRouter.id}/test-connection`)
      setCredTestResult({ success: true, data: res.data })
    } catch (e: any) {
      setCredTestResult({ success: false, error: e.response?.data?.error || e.message })
    }
    setCredTesting(false)
  }

  async function fetchOrCreateToken() {
    if (!editingRouter) return
    setTokenRegenerating(true)
    try {
      // force=false → el servidor devuelve el token existente sin modificar nada
      const res = await api().post(`/routers/${editingRouter.id}/token`, { force: false })
      setCredTokenValue(res.data.agentToken)
      setEditingRouter({ ...editingRouter, credentials: { ...editingRouter.credentials, agentToken: res.data.agentToken } })
    } catch (e: any) {
      alert('Error al obtener token: ' + (e.response?.data?.error || e.message))
    }
    setTokenRegenerating(false)
  }

  async function forceRegenerateToken() {
    if (!editingRouter) return
    const ok = window.confirm(
      '⚠️ ATENCIÓN — Esta acción es irreversible.\n\n' +
      'Se generará un token NUEVO. El EdgeRouter perderá la conexión inmediatamente ' +
      'y deberás instalar el script actualizado vía SSH para restaurarla.\n\n' +
      '¿Confirmas que quieres reemplazar el token?'
    )
    if (!ok) return
    setTokenRegenerating(true)
    try {
      // force=true → el servidor genera UUID nuevo (único caso donde cambia el token)
      const res = await api().post(`/routers/${editingRouter.id}/token`, { force: true })
      setCredTokenValue(res.data.agentToken)
      setEditingRouter({ ...editingRouter, credentials: { ...editingRouter.credentials, agentToken: res.data.agentToken } })
    } catch (e: any) {
      alert('Error al regenerar token: ' + (e.response?.data?.error || e.message))
    }
    setTokenRegenerating(false)
  }

  function buildEdgeosInstallScript(token: string): string {
    const url = 'https://app.fibranexus.cl/api/routers/agent/heartbeat'
    const cmdResultUrl = 'https://app.fibranexus.cl/api/routers/agent/cmd-result'
    const hb = [
      '#!/bin/bash',
      `TOKEN="${token}"`,
      `SERVER="${url}"`,
      `CMD_RESULT="${cmdResultUrl}"`,
      "VER=$(cat /etc/version 2>/dev/null | head -1 | tr -d '\\n' || echo \"EdgeOS\")",
      "UPTIME=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo \"0\")",
      "CPULINE1=$(grep '^cpu ' /proc/stat)",
      'sleep 1',
      "CPULINE2=$(grep '^cpu ' /proc/stat)",
      'read -ra C1 <<< "$CPULINE1"',
      'read -ra C2 <<< "$CPULINE2"',
      'T1=0; for v in "${C1[@]:1}"; do T1=$((T1+v)); done',
      'T2=0; for v in "${C2[@]:1}"; do T2=$((T2+v)); done',
      'DT=$((T2-T1)); DI=$((C2[4]-C1[4]))',
      'CPU=0; [ $DT -gt 0 ] && CPU=$(( 100*(DT-DI)/DT ))',
      '# Enviar heartbeat y guardar respuesta',
      'RESPONSE=$(curl -sf --max-time 8 -X POST "$SERVER" \\',
      '  -H "Content-Type: application/json" \\',
      '  -d "{\\"agentToken\\":\\"$TOKEN\\",\\"routerInfo\\":{\\"version\\":\\"$VER\\",\\"uptime\\":\\"${UPTIME}s\\",\\"cpuLoad\\":$CPU,\\"hostName\\":\\"$(hostname)\\"}}")',
      '# Ejecutar comandos pendientes de FibraNexus (compatible Python 2.7 y 3.x)',
      'echo "$RESPONSE" > /tmp/fn_hb.json',
      'FNPY=$(command -v python3 || command -v python || command -v python2 || echo "")',
      '[ -z "$FNPY" ] || FN_TOKEN="$TOKEN" FN_CMD_URL="$CMD_RESULT" "$FNPY" << \'PYEOF\'',
      'import os, json, subprocess',
      'try:',
      '    from urllib.request import Request, urlopen',
      'except ImportError:',
      '    from urllib2 import Request, urlopen',
      'try:',
      '    with open("/tmp/fn_hb.json") as f: d = json.loads(f.read())',
      '    cmds = d.get("pendingCommands", [])',
      '    if not cmds: raise SystemExit(0)',
      '    cmd = cmds[0]',
      '    cmd_id, script = cmd.get("id",""), cmd.get("script","")',
      '    if not cmd_id or not script: raise SystemExit(0)',
      '    with open("/tmp/fn_cmd.sh","w") as f: f.write(script)',
      '    p = subprocess.Popen(["/bin/vbash","/tmp/fn_cmd.sh"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)',
      '    stdout, stderr = p.communicate()',
      '    out = (stdout.decode("utf-8","ignore")+stderr.decode("utf-8","ignore"))[:300].strip()',
      '    token = os.environ.get("FN_TOKEN",""); url = os.environ.get("FN_CMD_URL","")',
      '    body = json.dumps({"agentToken":token,"cmdId":cmd_id,"success":p.returncode==0,"output":out}).encode()',
      '    req = Request(url, data=body, headers={"Content-Type":"application/json"})',
      '    urlopen(req, timeout=8)',
      'except SystemExit: pass',
      'except Exception: pass',
      'PYEOF',
    ].join('\n')
    return [
      '# === FibraNexus — Instalar monitor en EdgeRouter (pegar en SSH) ===',
      'sudo mkdir -p /config/scripts/fibranexus',
      '',
      "sudo tee /config/scripts/fibranexus/heartbeat.sh > /dev/null << 'FNHB'",
      hb,
      'FNHB',
      '',
      'sudo chmod +x /config/scripts/fibranexus/heartbeat.sh',
      '',
      '# Registrar en Vyatta task-scheduler (persiste tras reinicios)',
      'WRAPPER=/opt/vyatta/sbin/vyatta-cfg-cmd-wrapper',
      '$WRAPPER begin',
      '$WRAPPER set system task-scheduler task fibranexus executable path /config/scripts/fibranexus/heartbeat.sh',
      '$WRAPPER set system task-scheduler task fibranexus interval 30s',
      '$WRAPPER commit && $WRAPPER save',
      '$WRAPPER end',
      '',
      'echo "Ejecutando primer heartbeat..."',
      'sudo /config/scripts/fibranexus/heartbeat.sh',
      'echo "Listo — verifica el dashboard en ~30 segundos."',
    ].join('\n')
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
    setEdgeosScript(null)
  }

  const selectedType = ROUTER_TYPES.find(t => t.value === form.routerType)
  const selectedMethod = CONNECTION_METHODS.find(m => m.value === form.connectionMethod)
  const defaultPort = form.routerType === 'mikrotik_v6' ? '8728' : '443'
  const isEdgeRouter = form.routerType === 'edgerouter_v4'

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
                      <button key={rt.value} onClick={() => {
                        const profile = DEVICE_PROFILES[rt.value]
                        const base: any = { routerType: rt.value, connectionMethod: profile?.defaultMethod || 'direct' }
                        if (rt.value === 'edgerouter_v4') {
                          base.location = 'Nodo 2'
                          base.model = 'EdgeRouter 4'
                          base.lanSubnet = '192.168.2.0/24'
                          base.lanInterface = 'ether2'
                          base.dhcpSharedNetwork = 'LAN'
                          base.routerIp = '172.16.11.254'
                          base.connectionMethod = 'cloudflare_tunnel'
                        }
                        setForm({ ...form, ...base })
                        setStep(2)
                      }}
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
                  <p className="text-sm text-gray-500 mb-2">¿Cómo se conectará FibraNexus a tu equipo?</p>
                  {DEVICE_PROFILES[form.routerType]?.hint && (
                    <p className="text-xs text-gray-600 bg-gray-50 border rounded-lg px-3 py-2 mb-4">{DEVICE_PROFILES[form.routerType].hint}</p>
                  )}
                  <div className="space-y-3">
                    {methodsForDevice(form.routerType).map(m => (
                      <button key={m.value} onClick={() => { setForm({ ...form, connectionMethod: m.value }); setStep(3) }}
                        className={`w-full text-left p-4 border-2 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition ${m.recommended ? 'border-blue-200' : m.advanced ? 'border-amber-200' : ''}`}>
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                            <m.icon className="h-5 w-5 text-blue-600" />
                          </div>
                          <div className="flex-1">
                            <p className="font-semibold text-sm mb-1 flex items-center gap-2 flex-wrap">
                              {m.label}
                              {m.recommended && <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">Más común</span>}
                              {m.advanced && <span className="text-xs bg-amber-500 text-white px-2 py-0.5 rounded-full">Avanzado</span>}
                            </p>
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
                        {form.connectionMethod === 'cloudflare_tunnel' && isEdgeRouter
                          ? 'IP local del EdgeRouter (LAN)'
                          : form.connectionMethod === 'cloudflare_tunnel'
                            ? 'IP local del router (LAN)'
                            : form.connectionMethod === 'agent'
                              ? 'IP local del router'
                              : 'IP pública o dominio'}
                        <span className="text-red-500"> *</span>
                      </label>
                      <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 font-mono" 
                        placeholder={form.connectionMethod === 'cloudflare_tunnel' ? '192.168.3.253' : form.connectionMethod === 'agent' ? (isEdgeRouter ? '192.168.2.1' : '192.168.1.1') : isEdgeRouter ? '192.168.2.1' : 'router.miempresa.cl'} 
                        value={form.routerIp || ''} onChange={e => setForm({ ...form, routerIp: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Puerto</label>
                      <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 font-mono" 
                        placeholder={defaultPort} 
                        value={form.routerPort || ''} onChange={e => setForm({ ...form, routerPort: e.target.value })} />
                    </div>
                  </div>

                  {form.connectionMethod === 'cloudflare_tunnel' && (
                    <div className="space-y-3 p-4 bg-sky-50 border border-sky-200 rounded-xl">
                      <p className="text-sm font-medium text-sky-900">
                        {isEdgeRouter ? 'Cloudflare vía MikroTik de borde' : 'Cloudflare Tunnel'}
                      </p>
                      {isEdgeRouter && (
                        <>
                          <p className="text-xs text-sky-800">
                            El túnel sigue corriendo en tu MikroTik (ej. L009). Solo agregas un hostname nuevo en Cloudflare que apunte a la IP local del EdgeRouter.
                          </p>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">MikroTik de borde (opcional)</label>
                            <select className="w-full border rounded-lg px-3 py-2 text-sm"
                              value={form.parentRouterId || ''}
                              onChange={e => setForm({ ...form, parentRouterId: e.target.value || null })}>
                              <option value="">— Seleccionar —</option>
                              {routers.filter(r => r.credentials?.routerType?.startsWith('mikrotik')).map(r => (
                                <option key={r.id} value={r.id}>{r.name} ({r.credentials?.tunnelHostname || r.ipAddress})</option>
                              ))}
                            </select>
                          </div>
                        </>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {isEdgeRouter ? 'Hostname Cloudflare del EdgeRouter' : 'Hostname del túnel'} <span className="text-red-500">*</span>
                        </label>
                        <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 font-mono" 
                          placeholder={isEdgeRouter ? 'nodo2-isp.fibranexus.cl' : 'l009-cliente.fibranexus.cl'} 
                          value={form.tunnelHostname || ''} onChange={e => setForm({ ...form, tunnelHostname: e.target.value })} />
                        {isEdgeRouter && (
                          <p className="text-xs text-gray-500 mt-1">En Cloudflare Zero Trust → tu túnel → Public Hostname → URL: <code className="font-mono">https://IP_LOCAL:443</code></p>
                        )}
                      </div>
                      {!isEdgeRouter && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Token del túnel <span className="text-red-500">*</span></label>
                          <input type="password" className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 font-mono text-xs" 
                            placeholder="eyJhIjoi..." 
                            value={form.tunnelToken || ''} onChange={e => setForm({ ...form, tunnelToken: e.target.value })} />
                          <p className="text-xs text-gray-500 mt-1">Cloudflare Zero Trust → Networks → Tunnels → copiar token</p>
                        </div>
                      )}
                    </div>
                  )}

                  {isEdgeRouter && (
                    <div className="space-y-3 p-4 bg-violet-50 border border-violet-200 rounded-xl">
                      <p className="text-sm font-medium text-violet-900">Red del nodo (LAN clientes)</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Subred LAN</label>
                          <input className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                            placeholder="192.168.2.0/24"
                            value={form.lanSubnet || ''}
                            onChange={e => setForm({ ...form, lanSubnet: e.target.value })} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Interfaz LAN</label>
                          <input className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                            placeholder="ether2"
                            value={form.lanInterface || ''}
                            onChange={e => setForm({ ...form, lanInterface: e.target.value })} />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Shared network DHCP (EdgeOS)</label>
                        <input className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                          placeholder="LAN"
                          value={form.dhcpSharedNetwork || ''}
                          onChange={e => setForm({ ...form, dhcpSharedNetwork: e.target.value })} />
                        <p className="text-xs text-gray-500 mt-1">Nombre del shared-network en EdgeOS donde vive la subred de clientes.</p>
                      </div>
                    </div>
                  )}

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

                  {/* Test de conexión */}
                  {form.connectionMethod !== 'agent' && form.routerUser && form.routerPass && (form.connectionMethod === 'cloudflare_tunnel' ? form.tunnelHostname : form.routerIp) && (
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
                              <><p className="font-medium">Conexión exitosa</p><p className="text-xs mt-1">{testResult.data?.routerInfo?.version || testResult.data?.routerInfo?.hostName || JSON.stringify(testResult.data).slice(0, 100)}</p></>
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
                    <button onClick={handleCreate} disabled={
                      !form.name || !form.routerUser || !form.routerPass
                      || (form.connectionMethod === 'cloudflare_tunnel' && isEdgeRouter && (!form.tunnelHostname || !form.routerIp))
                      || (form.connectionMethod === 'cloudflare_tunnel' && !isEdgeRouter && (!form.tunnelHostname || !form.tunnelToken))
                      || (form.connectionMethod !== 'cloudflare_tunnel' && !form.routerIp)
                    }
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
                          📡 Script único — pegar en Terminal del MikroTik
                        </p>
                        <p className="text-xs text-blue-700">
                          {form.connectionMethod === 'cloudflare_tunnel'
                            ? 'Caso avanzado L009/container: script con túnel + heartbeat + arranque automático.'
                            : 'Script de heartbeat para monitoreo desde el propio router MikroTik.'}
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Script completo (Winbox → New Terminal → pegar → Enter)</label>
                        <div className="bg-gray-900 rounded-lg p-3 relative max-h-64 overflow-y-auto">
                          <code className="text-green-400 text-xs block whitespace-pre-wrap break-all font-mono">{mikrotikScript.fullSetupScript || mikrotikScript.script}</code>
                          <button onClick={() => copyText(mikrotikScript.fullSetupScript || mikrotikScript.script, 'script')} className="absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded sticky">
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
                  ) : isEdgeRouter ? (
                    <div className="space-y-4">
                      {/* Heartbeat bash — conexión inmediata vía SSH */}
                      {edgeosScript && (
                        <div className="space-y-3">
                          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                            <p className="font-semibold text-emerald-900 text-sm mb-1">Paso 1: Activar heartbeat (SSH — 1 minuto)</p>
                            <p className="text-xs text-emerald-700">Pega el script en SSH del EdgeRouter. El router enviará su estado cada 30s y aparecerá como "Conectado".</p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">Script de instalación (pegar en SSH del EdgeRouter)</label>
                            <div className="bg-gray-900 rounded-lg p-3 relative max-h-64 overflow-y-auto">
                              <code className="text-green-400 text-xs block whitespace-pre-wrap break-all font-mono">{edgeosScript.installScript}</code>
                              <button onClick={() => copyText(edgeosScript.installScript, 'edgeos-script')} className="absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded sticky">
                                {copied === 'edgeos-script' ? <CheckCircle className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5 text-gray-300" />}
                              </button>
                            </div>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-3">
                            <p className="text-xs font-medium text-gray-600 mb-1.5 flex items-center gap-1.5"><Terminal className="h-3.5 w-3.5" /> Pasos</p>
                            <ol className="space-y-1">
                              {edgeosScript.installInstructions.map((instr: string, i: number) => (
                                <li key={i} className="text-xs text-gray-600 flex items-start gap-2">
                                  <span className="font-mono bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-xs flex-shrink-0">{i + 1}</span>
                                  {instr}
                                </li>
                              ))}
                            </ol>
                          </div>
                        </div>
                      )}

                      {/* Cloudflare — opcional, para gestión API completa */}
                      {form.connectionMethod === 'cloudflare_tunnel' && (
                        <div className="bg-sky-50 border border-sky-200 rounded-lg p-4">
                          <p className="font-semibold text-sky-900 text-sm mb-1">Paso 2 (opcional): Cloudflare para gestión completa</p>
                          <p className="text-xs text-sky-700 mb-3">Necesario para provisionar PPPoE/DHCP/colas desde FibraNexus. El heartbeat ya activa el estado sin esto.</p>
                          <ol className="space-y-1.5 text-xs text-gray-700">
                            <li className="flex gap-2"><span className="font-mono bg-white px-1.5 rounded border">1</span> Cloudflare Zero Trust → Tunnels → el mismo túnel del MikroTik</li>
                            <li className="flex gap-2"><span className="font-mono bg-white px-1.5 rounded border">2</span> Public Hostname → Add: <strong>{form.tunnelHostname || 'nodo2.fibranexus.cl'}</strong></li>
                            <li className="flex gap-2"><span className="font-mono bg-white px-1.5 rounded border">3</span> Service: <code className="bg-white px-1 rounded font-mono">https://{form.routerIp || '192.168.2.1'}:443</code></li>
                            <li className="flex gap-2"><span className="font-mono bg-white px-1.5 rounded border">4</span> Avanzado → habilitar <strong>No TLS Verify</strong> (cert auto-firmado)</li>
                            <li className="flex gap-2"><span className="font-mono bg-white px-1.5 rounded border">5</span> Pulsa "Probar conexión" en FibraNexus</li>
                          </ol>
                          <div className="mt-2 bg-white/60 rounded p-2 text-xs space-y-0.5">
                            <div className="flex justify-between"><span className="text-gray-500">Hostname:</span><span className="font-mono">{form.tunnelHostname}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">IP EdgeRouter:</span><span className="font-mono">{form.routerIp}</span></div>
                          </div>
                        </div>
                      )}
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
            <p className="font-semibold text-blue-900 text-sm">Multi-dispositivo — elige el método según tu equipo</p>
            <p className="text-sm text-blue-700 mt-0.5">MikroTik (borde), EdgeRouter (nodo downstream), Ubiquiti, OLTs, SNMP. IP directa · VPN · Agente.</p>
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
              const method = resolveConnectionMethod(router)
              const methodInfo = CONNECTION_METHODS.find(m => m.value === method)
              const MethodIcon = methodInfo?.icon || Globe
              const info = router.routerInfo || (router.firmware ? { version: router.firmware } : null)
              return (
                <div key={router.id} className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition p-5">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${router.agentConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></div>
                      <div>
                        <h3 className="font-bold text-gray-900">{router.name}</h3>
                        <p className="text-xs text-gray-500">{router.brand} {router.model}</p>
                      </div>
                    </div>
                    <button onClick={() => handleDelete(router.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"><Trash2 className="h-4 w-4" /></button>
                  </div>

                  {router.agentConnected && info && (
                    <div className="grid grid-cols-3 gap-2 mb-4 p-3 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="text-center">
                        <p className="text-[10px] uppercase text-gray-400 font-semibold">{router.brand === 'Ubiquiti' ? 'EdgeOS' : 'RouterOS'}</p>
                        <p className="text-xs font-medium text-gray-800 truncate" title={info.version}>{info.version?.split(' ')[0] || '—'}</p>
                      </div>
                      <div className="text-center border-x border-slate-200">
                        <p className="text-[10px] uppercase text-gray-400 font-semibold">Uptime</p>
                        <p className="text-xs font-medium text-gray-800">{info.uptime || '—'}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] uppercase text-gray-400 font-semibold">CPU</p>
                        <p className="text-xs font-medium text-gray-800">{info.cpuLoad != null ? `${info.cpuLoad}%` : '—'}</p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 text-sm mb-4">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Host</span>
                      <span className="font-mono text-xs flex items-center gap-1">
                        {resolveHost(router) || (
                          <button onClick={() => handleSetHost(router.id, null)} className="text-blue-600 hover:underline text-xs">+ Agregar host</button>
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between"><span className="text-gray-500">Ubicación</span><span>{router.location || '—'}</span></div>
                    {router.credentials?.lanSubnet && (
                      <div className="flex justify-between"><span className="text-gray-500">LAN nodo</span><span className="font-mono text-xs">{router.credentials.lanSubnet} · {router.credentials.lanInterface || '—'}</span></div>
                    )}
                    {!info && router.firmware && (
                      <div className="flex justify-between"><span className="text-gray-500">Firmware</span><span className="text-xs">{router.firmware}</span></div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Tipo</span>
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                        {ROUTER_TYPES.find(t => t.value === router.credentials?.routerType)?.label || router.brand}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Conexión</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${method === 'cloudflare_tunnel' ? 'bg-sky-100 text-sky-800' : 'bg-blue-100 text-blue-700'}`}>
                        <MethodIcon className="h-3 w-3" /> {methodInfo?.label || 'IP directa'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">API REST</span>
                      {router.hasApiCredentials ? (
                        <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Configurada</span>
                      ) : (
                        <span className="text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full">Sin credenciales</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 mb-3">
                    <button onClick={() => openCredentials(router)}
                      className="flex-1 py-2 text-sm font-medium border rounded-lg hover:bg-gray-50 text-blue-700 border-blue-200">
                      {router.hasApiCredentials ? 'Editar API' : 'Configurar API'}
                    </button>
                    {(() => {
                      const b = (router.brand || '').toLowerCase()
                      const rt = (router.credentials?.routerType || '').toLowerCase()
                      const isEdgeOS = b === 'ubiquiti' || b.includes('edge') || rt.startsWith('edgerouter')
                      return isEdgeOS ? (
                        <button onClick={() => setEdgeosManagerRouter(router)}
                          className="flex-1 py-2 text-sm font-medium border rounded-lg hover:bg-emerald-50 text-emerald-700 border-emerald-200">
                          Gestionar EdgeOS
                        </button>
                      ) : null
                    })()}
                  </div>
                  <div className={`rounded-lg px-3 py-2 flex items-center gap-2 text-sm ${router.agentConnected ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-amber-600'}`}>
                    {router.agentConnected ? <><CheckCircle className="h-4 w-4" /> Conectado</> : <><AlertTriangle className="h-4 w-4" /> Sin conexión</>}
                    {router.lastSeen && <span className="ml-auto text-xs text-gray-400 flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(router.lastSeen).toLocaleTimeString('es-CL')}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {editingRouter && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex justify-between items-start p-6 pb-0">
              <div>
                <h3 className="font-bold text-lg text-gray-900">Configurar — {editingRouter.name}</h3>
                <p className="text-sm text-gray-400 mt-0.5">
                  {editingRouter.brand} · {ROUTER_TYPES.find(t => t.value === editingRouter.credentials?.routerType)?.label || 'Router'}
                </p>
              </div>
              <button onClick={() => setEditingRouter(null)} className="p-1 rounded-lg hover:bg-gray-100">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b mx-6 mt-4">
              <button onClick={() => setCredTab('api')}
                className={`pb-2.5 px-1 mr-6 text-sm font-medium border-b-2 transition-colors ${credTab === 'api' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                Conexión API
              </button>
              <button onClick={() => setCredTab('heartbeat')}
                className={`pb-2.5 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${credTab === 'heartbeat' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                Heartbeat SSH
                {credTokenValue && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>}
              </button>
            </div>

            <div className="p-6">
              {/* Tab: Conexión API */}
              {credTab === 'api' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-gray-700">Host túnel / IP</label>
                    <input className="w-full border rounded-lg px-3 py-2 mt-1 font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="l009-test.fibranexus.cl"
                      value={credForm.tunnelHostname || ''}
                      onChange={e => setCredForm({ ...credForm, tunnelHostname: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Usuario API</label>
                    <input className="w-full border rounded-lg px-3 py-2 mt-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={credForm.routerUser || ''}
                      onChange={e => setCredForm({ ...credForm, routerUser: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Contraseña API</label>
                    <input type="password" className="w-full border rounded-lg px-3 py-2 mt-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={credForm.routerPass || ''}
                      onChange={e => setCredForm({ ...credForm, routerPass: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Puerto HTTPS</label>
                    <input className="w-full border rounded-lg px-3 py-2 mt-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={credForm.routerPort || '443'}
                      onChange={e => setCredForm({ ...credForm, routerPort: e.target.value })} />
                  </div>
                  {credTestResult && (
                    <div className={`text-sm p-3 rounded-lg ${credTestResult.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                      {credTestResult.success ? 'Conexión OK — router responde' : credTestResult.error}
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <button onClick={() => setEditingRouter(null)} className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancelar</button>
                    <button onClick={testStoredCredentials} disabled={credTesting}
                      className="flex-1 py-2 border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50 text-sm">
                      {credTesting ? 'Probando…' : 'Probar'}
                    </button>
                    <button onClick={saveCredentials} disabled={credSaving}
                      className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
                      {credSaving ? 'Guardando…' : 'Guardar'}
                    </button>
                  </div>
                </div>
              )}

              {/* Tab: Heartbeat SSH */}
              {credTab === 'heartbeat' && (
                <div className="space-y-5">
                  {/* Token */}
                  <div>
                    <label className="text-sm font-medium text-gray-700">Token de agente</label>
                    <p className="text-xs text-gray-400 mt-0.5 mb-2">UUID que identifica este router — se incrusta automáticamente en el script</p>
                    {/* Token field */}
                    <div className="flex gap-2">
                      <input readOnly
                        value={credTokenValue || '—'}
                        className="flex-1 font-mono text-xs rounded-lg px-3 py-2 border bg-gray-50 text-gray-800 border-gray-200 min-w-0" />
                      {credTokenValue && (
                        <button onClick={() => copyText(credTokenValue, 'agent-token')}
                          className="p-2 border rounded-lg hover:bg-gray-50 flex-shrink-0" title="Copiar token">
                          {copied === 'agent-token' ? <CheckCircle className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-gray-500" />}
                        </button>
                      )}
                    </div>

                    {/* Botones de acción del token */}
                    <div className="flex gap-2 mt-2">
                      {!credTokenValue && (
                        <button onClick={fetchOrCreateToken} disabled={tokenRegenerating}
                          className="flex-1 py-2 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                          <RefreshCw className={`h-3.5 w-3.5 ${tokenRegenerating ? 'animate-spin' : ''}`} />
                          {tokenRegenerating ? 'Obteniendo…' : 'Obtener token'}
                        </button>
                      )}
                      {credTokenValue && (
                        <button onClick={forceRegenerateToken} disabled={tokenRegenerating}
                          className="flex-1 py-2 text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 flex items-center justify-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {tokenRegenerating ? 'Procesando…' : 'Regenerar token (peligro)'}
                        </button>
                      )}
                    </div>
                    {credTokenValue && (
                      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-red-400 flex-shrink-0" />
                        Regenerar invalida el script del router — requirirá reinstalar vía SSH
                      </p>
                    )}
                  </div>

                  {/* Script */}
                  {credTokenValue ? (
                    <div>
                      <div className="flex justify-between items-center mb-1.5">
                        <label className="text-sm font-medium text-gray-700">Script de instalación</label>
                        <span className="text-xs text-gray-400">SSH al EdgeRouter → pegar → Enter</span>
                      </div>
                      <div className="relative">
                        <div className="bg-gray-900 rounded-lg p-3 max-h-60 overflow-y-auto">
                          <code className="text-green-400 text-xs block whitespace-pre-wrap font-mono leading-relaxed">
                            {buildEdgeosInstallScript(credTokenValue)}
                          </code>
                        </div>
                        <button onClick={() => copyText(buildEdgeosInstallScript(credTokenValue), 'edgeos-install')}
                          className="absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded" title="Copiar script">
                          {copied === 'edgeos-install' ? <CheckCircle className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5 text-gray-300" />}
                        </button>
                      </div>
                      <div className="mt-3 bg-emerald-50 border border-emerald-100 rounded-lg p-3 space-y-1.5">
                        <p className="text-xs text-emerald-800 flex items-center gap-1.5">
                          <Terminal className="h-3.5 w-3.5 flex-shrink-0" />
                          Copia el script → SSH al EdgeRouter → pega → Enter
                        </p>
                        <p className="text-xs text-emerald-700 flex items-center gap-1.5">
                          <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" />
                          En ~30 segundos el router aparece verde en el dashboard
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
                      <p className="text-sm text-amber-800 font-medium">Sin token</p>
                      <p className="text-xs text-amber-600 mt-1">Presiona "Generar token" para obtener el script de instalación</p>
                    </div>
                  )}

                  <button onClick={() => setEditingRouter(null)} className="w-full py-2 border rounded-lg text-sm hover:bg-gray-50">Cerrar</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {edgeosManagerRouter && (
        <EdgeOSManager
          API={API}
          router={edgeosManagerRouter}
          onClose={() => setEdgeosManagerRouter(null)}
        />
      )}
    </div>
  )
}
