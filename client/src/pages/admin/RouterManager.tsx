import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Plus, Server, RefreshCw, X, Copy, CheckCircle, AlertTriangle, Clock, Trash2, Terminal, Shield, Eye, EyeOff, Wifi, Globe, Lock, Monitor, Cloud, ChevronDown, HelpCircle, BookOpen, Loader2, ExternalLink, Router, Zap, Settings } from 'lucide-react'
import axios from 'axios'
import ThemeToggle from '../../components/ThemeToggle'

interface Props { API: string; onBack: () => void }

/** Values persistentes en BD — no renombrar sin migración */
const ROUTER_TYPES = [
  { value: 'mikrotik_v7', label: 'MikroTik RouterOS 7', description: 'REST API nativa (recomendado)', brand: 'MikroTik' },
  { value: 'mikrotik_v6', label: 'MikroTik RouterOS 6', description: 'API puerto 8728', brand: 'MikroTik' },
  { value: 'edgerouter_v4', label: 'Ubiquiti EdgeRouter', description: 'EdgeOS — nodo aguas abajo del MikroTik', brand: 'Ubiquiti' },
  { value: 'ubiquiti', label: 'Ubiquiti UniFi / AirMax', description: 'UISP API / SNMP AirMax', brand: 'Ubiquiti' },
  { value: 'olt_huawei', label: 'OLT Huawei', description: 'SNMP + Telnet', brand: 'Huawei' },
  { value: 'olt_zte', label: 'OLT ZTE', description: 'SNMP + Telnet', brand: 'ZTE' },
  { value: 'ont_generic', label: 'ONT/ONU genérico', description: 'ONU/ONT vía SNMP', brand: 'Fibra' },
  { value: 'snmp', label: 'Genérico SNMP', description: 'Cualquier dispositivo SNMP', brand: 'Generic' },
]

type DeviceSubtype = {
  value: string
  label: string
  description: string
  recommended?: boolean
}

type DeviceFamily = {
  id: string
  label: string
  description: string
  icon: typeof Router
  accent: string
  iconBg: string
  iconColor: string
  borderActive: string
  /** Si no hay subtipos, al clic selecciona este value y avanza */
  directValue?: string
  subtypes?: DeviceSubtype[]
}

const DEVICE_FAMILIES: DeviceFamily[] = [
  {
    id: 'mikrotik',
    label: 'MikroTik',
    description: 'RouterOS — CCR, RB, L009, CHR',
    icon: Router,
    accent: 'red',
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
    borderActive: 'border-red-500 bg-red-50',
    subtypes: [
      { value: 'mikrotik_v7', label: 'RouterOS 7', description: 'REST API nativa', recommended: true },
      { value: 'mikrotik_v6', label: 'RouterOS 6', description: 'API puerto 8728' },
    ],
  },
  {
    id: 'ubiquiti',
    label: 'Ubiquiti',
    description: 'EdgeRouter, UniFi y AirMax',
    icon: Wifi,
    accent: 'blue',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    borderActive: 'border-blue-500 bg-blue-50',
    subtypes: [
      // value histórico en BD: edgerouter_v4 (no ubiquiti_edgerouter)
      { value: 'edgerouter_v4', label: 'EdgeRouter (EdgeOS)', description: 'ER-X, ER-4, ERLite' },
      // value histórico en BD: ubiquiti (no ubiquiti_unifi)
      { value: 'ubiquiti', label: 'UniFi / AirMax', description: 'UISP, LiteBeam, NanoStation' },
    ],
  },
  {
    id: 'fiber',
    label: 'Fibra Óptica (OLT/ONT)',
    description: 'GPON / EPON — Huawei, ZTE, ONU',
    icon: Zap,
    accent: 'amber',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    borderActive: 'border-amber-500 bg-amber-50',
    subtypes: [
      { value: 'olt_huawei', label: 'OLT Huawei', description: 'SNMP + Telnet' },
      { value: 'olt_zte', label: 'OLT ZTE', description: 'SNMP + Telnet' },
      { value: 'ont_generic', label: 'ONT/ONU genérico', description: 'ONU/ONT vía SNMP' },
    ],
  },
  {
    id: 'snmp',
    label: 'Genérico SNMP',
    description: 'Cualquier dispositivo con SNMP',
    icon: Settings,
    accent: 'slate',
    iconBg: 'bg-slate-200',
    iconColor: 'text-slate-600',
    borderActive: 'border-slate-500 bg-slate-100',
    directValue: 'snmp',
  },
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
  ont_generic: {
    defaultMethod: 'direct',
    methods: ['direct', 'vpn', 'agent'],
    hint: 'ONT/ONU genérico: monitoreo SNMP cuando hay conectividad de red.',
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

function isRouterOnline(router: any) {
  return Boolean(router.agentConnected) || router.status === 'online'
}

function resolveHost(router: any): string | null {
  const creds = router.credentials || {}
  const method = resolveConnectionMethod(router)
  if (method === 'cloudflare_tunnel' && creds.tunnelHostname) {
    return String(creds.tunnelHostname).trim() || null
  }
  return router.ipAddress?.trim() || creds.tunnelHostname?.trim() || null
}

type HelpStep = { title: string; detail?: string; code?: string; icon: typeof Monitor }
type HelpGuide = { title: string; steps: HelpStep[]; note: string }

function getWizardHelpGuide(routerType: string, method: string): HelpGuide | null {
  const isMikro = String(routerType || '').startsWith('mikrotik')
  const isEdge = String(routerType || '').startsWith('edgerouter')

  if (isMikro && method === 'agent') {
    return {
      title: 'Sin IP pública — instala el agente en tu MikroTik',
      steps: [
        { title: 'Abre Winbox y conéctate a tu router', icon: Monitor },
        { title: 'Ve a System → Scripts → clic en "+"', icon: Terminal },
        { title: 'Nombre del script', detail: 'Usa exactamente:', code: 'fibranexus-agent', icon: Server },
        { title: 'Pega el script en "Source"', detail: 'Se genera al registrar el router (paso 4).', icon: Copy },
        { title: 'Ve a System → Scheduler → clic en "+"', icon: Clock },
        { title: 'Configura el scheduler', detail: 'Nombre e intervalo:', code: 'fibranexus-heartbeat\nInterval: 00:00:30', icon: RefreshCw },
        { title: 'On Event', detail: 'Apunta al script y guarda:', code: 'fibranexus-agent', icon: CheckCircle },
      ],
      note: 'El router se conectará solo a FibraNexus cada 30 segundos sin necesitar IP pública ni abrir puertos.',
    }
  }

  if (isMikro && method === 'direct') {
    return {
      title: 'IP pública — Segura automática (recomendado)',
      steps: [
        { title: 'MikroTik ya con salida a internet', detail: 'FibraNexus no configura la WAN.', icon: Globe },
        { title: 'Indica IP pública (y puerto si hay NAT) + IP local', icon: Server },
        { title: 'Registra y copia el script', detail: 'Crea cert, www-ssl, usuario fibranexus y allowlist solo IPs FibraNexus.', icon: Shield },
        { title: 'Winbox → New Terminal → pegar una vez', icon: Terminal },
        { title: 'Si hay borde, aplica la sugerencia NAT', detail: 'dst-nat del puerto público al MikroTik interno.', icon: Lock },
      ],
      note: 'Modo Manual: solo si ya tienes REST API y quieres pegar usuario/clave existentes.',
    }
  }

  if (isEdge && method === 'agent') {
    return {
      title: 'Agente EdgeOS — SSH al EdgeRouter',
      steps: [
        { title: 'Conéctate por SSH a tu EdgeRouter', code: 'ssh ubnt@IP_LOCAL', icon: Terminal },
        { title: 'Ejecuta el comando / script curl', detail: 'Se genera al registrar (paso 4) con el token real.', icon: Cloud },
        { title: 'El agente queda corriendo como servicio', detail: 'Persiste tras reinicios vía post-config.d.', icon: RefreshCw },
      ],
      note: 'Sin IP pública: el EdgeRouter inicia la conexión hacia FibraNexus.',
    }
  }

  if (isMikro && method === 'cloudflare_tunnel') {
    return {
      title: 'Cloudflare Tunnel en el MikroTik',
      steps: [
        { title: 'Instala el container de Cloudflare en tu MikroTik', detail: 'RouterOS 7 con container mode (CHR, L009, x86…).', icon: Cloud },
        { title: 'Usa el token generado al registrar', detail: 'Zero Trust → Tunnels → copiar token e instalarlo en el container.', icon: Shield },
        { title: 'Publica el hostname', detail: 'Apunta el hostname a la IP/puerto local del router.', icon: Globe },
      ],
      note: 'Requiere MikroTik con soporte de containers (CHR o hardware compatible).',
    }
  }

  if (isEdge && method === 'cloudflare_tunnel') {
    return {
      title: 'Cloudflare vía MikroTik de borde (EdgeRouter)',
      steps: [
        { title: 'El túnel sigue en tu MikroTik de borde', detail: 'No instalas cloudflared en el EdgeRouter.', icon: Cloud },
        { title: 'Agrega un Public Hostname en Cloudflare', detail: 'Apunta a la IP LAN del EdgeRouter (https://IP:443).', icon: Globe },
        { title: 'Verifica ruta LAN desde el MikroTik', detail: 'El MikroTik debe alcanzar la subred del EdgeRouter.', icon: Wifi },
      ],
      note: 'Ideal cuando el EdgeRouter está detrás del L009/MikroTik con túnel ya activo.',
    }
  }

  if (method === 'vpn') {
    return {
      title: 'VPN WireGuard',
      steps: [
        { title: 'Levanta el túnel VPN entre el nodo y FibraNexus', icon: Lock },
        { title: 'Usa la IP interna del router en el formulario', icon: Server },
        { title: 'Prueba la conexión antes de registrar', icon: Wifi },
      ],
      note: 'Útil cuando no hay IP pública pero sí un túnel VPN estable.',
    }
  }

  return null
}

function WizardHelpPanel({
  guide,
  open,
  onToggle,
  onCopy,
  copiedKey,
}: {
  guide: HelpGuide
  open: boolean
  onToggle: () => void
  onCopy: (text: string, key: string) => void
  copiedKey: string
}) {
  return (
    <div className="rounded-xl border border-line/60 bg-surface-card text-ink overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-raised/80 transition"
      >
        <HelpCircle className="h-4 w-4 text-sky-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">¿Cómo configuro mi router?</p>
          <p className="text-xs text-ink-muted truncate">{guide.title}</p>
        </div>
        <ChevronDown className={`h-4 w-4 text-ink-muted transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-line pt-3">
          <p className="text-sm font-medium text-sky-300">{guide.title}</p>
          <ol className="space-y-3">
            {guide.steps.map((s, i) => {
              const StepIcon = s.icon
              return (
              <li key={i} className="flex gap-3 items-start">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/40 flex items-center justify-center text-xs font-bold">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm font-medium text-ink flex items-center gap-2">
                    <StepIcon className="h-3.5 w-3.5 text-sky-400 flex-shrink-0" />
                    {s.title}
                  </p>
                  {s.detail && <p className="text-xs text-ink-muted">{s.detail}</p>}
                  {s.code && (
                    <div className="relative mt-1 bg-black/50 rounded-lg border border-line p-2.5">
                      <code className="text-[11px] text-emerald-400 font-mono whitespace-pre-wrap break-all block pr-8">{s.code}</code>
                      <button
                        type="button"
                        onClick={() => onCopy(s.code!, `help-${i}`)}
                        className="absolute top-1.5 right-1.5 p-1 rounded bg-slate-700 hover:bg-slate-600"
                        title="Copiar"
                      >
                        {copiedKey === `help-${i}`
                          ? <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                          : <Copy className="h-3.5 w-3.5 text-ink-soft" />}
                      </button>
                    </div>
                  )}
                </div>
              </li>
              )
            })}
          </ol>
          <div className="flex gap-2 items-start rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2">
            <BookOpen className="h-4 w-4 text-amber-300 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-100/90">{guide.note}</p>
          </div>
        </div>
      )}
    </div>
  )
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
  const [editingRouter, setEditingRouter] = useState<any>(null)
  const [routerModalTab, setRouterModalTab] = useState<'credentials' | 'script'>('credentials')
  const [routerScript, setRouterScript] = useState<any>(null)
  const [scriptLoading, setScriptLoading] = useState(false)
  const [scriptError, setScriptError] = useState('')
  const [credForm, setCredForm] = useState<any>({})
  const [credSaving, setCredSaving] = useState(false)
  const [credTesting, setCredTesting] = useState(false)
  const [credTestResult, setCredTestResult] = useState<any>(null)
  const [wizardHelpOpen, setWizardHelpOpen] = useState(false)
  const [wizardFamily, setWizardFamily] = useState<string | null>(null)
  const [agentWaitStatus, setAgentWaitStatus] = useState<'idle' | 'waiting' | 'connected' | 'timeout'>('idle')
  const waitStartedRef = useRef<number | null>(null)

  function api() {
    return axios.create({ baseURL: API, headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } })
  }

  useEffect(() => { loadRouters() }, [])

  useEffect(() => {
    const interval = setInterval(loadRouters, 30000)
    return () => clearInterval(interval)
  }, [])

  // Paso 4: esperar heartbeat del agente (poll /stats cada 5s, timeout 5 min)
  useEffect(() => {
    const needsWait = step === 4 && newRouter?.id && (
      form.connectionMethod === 'agent'
      || (form.connectionMethod === 'cloudflare_tunnel' && String(form.routerType || '').startsWith('mikrotik'))
    )
    if (!needsWait) {
      setAgentWaitStatus('idle')
      waitStartedRef.current = null
      return
    }

    setAgentWaitStatus('waiting')
    waitStartedRef.current = Date.now()
    let cancelled = false

    const poll = async () => {
      if (cancelled || !newRouter?.id) return
      const elapsed = Date.now() - (waitStartedRef.current || Date.now())
      if (elapsed >= 5 * 60 * 1000) {
        setAgentWaitStatus(prev => (prev === 'connected' ? prev : 'timeout'))
        return
      }
      try {
        const res = await api().get(`/routers/${newRouter.id}/stats`)
        if (!cancelled && res.data?.connected) {
          setAgentWaitStatus('connected')
          return
        }
      } catch {
        /* 503 = aún no conectado */
      }
    }

    poll()
    const interval = setInterval(poll, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [step, newRouter?.id, form.connectionMethod, form.routerType])

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
      if (res.data.id) {
        try {
          if (form.routerType?.startsWith('mikrotik')) {
            const scriptRes = await api().get(`/routers/${res.data.id}/mikrotik-script`)
            setMikrotikScript({ kind: 'mikrotik', ...scriptRes.data })
          } else if (form.routerType?.startsWith('edgerouter')) {
            const scriptRes = await api().get(`/routers/${res.data.id}/edgeos-script`)
            setMikrotikScript({ kind: 'edgeos', ...scriptRes.data })
          }
        } catch { /* script opcional */ }
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

  function openCredentials(router: any, tab: 'credentials' | 'script' = 'credentials') {
    setEditingRouter(router)
    setRouterModalTab(tab)
    setRouterScript(null)
    setScriptError('')
    setCredForm({
      routerUser: router.credentials?.routerUser || (String(router.credentials?.routerType || '').startsWith('edgerouter') ? 'ubnt' : 'admin'),
      routerPass: '',
      tunnelToken: '',
      tunnelHostname: router.credentials?.tunnelHostname
        || (String(router.ipAddress || '').includes('fibranexus.cl') ? router.ipAddress : '')
        || '',
      routerPort: router.credentials?.routerPort || '443',
      connectionMethod: resolveConnectionMethod(router),
      parentRouterId: router.credentials?.parentRouterId || '',
    })
    setCredTestResult(null)
    if (tab === 'script') loadRouterScript(router)
  }

  async function loadRouterScript(router: any) {
    if (!router?.id) return
    setScriptLoading(true)
    setScriptError('')
    setRouterScript(null)
    try {
      const rt = String(router.credentials?.routerType || '')
      if (rt.startsWith('mikrotik')) {
        const res = await api().get(`/routers/${router.id}/mikrotik-script`)
        setRouterScript({ kind: 'mikrotik', ...res.data })
      } else if (rt.startsWith('edgerouter')) {
        const res = await api().get(`/routers/${router.id}/edgeos-script`)
        setRouterScript({ kind: 'edgeos', ...res.data })
      } else {
        setScriptError('Este tipo de equipo no tiene script automático. Usa MikroTik o EdgeRouter.')
      }
    } catch (e: any) {
      setScriptError(e.response?.data?.error || e.message)
    }
    setScriptLoading(false)
  }

  function routerScriptText(script: any): string {
    if (!script) return ''
    if (script.kind === 'edgeos') return script.installScript || script.heartbeatScript || ''
    return script.fullSetupScript || script.script || ''
  }

  function renderScriptPanel(script: any, router?: any, opts?: { compact?: boolean }) {
    if (!script) return null
    const scriptKey = `panel-${script.kind}`
    const method = router ? resolveConnectionMethod(router) : script.connectionMethod
    const isEdge = script.kind === 'edgeos' || String(router?.credentials?.routerType || '').startsWith('edgerouter')

    return (
      <div className="space-y-4">
        {isEdge && method === 'cloudflare_tunnel' && (
          <div className="bg-sky-50 border border-sky-200 rounded-lg p-4">
            <p className="font-semibold text-sky-900 text-sm mb-2">Cloudflare (MikroTik de borde)</p>
            <p className="text-xs text-sky-800 mb-2">El túnel sigue en tu MikroTik. Publica el EdgeRouter con un hostname nuevo:</p>
            <ol className="space-y-1.5 text-xs text-ink-soft">
              <li>Zero Trust → Tunnels → tu túnel del MikroTik → Public Hostname</li>
              <li>URL: <code className="font-mono bg-surface-card px-1 rounded">https://{router?.credentials?.routerLocalIp || credForm.tunnelHostname || router?.ipAddress || '172.16.11.254'}:443</code></li>
              <li>Hostname: <strong>{router?.credentials?.tunnelHostname || credForm.tunnelHostname || 'nodo2-isp.fibranexus.cl'}</strong></li>
            </ol>
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="font-semibold text-blue-900 text-sm mb-1 flex items-center gap-2">
            <Terminal className="h-4 w-4" />
            {script.kind === 'edgeos'
              ? 'Script EdgeOS — antenas Ubiquiti (SNMP) + heartbeat'
              : script.publicIpMode === 'secure_auto'
                ? 'Script MikroTik — segura automática (cert + API + allowlist + heartbeat)'
                : 'Script MikroTik — heartbeat y monitoreo'}
          </p>
          <p className="text-xs text-blue-700">
            {script.kind === 'edgeos'
              ? 'SSH al EdgeRouter (ubnt@IP) → pegar script completo → Enter. Poll SNMP de CPEs AirMax en la LAN.'
              : script.publicIpMode === 'secure_auto'
                ? 'Winbox → New Terminal → pegar una vez. No abras www-ssl a todo internet: el script deja allowlist solo a FibraNexus.'
                : 'Winbox → New Terminal → pegar → Enter. Incluye heartbeat hacia FibraNexus.'}
          </p>
          {Array.isArray(script.egressCidrs) && script.egressCidrs.length > 0 && script.publicIpMode === 'secure_auto' && (
            <p className="text-xs text-blue-800 mt-2 font-mono">Allowlist: {script.egressCidrs.join(', ')}</p>
          )}
        </div>

        {script.natHint?.needed && script.natHint.script && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
            <p className="font-semibold text-amber-900 text-sm">Sugerencia NAT (MikroTik de borde)</p>
            <p className="text-xs text-amber-800">{script.natHint.summary}</p>
            <div className="bg-gray-900 rounded-lg p-3 relative max-h-40 overflow-y-auto">
              <code className="text-amber-300 text-xs block whitespace-pre-wrap break-all font-mono">{script.natHint.script}</code>
              <button
                type="button"
                onClick={() => copyText(script.natHint.script, `${scriptKey}-nat`)}
                className="absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded"
              >
                {copied === `${scriptKey}-nat` ? <CheckCircle className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-white" />}
              </button>
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-ink-soft mb-2">Script completo</label>
          <div className={`bg-gray-900 rounded-lg p-3 relative overflow-y-auto ${opts?.compact ? 'max-h-48' : 'max-h-72'}`}>
            <code className="text-green-400 text-xs block whitespace-pre-wrap break-all font-mono">{routerScriptText(script)}</code>
            <button
              type="button"
              onClick={() => copyText(routerScriptText(script), scriptKey)}
              className="absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded"
            >
              {copied === scriptKey ? <CheckCircle className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5 text-gray-300" />}
            </button>
          </div>
        </div>

        {script.installInstructions?.length > 0 && (
          <div className="bg-surface rounded-lg p-4">
            <p className="text-sm font-medium text-ink-soft mb-2">Pasos</p>
            <ol className="space-y-1.5">
              {script.installInstructions.map((step: string, i: number) => (
                <li key={i} className="text-xs text-gray-600 flex items-start gap-2">
                  <span className="font-mono bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-xs flex-shrink-0">{i + 1}</span>
                  {step.replace(/^\d+\.\s*/, '')}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    )
  }

  async function saveCredentials() {
    if (!editingRouter) return
    if (!credForm.routerUser) {
      alert('Usuario API es obligatorio')
      return
    }
    const hasStored = editingRouter.hasApiCredentials || editingRouter.credentials?.hasRouterPass
    if (!credForm.routerPass && !hasStored) {
      alert('Contraseña API es obligatoria (o deja la existente)')
      return
    }
    setCredSaving(true)
    try {
      const payload: Record<string, unknown> = {
        routerUser: credForm.routerUser,
        tunnelHostname: credForm.tunnelHostname,
        routerPort: credForm.routerPort,
        connectionMethod: credForm.connectionMethod,
        parentRouterId: credForm.parentRouterId || null,
      }
      if (credForm.routerPass) payload.routerPass = credForm.routerPass
      if (credForm.tunnelToken) payload.tunnelToken = credForm.tunnelToken
      await api().patch(`/routers/${editingRouter.id}`, payload)
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
          parentRouterId: credForm.parentRouterId || null,
        })
      }
      const res = await api().post(`/routers/${editingRouter.id}/test-connection`)
      setCredTestResult({ success: true, data: res.data })
    } catch (e: any) {
      setCredTestResult({ success: false, error: e.response?.data?.error || e.message })
    }
    setCredTesting(false)
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
    setWizardHelpOpen(false)
    setWizardFamily(null)
    setAgentWaitStatus('idle')
    waitStartedRef.current = null
  }

  function applyRouterTypeSelection(rtValue: string) {
    const profile = DEVICE_PROFILES[rtValue]
    const base: any = { routerType: rtValue, connectionMethod: profile?.defaultMethod || 'direct' }
    if (String(rtValue).startsWith('mikrotik') && (profile?.defaultMethod || 'direct') === 'direct') {
      base.publicIpMode = 'secure_auto'
    }
    if (rtValue === 'edgerouter_v4') {
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
  }

  function selectDeviceFamily(family: DeviceFamily) {
    if (family.directValue) {
      setWizardFamily(family.id)
      applyRouterTypeSelection(family.directValue)
      return
    }
    setWizardFamily(prev => (prev === family.id ? null : family.id))
  }

  function goBackToStep1() {
    const fam = DEVICE_FAMILIES.find(f =>
      f.directValue === form.routerType
      || f.subtypes?.some(s => s.value === form.routerType),
    )
    setWizardFamily(fam?.id || null)
    setStep(1)
  }

  const selectedType = ROUTER_TYPES.find(t => t.value === form.routerType)
  const selectedMethod = CONNECTION_METHODS.find(m => m.value === form.connectionMethod)
  const defaultPort = form.routerType === 'mikrotik_v6' ? '8728' : '443'
  const isEdgeRouter = form.routerType === 'edgerouter_v4'
  const isMikroTik = String(form.routerType || '').startsWith('mikrotik')
  const isSecureAuto = isMikroTik && form.connectionMethod === 'direct' && (form.publicIpMode || 'secure_auto') === 'secure_auto'
  const isManualPublicIp = isMikroTik && form.connectionMethod === 'direct' && form.publicIpMode === 'manual'
  const wizardHelp = getWizardHelpGuide(form.routerType, form.connectionMethod)
  const wizardScriptText = mikrotikScript ? routerScriptText(mikrotikScript) : ''
  const installCmd = newRouter ? `AGENT_TOKEN=${newRouter.agentToken} ROUTER_IP=${form.routerIp || '192.168.X.X'} ROUTER_TYPE=${form.routerType} ROUTER_USER=${form.routerUser || 'admin'} ROUTER_PASS=${form.routerPass || 'TU_PASSWORD'} node fibranexus-agent.js` : ''
  const showAgentWait = step === 4 && newRouter?.id && (
    form.connectionMethod === 'agent'
    || (form.connectionMethod === 'cloudflare_tunnel' && String(form.routerType || '').startsWith('mikrotik'))
  )

  return (
    <div className="flex-1 overflow-auto bg-surface">
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-card rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
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
              {/* PASO 1 — Fabricante → subtipo */}
              {step === 1 && (
                <div>
                  <p className="text-sm text-ink-muted mb-4">¿Qué tipo de dispositivo quieres agregar?</p>
                  {wizardFamily && (
                    <button
                      type="button"
                      onClick={() => setWizardFamily(null)}
                      className="mb-3 text-xs font-medium text-blue-600 hover:underline inline-flex items-center gap-1"
                    >
                      ← Cambiar fabricante
                    </button>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {DEVICE_FAMILIES.map(family => {
                      const selected = wizardFamily === family.id
                      const dimmed = wizardFamily != null && !selected
                      const FamilyIcon = family.icon
                      return (
                        <div key={family.id} className={`transition-all duration-300 ${dimmed ? 'opacity-40 scale-[0.98]' : 'opacity-100'}`}>
                          <button
                            type="button"
                            onClick={() => selectDeviceFamily(family)}
                            className={`w-full text-left p-4 border-2 rounded-xl transition ${
                              selected
                                ? family.borderActive
                                : 'border-line hover:border-blue-400 hover:bg-blue-50/50'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${family.iconBg}`}>
                                <FamilyIcon className={`h-5 w-5 ${family.iconColor}`} />
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-sm text-ink">{family.label}</p>
                                <p className="text-xs text-ink-muted mt-0.5">{family.description}</p>
                              </div>
                            </div>
                          </button>

                          {selected && family.subtypes && family.subtypes.length > 0 && (
                            <div
                              className="mt-2 space-y-2 overflow-hidden"
                              style={{ animation: 'wizardSubtypeIn 0.28s ease-out' }}
                            >
                              {family.subtypes.map(st => (
                                <button
                                  key={st.value}
                                  type="button"
                                  onClick={() => applyRouterTypeSelection(st.value)}
                                  className="w-full text-left p-3 rounded-xl border-2 border-dashed border-line hover:border-blue-500 hover:bg-surface-card bg-surface/80 transition"
                                >
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="font-medium text-sm text-ink">{st.label}</p>
                                    {st.recommended && (
                                      <span className="text-[10px] font-semibold uppercase tracking-wide bg-emerald-500 text-white px-2 py-0.5 rounded-full">
                                        Recomendado
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-ink-muted mt-0.5">{st.description}</p>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <style>{`
                    @keyframes wizardSubtypeIn {
                      from { opacity: 0; transform: translateY(-6px); }
                      to { opacity: 1; transform: translateY(0); }
                    }
                  `}</style>
                </div>
              )}

              {/* PASO 2 — Método de conexión */}
              {step === 2 && (
                <div>
                  <div className="bg-blue-50 rounded-lg px-4 py-2 flex items-center gap-3 mb-4">
                    <Server className="h-4 w-4 text-blue-600" />
                    <p className="text-sm font-medium text-blue-900">{selectedType?.label}</p>
                    <button onClick={goBackToStep1} className="ml-auto text-xs text-blue-600 hover:underline">Cambiar</button>
                  </div>
                  <p className="text-sm text-ink-muted mb-2">¿Cómo se conectará FibraNexus a tu equipo?</p>
                  {DEVICE_PROFILES[form.routerType]?.hint && (
                    <p className="text-xs text-gray-600 bg-surface border rounded-lg px-3 py-2 mb-4">{DEVICE_PROFILES[form.routerType].hint}</p>
                  )}
                  <div className="space-y-3">
                    {methodsForDevice(form.routerType).map(m => (
                      <button key={m.value} onClick={() => {
                        const next: any = { ...form, connectionMethod: m.value }
                        if (String(form.routerType || '').startsWith('mikrotik') && m.value === 'direct') {
                          next.publicIpMode = form.publicIpMode || 'secure_auto'
                        }
                        setForm(next)
                        setStep(3)
                      }}
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
                            <p className="text-xs text-ink-muted mb-2">{m.description}</p>
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
                      <button onClick={goBackToStep1} className="ml-auto text-xs text-blue-600 hover:underline">Cambiar</button>
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
                    <label className="block text-sm font-medium text-ink-soft mb-1">Nombre del equipo <span className="text-red-500">*</span></label>
                    <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" placeholder="ej: Router Nodo Central" value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} />
                  </div>

                  {isMikroTik && form.connectionMethod === 'direct' && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-ink-soft">Modo de acceso</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, publicIpMode: 'secure_auto', routerUser: undefined, routerPass: undefined })}
                          className={`text-left p-3 rounded-xl border-2 transition ${
                            (form.publicIpMode || 'secure_auto') === 'secure_auto'
                              ? 'border-emerald-500 bg-emerald-50'
                              : 'border-line hover:border-emerald-300'
                          }`}
                        >
                          <p className="text-sm font-semibold text-ink">Segura automática</p>
                          <p className="text-xs text-ink-muted mt-0.5">Recomendado · un script crea API + allowlist</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, publicIpMode: 'manual' })}
                          className={`text-left p-3 rounded-xl border-2 transition ${
                            form.publicIpMode === 'manual'
                              ? 'border-amber-500 bg-amber-50'
                              : 'border-line hover:border-amber-300'
                          }`}
                        >
                          <p className="text-sm font-semibold text-ink">Manual</p>
                          <p className="text-xs text-ink-muted mt-0.5">Ya tienes REST API · usuario/clave</p>
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-ink-soft mb-1">
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
                        placeholder={form.connectionMethod === 'cloudflare_tunnel' ? '192.168.3.253' : form.connectionMethod === 'agent' ? (isEdgeRouter ? '192.168.2.1' : '192.168.1.1') : isEdgeRouter ? '192.168.2.1' : '190.217.242.4'} 
                        value={form.routerIp || ''} onChange={e => setForm({ ...form, routerIp: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-ink-soft mb-1">Puerto</label>
                      <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 font-mono" 
                        placeholder={defaultPort} 
                        value={form.routerPort || ''} onChange={e => setForm({ ...form, routerPort: e.target.value })} />
                    </div>
                  </div>

                  {isMikroTik && form.connectionMethod === 'direct' && (form.publicIpMode || 'secure_auto') === 'secure_auto' && (
                    <div>
                      <label className="block text-sm font-medium text-ink-soft mb-1">IP local del MikroTik (LAN)</label>
                      <input
                        className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 font-mono"
                        placeholder="192.168.3.253"
                        value={form.routerLocalIp || ''}
                        onChange={e => setForm({ ...form, routerLocalIp: e.target.value })}
                      />
                      <p className="text-xs text-ink-muted mt-1">Si está detrás de un borde, sirve para sugerir el dst-nat. El script crea el usuario <code className="font-mono">fibranexus</code> automáticamente.</p>
                    </div>
                  )}

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
                            <label className="block text-sm font-medium text-ink-soft mb-1">MikroTik de borde (opcional)</label>
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
                        <label className="block text-sm font-medium text-ink-soft mb-1">
                          {isEdgeRouter ? 'Hostname Cloudflare del EdgeRouter' : 'Hostname del túnel'} <span className="text-red-500">*</span>
                        </label>
                        <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 font-mono" 
                          placeholder={isEdgeRouter ? 'nodo2-isp.fibranexus.cl' : 'l009-cliente.fibranexus.cl'} 
                          value={form.tunnelHostname || ''} onChange={e => setForm({ ...form, tunnelHostname: e.target.value })} />
                        {isEdgeRouter && (
                          <p className="text-xs text-ink-muted mt-1">En Cloudflare Zero Trust → tu túnel → Public Hostname → URL: <code className="font-mono">https://IP_LOCAL:443</code></p>
                        )}
                      </div>
                      {!isEdgeRouter && (
                        <div>
                          <label className="block text-sm font-medium text-ink-soft mb-1">Token del túnel <span className="text-red-500">*</span></label>
                          <input type="password" className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 font-mono text-xs" 
                            placeholder="eyJhIjoi..." 
                            value={form.tunnelToken || ''} onChange={e => setForm({ ...form, tunnelToken: e.target.value })} />
                          <p className="text-xs text-ink-muted mt-1">Cloudflare Zero Trust → Networks → Tunnels → copiar token</p>
                        </div>
                      )}
                    </div>
                  )}

                  {isEdgeRouter && (
                    <div className="space-y-3 p-4 bg-violet-50 border border-violet-200 rounded-xl">
                      <p className="text-sm font-medium text-violet-900">Red del nodo (LAN clientes)</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-ink-soft mb-1">Subred LAN</label>
                          <input className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                            placeholder="192.168.2.0/24"
                            value={form.lanSubnet || ''}
                            onChange={e => setForm({ ...form, lanSubnet: e.target.value })} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-ink-soft mb-1">Interfaz LAN</label>
                          <input className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                            placeholder="ether2"
                            value={form.lanInterface || ''}
                            onChange={e => setForm({ ...form, lanInterface: e.target.value })} />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ink-soft mb-1">Shared network DHCP (EdgeOS)</label>
                        <input className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                          placeholder="LAN"
                          value={form.dhcpSharedNetwork || ''}
                          onChange={e => setForm({ ...form, dhcpSharedNetwork: e.target.value })} />
                        <p className="text-xs text-ink-muted mt-1">Nombre del shared-network en EdgeOS donde vive la subred de clientes.</p>
                      </div>
                    </div>
                  )}

                  {(!isSecureAuto) && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-ink-soft mb-1">Usuario del router <span className="text-red-500">*</span></label>
                      <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" 
                        placeholder="admin" 
                        value={form.routerUser || ''} onChange={e => setForm({ ...form, routerUser: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-ink-soft mb-1">Contraseña <span className="text-red-500">*</span></label>
                      <div className="flex gap-1">
                        <input type={showPass ? 'text' : 'password'} className="flex-1 border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" 
                          placeholder="••••••••" 
                          value={form.routerPass || ''} onChange={e => setForm({ ...form, routerPass: e.target.value })} />
                        <button onClick={() => setShowPass(!showPass)} className="p-2 border rounded-lg hover:bg-surface-raised">
                          {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                  )}

                  {isManualPublicIp && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-800">Si www-ssl queda abierto a todo internet (`0.0.0.0/0`), cualquiera puede intentar entrar a la API. Prefiere Segura automática.</p>
                    </div>
                  )}

                  {isSecureAuto && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex gap-2">
                      <Shield className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-emerald-900">Al registrar se genera el usuario <strong>fibranexus</strong> y una clave. El script las aplica en el MikroTik y deja www-ssl solo para las IPs de FibraNexus.</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-ink-soft mb-1">Ubicación/Nodo</label>
                      <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" placeholder="ej: Nodo Centro" value={form.location || ''} onChange={e => setForm({ ...form, location: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-ink-soft mb-1">Modelo</label>
                      <input className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" placeholder="ej: L009, CCR1036" value={form.model || ''} onChange={e => setForm({ ...form, model: e.target.value })} />
                    </div>
                  </div>

                  {/* Test de conexión */}
                  {!isSecureAuto && form.connectionMethod !== 'agent' && form.routerUser && form.routerPass && (form.connectionMethod === 'cloudflare_tunnel' ? form.tunnelHostname : form.routerIp) && (
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

                  {wizardHelp && (
                    <WizardHelpPanel
                      guide={wizardHelp}
                      open={wizardHelpOpen}
                      onToggle={() => setWizardHelpOpen(v => !v)}
                      onCopy={copyText}
                      copiedKey={copied}
                    />
                  )}

                  <div className="flex gap-3 pt-2">
                    <button onClick={() => setStep(2)} className="flex-1 py-2.5 border rounded-lg hover:bg-surface-raised font-medium">Atrás</button>
                    <button onClick={handleCreate} disabled={
                      !form.name
                      || (!isSecureAuto && form.connectionMethod !== 'agent' && (!form.routerUser || !form.routerPass))
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
                  <div className={`rounded-lg p-4 flex items-center gap-3 border ${
                    agentWaitStatus === 'connected'
                      ? 'bg-green-50 border-green-200'
                      : 'bg-green-50 border-green-200'
                  }`}>
                    <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-green-900">Router registrado exitosamente</p>
                      <p className="text-sm text-green-700">
                        {form.connectionMethod === 'agent' || showAgentWait
                          ? 'Instala el script en tu equipo y espera la primera conexión'
                          : 'Las credenciales están guardadas de forma segura'}
                      </p>
                    </div>
                  </div>

                  {/* Script de instalación con token real */}
                  {mikrotikScript ? (
                    <div className="space-y-3">
                      {renderScriptPanel(mikrotikScript, {
                        ...newRouter,
                        credentials: {
                          ...newRouter.credentials,
                          routerType: form.routerType,
                          connectionMethod: form.connectionMethod,
                          tunnelHostname: form.tunnelHostname,
                          routerLocalIp: form.routerIp,
                        },
                      })}
                      {wizardScriptText && (
                        <button
                          type="button"
                          onClick={() => copyText(wizardScriptText, 'wizard-script')}
                          className="w-full py-2.5 bg-surface-card text-white rounded-lg hover:bg-surface-raised font-medium flex items-center justify-center gap-2"
                        >
                          {copied === 'wizard-script'
                            ? <><CheckCircle className="h-4 w-4 text-emerald-400" /> Script copiado</>
                            : <><Copy className="h-4 w-4" /> Copiar script</>}
                        </button>
                      )}
                    </div>
                  ) : form.connectionMethod === 'cloudflare_tunnel' && isEdgeRouter ? (
                    <div className="space-y-4">
                      <div className="bg-sky-50 border border-sky-200 rounded-lg p-4">
                        <p className="font-semibold text-sky-900 text-sm mb-2">☁️ Un paso en Cloudflare (2 minutos)</p>
                        <p className="text-xs text-sky-800 mb-3">El cloudflared sigue en tu MikroTik. Solo publica el EdgeRouter con un hostname nuevo:</p>
                        <ol className="space-y-2 text-xs text-ink-soft">
                          <li className="flex gap-2"><span className="w-6 h-6 rounded-full bg-sky-600 text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">1</span> Cloudflare Zero Trust → Networks → Tunnels → el mismo túnel del MikroTik</li>
                          <li className="flex gap-2"><span className="w-6 h-6 rounded-full bg-sky-600 text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">2</span> Public Hostname → Add: <strong>{form.tunnelHostname || 'nodo2-isp.fibranexus.cl'}</strong></li>
                          <li className="flex gap-2"><span className="w-6 h-6 rounded-full bg-sky-600 text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">3</span> Service: <code className="font-mono bg-surface-card px-1 rounded">https://{form.routerIp || '172.16.11.254'}:443</code></li>
                          <li className="flex gap-2"><span className="w-6 h-6 rounded-full bg-sky-600 text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">4</span> En el MikroTik: ruta a la subred del EdgeRouter (si no existe)</li>
                          <li className="flex gap-2"><span className="w-6 h-6 rounded-full bg-sky-600 text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">5</span> Pulsa &quot;Probar conexión&quot; en FibraNexus — debe quedar Online en ~1 min</li>
                        </ol>
                      </div>
                      <div className="bg-surface rounded-lg p-3 text-sm">
                        <div className="flex justify-between"><span>Hostname:</span><span className="font-mono text-xs">{form.tunnelHostname}</span></div>
                        <div className="flex justify-between mt-1"><span>IP local EdgeRouter:</span><span className="font-mono text-xs">{form.routerIp}</span></div>
                      </div>
                    </div>
                  ) : form.connectionMethod === 'agent' ? (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-ink-soft mb-2 flex items-center gap-2">
                          <Shield className="h-4 w-4 text-blue-600" /> Token del agente
                          <span className="text-xs text-red-500">(guárdalo — no se mostrará de nuevo)</span>
                        </label>
                        <div className="flex gap-2">
                          <div className="flex-1 font-mono text-sm bg-gray-900 text-green-400 rounded-lg px-3 py-2 overflow-x-auto">
                            {showToken ? newRouter.agentToken : '••••••••••••••••••••••••••••••••••••'}
                          </div>
                          <button onClick={() => setShowToken(!showToken)} className="p-2 border rounded-lg hover:bg-surface-raised">
                            {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                          <button onClick={() => copyText(newRouter.agentToken, 'token')} className="p-2 border rounded-lg hover:bg-surface-raised">
                            {copied === 'token' ? <CheckCircle className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ink-soft mb-2 flex items-center gap-2">
                          <Terminal className="h-4 w-4" /> Comando de instalación
                        </label>
                        <div className="bg-gray-900 rounded-lg p-3 relative">
                          <code className="text-green-400 text-xs block whitespace-pre-wrap break-all pr-10">{installCmd}</code>
                          <button onClick={() => copyText(installCmd, 'cmd')} className="absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded">
                            {copied === 'cmd' ? <CheckCircle className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5 text-gray-300" />}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyText(installCmd, 'wizard-script')}
                          className="mt-2 w-full py-2.5 bg-surface-card text-white rounded-lg hover:bg-surface-raised font-medium flex items-center justify-center gap-2"
                        >
                          {copied === 'wizard-script'
                            ? <><CheckCircle className="h-4 w-4 text-emerald-400" /> Script copiado</>
                            : <><Copy className="h-4 w-4" /> Copiar script</>}
                        </button>
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

                  {/* Esperando conexión del agente */}
                  {showAgentWait && (
                    <div className={`rounded-xl border p-4 ${
                      agentWaitStatus === 'connected'
                        ? 'bg-emerald-50 border-emerald-200'
                        : agentWaitStatus === 'timeout'
                          ? 'bg-amber-50 border-amber-200'
                          : 'bg-surface-card border-line text-ink'
                    }`}>
                      {agentWaitStatus === 'connected' ? (
                        <div className="flex items-center gap-3">
                          <CheckCircle className="h-6 w-6 text-emerald-600 flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-emerald-900">✅ Router conectado exitosamente</p>
                            <p className="text-sm text-emerald-700">El agente ya envía heartbeat a FibraNexus.</p>
                          </div>
                        </div>
                      ) : agentWaitStatus === 'timeout' ? (
                        <div className="space-y-3">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="font-semibold text-amber-900">Aún no detectamos conexión</p>
                              <p className="text-sm text-amber-800 mt-1">
                                Revisa que el script/scheduler esté activo en el router. Puedes cerrar este asistente y volver más tarde.
                              </p>
                            </div>
                          </div>
                          <a
                            href="https://github.com/Isai-1234/FibraNexus-Manager/blob/main/docs/arquitectura.md"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:underline"
                          >
                            <BookOpen className="h-4 w-4" /> ¿Necesitas ayuda? Ver documentación
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      ) : (
                        <div className="flex items-start gap-3">
                          <Loader2 className="h-5 w-5 text-sky-400 animate-spin flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="font-semibold text-ink">Esperando conexión...</p>
                            <p className="text-xs text-ink-muted mt-1">
                              Consultando el agente cada 5 segundos. Suele tardar menos de un minuto tras pegar el script.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {(agentWaitStatus === 'connected' || agentWaitStatus === 'timeout' || !showAgentWait) && (
                    <button onClick={resetForm} className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
                      Listo
                    </button>
                  )}
                  {showAgentWait && agentWaitStatus === 'waiting' && (
                    <button
                      type="button"
                      onClick={resetForm}
                      className="w-full py-2 text-sm text-ink-muted hover:text-ink-soft"
                    >
                      Cerrar y continuar después
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <header className="bg-surface-card border-b border-line px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-surface-raised rounded-lg text-ink"><ArrowLeft className="h-5 w-5" /></button>
          <div>
            <h1 className="text-xl font-bold text-ink">Gestión de Routers</h1>
            <p className="text-sm text-ink-muted">{routers.length} router{routers.length !== 1 ? 's' : ''} registrado{routers.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <ThemeToggle />
          <button onClick={loadRouters} className="px-4 py-2 border border-line rounded-lg hover:bg-surface-raised text-sm font-medium flex items-center gap-2 text-ink"><RefreshCw className="h-4 w-4" /> Actualizar</button>
          <button onClick={() => { setShowForm(true); setWizardFamily(null); setStep(1) }} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2"><Plus className="h-4 w-4" /> Agregar Router</button>
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
          <div className="bg-surface-card rounded-xl border border-line shadow-sm text-center py-20 px-8">
            <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4"><Server className="h-8 w-8 text-blue-400" /></div>
            <h3 className="text-lg font-semibold text-ink mb-2">Sin routers registrados</h3>
            <p className="text-ink-muted mb-6 max-w-md mx-auto">Agrega tu primer router para gestionar tu red desde FibraNexus.</p>
            <button onClick={() => { setShowForm(true); setWizardFamily(null); setStep(1) }} className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium inline-flex items-center gap-2"><Plus className="h-4 w-4" /> Agregar primer router</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {routers.map((router: any) => {
              const method = resolveConnectionMethod(router)
              const methodInfo = CONNECTION_METHODS.find(m => m.value === method)
              const MethodIcon = methodInfo?.icon || Globe
              const info = router.routerInfo || (router.firmware ? { version: router.firmware } : null)
              const online = isRouterOnline(router)
              const host = resolveHost(router)
              return (
                <div key={router.id} className="bg-surface-card rounded-xl border border-line shadow-sm hover:shadow-md transition p-5">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${online ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></div>
                      <div>
                        <h3 className="font-bold text-ink">{router.name}</h3>
                        <p className="text-xs text-ink-muted">{router.brand} {router.model}</p>
                      </div>
                    </div>
                    <button onClick={() => handleDelete(router.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"><Trash2 className="h-4 w-4" /></button>
                  </div>

                  {online && info && (
                    <div className="grid grid-cols-3 gap-2 mb-4 p-3 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="text-center">
                        <p className="text-[10px] uppercase text-gray-400 font-semibold">{router.credentials?.routerType === 'edgerouter_v4' ? 'EdgeOS' : 'RouterOS'}</p>
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
                      <span className="text-ink-muted">Host</span>
                      <span className="font-mono text-xs flex items-center gap-1">
                        {host ? (
                          <a
                            href={`https://${host}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {host}
                          </a>
                        ) : (
                          <button onClick={() => handleSetHost(router.id, null)} className="text-blue-600 hover:underline text-xs">+ Agregar host</button>
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between"><span className="text-ink-muted">Ubicación</span><span>{router.location || '—'}</span></div>
                    {router.credentials?.lanSubnet && (
                      <div className="flex justify-between"><span className="text-ink-muted">LAN nodo</span><span className="font-mono text-xs">{router.credentials.lanSubnet} · {router.credentials.lanInterface || '—'}</span></div>
                    )}
                    {!info && router.firmware && (
                      <div className="flex justify-between"><span className="text-ink-muted">Firmware</span><span className="text-xs">{router.firmware}</span></div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-ink-muted">Tipo</span>
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                        {ROUTER_TYPES.find(t => t.value === router.credentials?.routerType)?.label || router.brand}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-ink-muted">Conexión</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${method === 'cloudflare_tunnel' ? 'bg-sky-100 text-sky-800' : 'bg-blue-100 text-blue-700'}`}>
                        <MethodIcon className="h-3 w-3" /> {methodInfo?.label || 'IP directa'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-ink-muted">API REST</span>
                      {router.hasApiCredentials ? (
                        <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Configurada</span>
                      ) : (
                        <span className="text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full">Sin credenciales</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 mb-3">
                    <button onClick={() => openCredentials(router, 'credentials')}
                      className="flex-1 py-2 text-sm font-medium border rounded-lg hover:bg-surface-raised text-blue-700 border-blue-200">
                      {router.hasApiCredentials ? 'Editar API' : 'Configurar API'}
                    </button>
                    {(String(router.credentials?.routerType || '').startsWith('mikrotik')
                      || String(router.credentials?.routerType || '').startsWith('edgerouter')) && (
                      <button
                        onClick={() => openCredentials(router, 'script')}
                        className="flex-1 py-2 text-sm font-medium border rounded-lg hover:bg-surface-raised text-purple-700 border-purple-200 flex items-center justify-center gap-1"
                      >
                        <Terminal className="h-3.5 w-3.5" /> Script
                      </button>
                    )}
                  </div>
                  <div className={`rounded-lg px-3 py-2 flex items-center gap-2 text-sm ${online ? 'bg-green-50 text-green-700' : 'bg-surface text-amber-600'}`}>
                    {online ? <><CheckCircle className="h-4 w-4" /> Conectado</> : <><AlertTriangle className="h-4 w-4" /> Sin conexión</>}
                    {(router.agentLastSeen || router.lastSeen) && (
                      <span className="ml-auto text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(router.agentLastSeen || router.lastSeen).toLocaleTimeString('es-CL')}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {editingRouter && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`bg-surface-card rounded-xl p-6 w-full shadow-2xl max-h-[90vh] overflow-y-auto ${routerModalTab === 'script' ? 'max-w-2xl' : 'max-w-md'}`}>
            <div className="flex justify-between mb-4">
              <div>
                <h3 className="font-bold text-lg">{editingRouter.name}</h3>
                <p className="text-sm text-ink-muted">
                  {routerModalTab === 'script'
                    ? 'Script para pegar en el router (heartbeat + SNMP antenas)'
                    : 'Credenciales API para provisionar y monitorear'}
                </p>
              </div>
              <button type="button" onClick={() => { setEditingRouter(null); setRouterModalTab('credentials') }}><X className="h-5 w-5" /></button>
            </div>

            <div className="flex gap-1 bg-surface-raised rounded-lg p-1 mb-4">
              <button
                type="button"
                onClick={() => setRouterModalTab('credentials')}
                className={`flex-1 py-2 rounded-md text-sm font-medium ${routerModalTab === 'credentials' ? 'bg-surface-card shadow text-blue-700' : 'text-ink-muted'}`}
              >
                Credenciales API
              </button>
              {(String(editingRouter.credentials?.routerType || '').startsWith('mikrotik')
                || String(editingRouter.credentials?.routerType || '').startsWith('edgerouter')) && (
                <button
                  type="button"
                  onClick={() => { setRouterModalTab('script'); if (!routerScript) loadRouterScript(editingRouter) }}
                  className={`flex-1 py-2 rounded-md text-sm font-medium ${routerModalTab === 'script' ? 'bg-surface-card shadow text-purple-700' : 'text-ink-muted'}`}
                >
                  Script de instalación
                </button>
              )}
            </div>

            {routerModalTab === 'credentials' ? (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">
                  {String(editingRouter.credentials?.routerType || '').startsWith('edgerouter')
                    ? 'Hostname Cloudflare (acceso FibraNexus)'
                    : 'Host túnel / IP'}
                </label>
                <input className="w-full border rounded-lg px-3 py-2 mt-1 font-mono text-sm"
                  placeholder={String(editingRouter.credentials?.routerType || '').startsWith('edgerouter') ? 'nodo2-isp.fibranexus.cl' : 'l009-test.fibranexus.cl'}
                  value={credForm.tunnelHostname || ''}
                  onChange={e => setCredForm({ ...credForm, tunnelHostname: e.target.value })} />
                {String(editingRouter.credentials?.routerType || '').startsWith('edgerouter') && (
                  <p className="text-xs text-ink-muted mt-1">
                    IP local del EdgeRouter (LAN): <span className="font-mono">{editingRouter.credentials?.routerLocalIp || editingRouter.ipAddress || '—'}</span>
                    {' '}— se configura al registrar el router, no en este campo.
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium">Usuario API *</label>
                <input className="w-full border rounded-lg px-3 py-2 mt-1"
                  value={credForm.routerUser || ''}
                  onChange={e => setCredForm({ ...credForm, routerUser: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Contraseña API {editingRouter.hasApiCredentials || editingRouter.credentials?.hasRouterPass ? '(dejar vacío para no cambiar)' : '*'}</label>
                <input type="password" autoComplete="new-password" className="w-full border rounded-lg px-3 py-2 mt-1"
                  placeholder={editingRouter.hasApiCredentials || editingRouter.credentials?.hasRouterPass ? '••••••••' : ''}
                  value={credForm.routerPass || ''}
                  onChange={e => setCredForm({ ...credForm, routerPass: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Puerto HTTPS</label>
                <input className="w-full border rounded-lg px-3 py-2 mt-1"
                  value={credForm.routerPort || '443'}
                  onChange={e => setCredForm({ ...credForm, routerPort: e.target.value })} />
              </div>
              {routers.filter(r => r.id !== editingRouter.id && String(r.credentials?.routerType || '').startsWith('mikrotik')).length > 0 && (
                <div>
                  <label className="text-sm font-medium">Router upstream (borde)</label>
                  <select className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
                    value={credForm.parentRouterId || ''}
                    onChange={e => setCredForm({ ...credForm, parentRouterId: e.target.value || null })}>
                    <option value="">— Ninguno (router raíz) —</option>
                    {routers.filter(r => r.id !== editingRouter.id && String(r.credentials?.routerType || '').startsWith('mikrotik')).map(r => (
                      <option key={r.id} value={r.id}>{r.name} ({r.credentials?.tunnelHostname || r.ipAddress})</option>
                    ))}
                  </select>
                  <p className="text-xs text-ink-muted mt-1">Para EdgeRouter detrás de MikroTik: indica el router de borde en la topología.</p>
                </div>
              )}
              {credTestResult && (
                <div className={`text-sm p-3 rounded-lg ${credTestResult.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                  {credTestResult.success ? 'Conexión OK — router responde' : credTestResult.error}
                </div>
              )}
            </div>
            ) : (
              <div className="space-y-3">
                {scriptLoading && (
                  <div className="text-center py-8 text-ink-muted text-sm">Generando script…</div>
                )}
                {scriptError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">{scriptError}</div>
                )}
                {!scriptLoading && routerScript && renderScriptPanel(routerScript, editingRouter, { compact: false })}
                {!scriptLoading && !routerScript && !scriptError && (
                  <button
                    type="button"
                    onClick={() => loadRouterScript(editingRouter)}
                    className="w-full py-2 border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 text-sm font-medium"
                  >
                    Cargar script
                  </button>
                )}
              </div>
            )}

            {routerModalTab === 'credentials' ? (
            <div className="flex gap-2 mt-6">
              <button type="button" onClick={() => { setEditingRouter(null); setRouterModalTab('credentials') }} className="flex-1 py-2 border rounded-lg">Cancelar</button>
              <button type="button" onClick={testStoredCredentials} disabled={credTesting}
                className="flex-1 py-2 border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50">
                {credTesting ? 'Probando…' : 'Probar'}
              </button>
              <button type="button" onClick={saveCredentials} disabled={credSaving}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {credSaving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
            ) : (
            <div className="flex gap-2 mt-6">
              <button type="button" onClick={() => setRouterModalTab('credentials')} className="flex-1 py-2 border rounded-lg">← Credenciales</button>
              <button
                type="button"
                onClick={() => routerScript && copyText(routerScriptText(routerScript), 'modal-script')}
                disabled={!routerScript}
                className="flex-1 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-1"
              >
                <Copy className="h-4 w-4" /> Copiar script
              </button>
              <button type="button" onClick={() => { setEditingRouter(null); setRouterModalTab('credentials') }} className="flex-1 py-2 border rounded-lg">Cerrar</button>
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
