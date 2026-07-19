import { useState, useEffect } from 'react'
import { ArrowLeft, Save, Play, Settings, Plug, Download } from 'lucide-react'
import axios from 'axios'
import ThemeToggle from '../../components/ThemeToggle'

type BillingSettingsData = {
  billingAutoEnabled: boolean
  billingHour: number
  graceDaysBeforeSuspend: number
  autoSuspendEnabled: boolean
  stopBillingWhenSuspended: boolean
  autoMarkOverdue: boolean
  autoReactivateOnPayment: boolean
  debtNoticesEnabled: boolean
  suspendPortalUrl: string
  brandLogoUrl: string
  brandPrimaryColor: string
  brandAccentColor: string
  brandPortalTitle: string
  paymentProvider?: string
  flowApiUrl?: string
  hasFlowApiKey?: boolean
  hasFlowSecretKey?: boolean
  dteProvider?: string
  dteApiUrl?: string
  dteRutEmisor?: string
  dteRazonSocial?: string
  dteAmbiente?: string
  hasDteApiKey?: boolean
  flowDelegacionBoletaActiva?: boolean
  wisphubBaseUrl?: string
  hasWisphubApiKey?: boolean
}

type WisphubImportSummary = {
  ok?: boolean
  total?: number
  remoteCount?: number
  created?: number
  updated?: number
  errorCount?: number
  errors?: { wisphubId?: string; message?: string }[]
  error?: string
}

export default function BillingSettings({ API, onBack }: { API: string; onBack: () => void }) {
  const [settings, setSettings] = useState<BillingSettingsData | null>(null)
  const [orgName, setOrgName] = useState('')
  const [organizationId, setOrganizationId] = useState<number | null>(null)
  const [paymentGateway, setPaymentGateway] = useState<{ provider?: string; mode?: string; configured?: boolean } | null>(null)
  const [dteStatus, setDteStatus] = useState<{ provider?: string; mode?: string; configured?: boolean } | null>(null)
  const [wisphubStatus, setWisphubStatus] = useState<{ configured?: boolean; hasWisphubApiKey?: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [testingDte, setTestingDte] = useState(false)
  const [importingWisphub, setImportingWisphub] = useState(false)
  const [wisphubImportResult, setWisphubImportResult] = useState<WisphubImportSummary | null>(null)
  const [message, setMessage] = useState('')
  const [flowApiKeyInput, setFlowApiKeyInput] = useState('')
  const [flowSecretInput, setFlowSecretInput] = useState('')
  const [dteApiKeyInput, setDteApiKeyInput] = useState('')
  const [wisphubApiKeyInput, setWisphubApiKeyInput] = useState('')

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    })
  }

  useEffect(() => {
    api().get('/settings/billing')
      .then((r) => {
        setSettings(r.data.settings)
        setOrgName(r.data.organization || '')
        setOrganizationId(r.data.organizationId ?? null)
        setPaymentGateway(r.data.paymentGateway || null)
        setDteStatus(r.data.dteProvider || null)
        setWisphubStatus(r.data.wisphub || null)
      })
      .catch((err) => setMessage(err.response?.data?.error || err.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    if (!settings) return
    setSaving(true)
    setMessage('')
    try {
      const payload: any = { ...settings }
      delete payload.hasFlowApiKey
      delete payload.hasFlowSecretKey
      delete payload.hasWebpayCredentials
      delete payload.hasDteApiKey
      delete payload.hasWisphubApiKey
      if (flowApiKeyInput.trim()) payload.flowApiKey = flowApiKeyInput.trim()
      if (flowSecretInput.trim()) payload.flowSecretKey = flowSecretInput.trim()
      if (dteApiKeyInput.trim()) payload.dteApiKey = dteApiKeyInput.trim()
      if (wisphubApiKeyInput.trim()) payload.wisphubApiKey = wisphubApiKeyInput.trim()
      const res = await api().patch('/settings/billing', payload)
      setSettings(res.data.settings)
      setPaymentGateway(res.data.paymentGateway || null)
      setDteStatus(res.data.dteProvider || null)
      setWisphubStatus(res.data.wisphub || null)
      setFlowApiKeyInput('')
      setFlowSecretInput('')
      setDteApiKeyInput('')
      setWisphubApiKeyInput('')
      setMessage('Ajustes guardados correctamente')
    } catch (err: any) {
      setMessage('Error: ' + (err.response?.data?.error || err.message))
    }
    setSaving(false)
  }

  async function clearFlow() {
    if (!confirm('¿Quitar las credenciales de Flow y volver al modo stub?')) return
    setSaving(true)
    try {
      const res = await api().patch('/settings/billing', {
        clearFlowCredentials: true,
        paymentProvider: 'stub',
      })
      setSettings(res.data.settings)
      setPaymentGateway(res.data.paymentGateway || null)
      setFlowApiKeyInput('')
      setFlowSecretInput('')
      setMessage('Credenciales Flow eliminadas — modo stub')
    } catch (err: any) {
      setMessage('Error: ' + (err.response?.data?.error || err.message))
    }
    setSaving(false)
  }

  async function clearDte() {
    if (!confirm('¿Quitar la API key de facturación electrónica y volver al modo stub?')) return
    setSaving(true)
    try {
      const res = await api().patch('/settings/billing', {
        clearDteCredentials: true,
        dteProvider: 'stub',
      })
      setSettings(res.data.settings)
      setDteStatus(res.data.dteProvider || null)
      setDteApiKeyInput('')
      setMessage('Credenciales DTE eliminadas — modo stub')
    } catch (err: any) {
      setMessage('Error: ' + (err.response?.data?.error || err.message))
    }
    setSaving(false)
  }

  async function testDteConnection() {
    if (!organizationId) {
      setMessage('Error: no se pudo resolver el ID de organización')
      return
    }
    setTestingDte(true)
    setMessage('')
    try {
      const res = await api().post(`/orgs/${organizationId}/dte/test-connection`, {})
      setMessage(res.data.message || 'Conexión DTE OK')
      if (res.data.provider) {
        setDteStatus({
          provider: res.data.provider,
          mode: res.data.mode,
          configured: res.data.mode === 'live',
        })
      }
    } catch (err: any) {
      const data = err.response?.data
      setMessage('Error: ' + (data?.message || data?.error || err.message))
    }
    setTestingDte(false)
  }

  async function clearWisphub() {
    if (!confirm('¿Quitar la API key de WispHub?')) return
    setSaving(true)
    try {
      const res = await api().patch('/settings/billing', { clearWisphubCredentials: true })
      setSettings(res.data.settings)
      setWisphubStatus(res.data.wisphub || null)
      setWisphubApiKeyInput('')
      setMessage('Credenciales WispHub eliminadas')
    } catch (err: any) {
      setMessage('Error: ' + (err.response?.data?.error || err.message))
    }
    setSaving(false)
  }

  async function importWisphubClients() {
    if (!organizationId || !settings) {
      setMessage('Error: no se pudo resolver el ID de organización')
      return
    }

    const typedKey = wisphubApiKeyInput.trim()
    const baseUrl = String(settings.wisphubBaseUrl || '').trim()
    const hasSavedKey = Boolean(settings.hasWisphubApiKey)

    if (!baseUrl) {
      setMessage('Error: indica la URL base de WispHub y pulsa Guardar (o Importar, que también guarda).')
      return
    }
    if (!hasSavedKey && !typedKey) {
      setMessage('Error: pega la API Key de WispHub. Los puntos del navegador no cuentan si no guardaste.')
      return
    }
    if (!confirm('¿Importar (o actualizar) todos los clientes desde WispHub? Puede tardar varios minutos.')) return

    setImportingWisphub(true)
    setWisphubImportResult(null)
    setMessage('')

    try {
      // Si hay key/URL en el formulario, guardarlas ANTES de importar (evita "SIN KEY" + 0/0/0/0).
      if (typedKey || baseUrl) {
        const patchPayload: any = { wisphubBaseUrl: baseUrl }
        if (typedKey) patchPayload.wisphubApiKey = typedKey
        const saveRes = await api().patch('/settings/billing', patchPayload)
        setSettings(saveRes.data.settings)
        setWisphubStatus(saveRes.data.wisphub || null)
        setWisphubApiKeyInput('')
        if (!saveRes.data.settings?.hasWisphubApiKey && !saveRes.data.wisphub?.hasWisphubApiKey) {
          throw new Error('La API key no quedó guardada. Revisa CREDENTIALS_ENCRYPTION_KEY en el servidor.')
        }
      }

      const res = await api().post(
        `/orgs/${organizationId}/wisphub/importar-clientes`,
        {},
        { timeout: 10 * 60 * 1000 },
      )
      setWisphubImportResult({ ...res.data, ok: true })
      setMessage(
        `Importación WispHub: ${res.data.created ?? 0} creados, ${res.data.updated ?? 0} actualizados`
        + (res.data.errorCount ? `, ${res.data.errorCount} errores` : '')
        + (res.data.remoteCount != null ? ` (remotos: ${res.data.remoteCount})` : ''),
      )
    } catch (err: any) {
      const data = err.response?.data
      // No mostrar "resumen 0/0/0/0" como si hubiera corrido OK
      if (data && data.ok === false) {
        setWisphubImportResult(null)
        setMessage('Error: ' + (data.error || data.message || 'Importación falló (¿API key no guardada?)'))
      } else if (data && (data.created != null || data.total != null)) {
        setWisphubImportResult({ ...data, ok: data.ok !== false })
        setMessage('Error: ' + (data.error || data.message || err.message))
      } else {
        setWisphubImportResult(null)
        setMessage('Error: ' + (data?.error || data?.message || err.message))
      }
    }
    setImportingWisphub(false)
  }

  async function handleRunJobs() {
    if (!confirm('¿Ejecutar ahora facturación automática, marcar vencidas y suspender morosos según la configuración?')) return
    setRunning(true)
    setMessage('')
    try {
      const res = await api().post('/settings/billing/run-jobs')
      const r = res.data.result
      setMessage(
        `Jobs ejecutados — vencidas: ${r.overdueMarked ?? 0}, facturas: ${r.billing?.generated ?? 0}, suspendidos: ${r.suspend?.suspended ?? 0}`,
      )
    } catch (err: any) {
      setMessage('Error: ' + (err.response?.data?.error || err.message))
    }
    setRunning(false)
  }

  function toggle(key: keyof BillingSettingsData) {
    if (!settings) return
    setSettings({ ...settings, [key]: !settings[key] })
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-surface">
      <header className="bg-surface-card shadow-sm px-8 py-4 flex justify-between items-center sticky top-0 z-10 border-b border-line">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-surface-raised rounded-lg text-ink"><ArrowLeft className="h-5 w-5" /></button>
          <div>
            <h1 className="text-xl font-bold text-ink flex items-center gap-2">
              <Settings className="h-5 w-5 text-blue-600" /> Ajustes de facturación
            </h1>
            <p className="text-sm text-ink-muted">{orgName} — cobro automático, morosos y suspensión</p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <ThemeToggle />
          <button onClick={handleRunJobs} disabled={running}
            className="px-4 py-2 border border-line rounded-lg hover:bg-surface-raised text-sm font-medium flex items-center gap-2 disabled:opacity-50 text-ink">
            <Play className="h-4 w-4" /> {running ? 'Ejecutando…' : 'Ejecutar jobs ahora'}
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2 disabled:opacity-50">
            <Save className="h-4 w-4" /> {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </header>

      <main className="p-8 max-w-2xl">
        {message && (
          <div className={`mb-6 px-4 py-3 rounded-lg text-sm ${message.startsWith('Error') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-800 border border-green-200'}`}>
            {message}
          </div>
        )}

        {settings && (
          <div className="space-y-6">
            <section className="bg-surface-card rounded-xl border shadow-sm p-6 space-y-4">
              <h2 className="font-semibold text-ink">Pasarela de cobro online (tu cuenta Flow)</h2>
              <p className="text-sm text-ink-muted">
                Cada ISP configura su propia API de Flow. Las claves se guardan cifradas y no se vuelven a mostrar.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  paymentGateway?.mode === 'live'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {paymentGateway?.mode === 'live' ? 'LIVE' : 'STUB'}
                </span>
                <span className="text-sm text-ink-soft">
                  Proveedor activo: <strong>{paymentGateway?.provider || 'stub'}</strong>
                </span>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">Proveedor</label>
                <select
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={settings.paymentProvider || 'stub'}
                  onChange={(e) => setSettings({ ...settings, paymentProvider: e.target.value })}
                >
                  <option value="stub">Stub (pruebas internas, sin cobro real)</option>
                  <option value="flow">Flow.cl (tu comercio)</option>
                </select>
              </div>

              {(settings.paymentProvider === 'flow' || settings.hasFlowApiKey) && (
                <div className="space-y-3 pt-1 border-t border-line">
                  <div>
                    <label className="block text-sm font-medium text-ink-soft mb-1">Flow API Key</label>
                    <input
                      type="password"
                      autoComplete="off"
                      value={flowApiKeyInput}
                      onChange={(e) => setFlowApiKeyInput(e.target.value)}
                      placeholder={settings.hasFlowApiKey ? '•••••• ya configurada — escribe para cambiar' : 'Pega tu API Key de Flow'}
                      className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-soft mb-1">Flow Secret Key</label>
                    <input
                      type="password"
                      autoComplete="off"
                      value={flowSecretInput}
                      onChange={(e) => setFlowSecretInput(e.target.value)}
                      placeholder={settings.hasFlowSecretKey ? '•••••• ya configurada — escribe para cambiar' : 'Pega tu Secret Key de Flow'}
                      className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-soft mb-1">URL API Flow (opcional)</label>
                    <input
                      type="url"
                      value={settings.flowApiUrl || ''}
                      onChange={(e) => setSettings({ ...settings, flowApiUrl: e.target.value })}
                      placeholder="https://www.flow.cl/api (o sandbox)"
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Déjalo vacío para producción. Sandbox: según documentación Flow.
                    </p>
                  </div>
                  {(settings.hasFlowApiKey || settings.hasFlowSecretKey) && (
                    <button type="button" onClick={clearFlow} disabled={saving}
                      className="text-sm text-red-600 hover:underline disabled:opacity-50">
                      Quitar credenciales Flow
                    </button>
                  )}
                </div>
              )}
            </section>

            <section className="bg-surface-card rounded-xl border shadow-sm p-6 space-y-4">
              <h2 className="font-semibold text-ink">Facturación electrónica (SII)</h2>
              <p className="text-sm text-ink-muted">
                Emite DTE vía SimpleFactura (SimpleAPI). La API key se guarda cifrada y no se vuelve a mostrar.
                La emisión real al SII requiere además certificado digital y CAF en el request de emitir.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  dteStatus?.mode === 'live'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {dteStatus?.mode === 'live' ? 'LIVE' : 'STUB'}
                </span>
                <span className="text-sm text-ink-soft">
                  Proveedor activo: <strong>{dteStatus?.provider || settings.dteProvider || 'stub'}</strong>
                </span>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">Proveedor DTE</label>
                <select
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={settings.dteProvider || 'stub'}
                  onChange={(e) => setSettings({ ...settings, dteProvider: e.target.value })}
                >
                  <option value="stub">Stub (simulado, sin SII)</option>
                  <option value="simplefactura">SimpleFactura / SimpleAPI</option>
                </select>
              </div>

              {(settings.dteProvider === 'simplefactura' || settings.hasDteApiKey) && (
                <div className="space-y-3 pt-1 border-t border-line">
                  <div>
                    <label className="block text-sm font-medium text-ink-soft mb-1">RUT emisor</label>
                    <input
                      type="text"
                      value={settings.dteRutEmisor || ''}
                      onChange={(e) => setSettings({ ...settings, dteRutEmisor: e.target.value })}
                      placeholder="76.XXX.XXX-X"
                      className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-soft mb-1">Razón social</label>
                    <input
                      type="text"
                      value={settings.dteRazonSocial || ''}
                      onChange={(e) => setSettings({ ...settings, dteRazonSocial: e.target.value })}
                      placeholder="Tu ISP SpA"
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-soft mb-1">API Key SimpleAPI</label>
                    <input
                      type="password"
                      autoComplete="off"
                      value={dteApiKeyInput}
                      onChange={(e) => setDteApiKeyInput(e.target.value)}
                      placeholder={settings.hasDteApiKey ? '•••••• ya configurada — escribe para cambiar' : 'Pega tu API Key de SimpleAPI'}
                      className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-soft mb-1">Ambiente</label>
                    <select
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      value={settings.dteAmbiente || 'certificacion'}
                      onChange={(e) => setSettings({ ...settings, dteAmbiente: e.target.value })}
                    >
                      <option value="certificacion">Certificación (SII prueba)</option>
                      <option value="produccion">Producción</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-soft mb-1">URL API (opcional)</label>
                    <input
                      type="url"
                      value={settings.dteApiUrl || ''}
                      onChange={(e) => setSettings({ ...settings, dteApiUrl: e.target.value })}
                      placeholder="https://api.simpleapi.cl/api/v1"
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Vacío = https://api.simpleapi.cl/api/v1
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={testDteConnection}
                      disabled={testingDte || saving}
                      className="px-3 py-2 border border-line rounded-lg hover:bg-surface-raised text-sm font-medium flex items-center gap-2 disabled:opacity-50 text-ink"
                    >
                      <Plug className="h-4 w-4" />
                      {testingDte ? 'Probando…' : 'Probar conexión'}
                    </button>
                    {settings.hasDteApiKey && (
                      <button type="button" onClick={clearDte} disabled={saving}
                        className="text-sm text-red-600 hover:underline disabled:opacity-50">
                        Quitar credenciales DTE
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-line space-y-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 rounded"
                    checked={settings.flowDelegacionBoletaActiva !== false}
                    onChange={(e) => setSettings({
                      ...settings,
                      flowDelegacionBoletaActiva: e.target.checked,
                    })}
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink">Delegación de boleta Flow activa (SII)</span>
                    <span className="block text-xs text-ink-muted mt-0.5">
                      Si Flow ya emite boleta legal en el SII, déjalo activado: los pagos Flow no generan DTE desde FibraNexus
                      (evita duplicar boleta). Desactívalo solo el día que retires esa delegación en el portal del SII — nunca se cambia solo.
                    </span>
                  </span>
                </label>
              </div>
            </section>

            <section className="bg-surface-card rounded-xl border shadow-sm p-6 space-y-4">
              <h2 className="font-semibold text-ink">Importar desde WispHub</h2>
              <p className="text-sm text-ink-muted">
                Trae clientes desde la API de WispHub (solo lectura). Re-ejecutable: usa <code className="text-xs">wisphub_id</code> para no duplicar.
                No toca routers ni activa DTE — eso se hace después, cliente a cliente.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  settings.hasWisphubApiKey || wisphubStatus?.hasWisphubApiKey
                    ? 'bg-green-100 text-green-800'
                    : wisphubApiKeyInput.trim()
                      ? 'bg-sky-100 text-sky-800'
                      : 'bg-amber-100 text-amber-800'
                }`}>
                  {settings.hasWisphubApiKey || wisphubStatus?.hasWisphubApiKey
                    ? 'CONFIGURADO'
                    : wisphubApiKeyInput.trim()
                      ? 'EN FORMULARIO — se guarda al importar'
                      : 'SIN KEY GUARDADA'}
                </span>
              </div>
              <p className="text-xs text-ink-muted">
                Si el campo de API Key muestra puntos pero el badge dice SIN KEY, es autofill del navegador:
                vuelve a pegar la key y pulsa <strong>Importar clientes</strong> (guarda sola) o <strong>Guardar</strong> arriba.
              </p>
              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">URL base API (producción)</label>
                <input
                  type="url"
                  value={settings.wisphubBaseUrl || ''}
                  onChange={(e) => setSettings({ ...settings, wisphubBaseUrl: e.target.value })}
                  placeholder="https://api.wisphub.net  (o la URL de consulta de tu empresa)"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">
                  En WispHub: Mi Empresa → Empresa → “URL de consulta de API”. No uses sandbox.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">API Key WispHub</label>
                <input
                  type="password"
                  autoComplete="off"
                  value={wisphubApiKeyInput}
                  onChange={(e) => setWisphubApiKeyInput(e.target.value)}
                  placeholder={settings.hasWisphubApiKey ? '•••••• ya configurada — escribe para cambiar' : 'Pega tu API Key (Staff → Generar Mi APIKey)'}
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={importWisphubClients}
                  disabled={importingWisphub || saving || !organizationId}
                  className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  {importingWisphub ? 'Importando… (puede tardar)' : 'Importar clientes'}
                </button>
                {settings.hasWisphubApiKey && (
                  <button type="button" onClick={clearWisphub} disabled={saving || importingWisphub}
                    className="text-sm text-red-600 hover:underline disabled:opacity-50">
                    Quitar credenciales WispHub
                  </button>
                )}
              </div>
              {importingWisphub && (
                <div className="text-sm text-ink-soft flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                  Recorriendo páginas de WispHub (limit/offset)…
                </div>
              )}
              {wisphubImportResult && wisphubImportResult.ok !== false && !importingWisphub && (
                <div className="rounded-lg border border-line bg-surface-raised p-4 text-sm space-y-2">
                  <p className="font-medium text-ink">Resumen de importación</p>
                  <ul className="text-ink-soft space-y-1">
                    <li>Procesados: <strong>{wisphubImportResult.total ?? 0}</strong>
                      {wisphubImportResult.remoteCount != null ? ` (remotos: ${wisphubImportResult.remoteCount})` : ''}
                    </li>
                    <li>Creados: <strong>{wisphubImportResult.created ?? 0}</strong></li>
                    <li>Actualizados: <strong>{wisphubImportResult.updated ?? 0}</strong></li>
                    <li>Errores: <strong>{wisphubImportResult.errorCount ?? wisphubImportResult.errors?.length ?? 0}</strong></li>
                  </ul>
                  {(wisphubImportResult.errors?.length ?? 0) > 0 && (
                    <div className="max-h-40 overflow-auto text-xs text-red-700 space-y-1 border-t border-line pt-2">
                      {wisphubImportResult.errors!.slice(0, 30).map((e, i) => (
                        <div key={i}><code>{e.wisphubId}</code>: {e.message}</div>
                      ))}
                      {(wisphubImportResult.errors!.length > 30) && (
                        <div>… y {wisphubImportResult.errors!.length - 30} más</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="bg-surface-card rounded-xl border shadow-sm p-6 space-y-4">
              <h2 className="font-semibold text-ink">Facturación automática</h2>
              <p className="text-sm text-ink-muted">Genera facturas diariamente a la hora indicada para servicios con cobro pendiente.</p>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={settings.billingAutoEnabled} onChange={() => toggle('billingAutoEnabled')} className="rounded" />
                <span className="text-sm">Activar generación automática de facturas</span>
              </label>
              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">Hora de ejecución (0–23)</label>
                <input type="number" min={0} max={23} value={settings.billingHour}
                  onChange={(e) => setSettings({ ...settings, billingHour: parseInt(e.target.value, 10) || 8 })}
                  className="w-32 border rounded-lg px-3 py-2" />
                <p className="text-xs text-gray-400 mt-1">Ej: 8 = 08:00 AM hora del servidor</p>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={settings.stopBillingWhenSuspended} onChange={() => toggle('stopBillingWhenSuspended')} className="rounded" />
                <span className="text-sm">No facturar servicios suspendidos</span>
              </label>
            </section>

            <section className="bg-surface-card rounded-xl border shadow-sm p-6 space-y-4">
              <h2 className="font-semibold text-ink">Morosos y suspensión</h2>
              <p className="text-sm text-ink-muted">
                Marca facturas vencidas y suspende la IP del abonado (antena CPE o router en casa) en el EdgeRouter/MikroTik del nodo.
                No se suspende el router del sitio — solo el tráfico del cliente moroso con acceso al portal de pago.
              </p>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={settings.autoMarkOverdue} onChange={() => toggle('autoMarkOverdue')} className="rounded" />
                <span className="text-sm">Marcar facturas pendientes como vencidas automáticamente</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={settings.autoSuspendEnabled} onChange={() => toggle('autoSuspendEnabled')} className="rounded" />
                <span className="text-sm">Suspender IP del abonado por mora (walled garden)</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={settings.autoReactivateOnPayment} onChange={() => toggle('autoReactivateOnPayment')} className="rounded" />
                <span className="text-sm">Reactivar automáticamente al registrar un pago</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={!!settings.debtNoticesEnabled} onChange={() => toggle('debtNoticesEnabled')} className="rounded" />
                <span className="text-sm">Enviar avisos de deuda al correr jobs (console/email stub)</span>
              </label>
              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">Días de gracia antes de suspender</label>
                <input type="number" min={0} max={90} value={settings.graceDaysBeforeSuspend}
                  onChange={(e) => setSettings({ ...settings, graceDaysBeforeSuspend: parseInt(e.target.value, 10) || 0 })}
                  className="w-32 border rounded-lg px-3 py-2" />
                <p className="text-xs text-gray-400 mt-1">Ej: 5 = suspende si la factura lleva 5+ días vencida</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">URL pantalla de mora (cautiva)</label>
                <input type="url" value={settings.suspendPortalUrl || ''}
                  placeholder="https://app.fibranexus.cl/suspended"
                  onChange={(e) => setSettings({ ...settings, suspendPortalUrl: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
                <p className="text-xs text-gray-400 mt-1">
                  Página a la que el abonado suspendido puede acceder para pagar. Deja vacío para usar /suspended por defecto.
                </p>
              </div>
            </section>

            <section className="bg-surface-card rounded-xl border shadow-sm p-6 space-y-4">
              <h2 className="font-semibold text-ink">Marca del portal (abonados)</h2>
              <p className="text-sm text-ink-muted">
                Logo y colores que ve el abonado en su portal. Sin migración: se guarda en settings de la organización.
              </p>
              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">Título del portal</label>
                <input type="text" value={settings.brandPortalTitle || ''}
                  placeholder="Portal Cliente"
                  onChange={(e) => setSettings({ ...settings, brandPortalTitle: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">URL del logo</label>
                <input type="url" value={settings.brandLogoUrl || ''}
                  placeholder="https://…/logo.png"
                  onChange={(e) => setSettings({ ...settings, brandLogoUrl: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink-soft mb-1">Color primario</label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={settings.brandPrimaryColor || '#2563eb'}
                      onChange={(e) => setSettings({ ...settings, brandPrimaryColor: e.target.value })}
                      className="h-10 w-12 border rounded cursor-pointer" />
                    <input type="text" value={settings.brandPrimaryColor || '#2563eb'}
                      onChange={(e) => setSettings({ ...settings, brandPrimaryColor: e.target.value })}
                      className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-soft mb-1">Color acento</label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={settings.brandAccentColor || '#0ea5e9'}
                      onChange={(e) => setSettings({ ...settings, brandAccentColor: e.target.value })}
                      className="h-10 w-12 border rounded cursor-pointer" />
                    <input type="text" value={settings.brandAccentColor || '#0ea5e9'}
                      onChange={(e) => setSettings({ ...settings, brandAccentColor: e.target.value })}
                      className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono" />
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
