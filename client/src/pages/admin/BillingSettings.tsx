import { useState, useEffect } from 'react'
import { ArrowLeft, Save, Play, Settings } from 'lucide-react'
import axios from 'axios'

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
}

export default function BillingSettings({ API, onBack }: { API: string; onBack: () => void }) {
  const [settings, setSettings] = useState<BillingSettingsData | null>(null)
  const [orgName, setOrgName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')

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
      })
      .catch((err) => setMessage(err.response?.data?.error || err.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    if (!settings) return
    setSaving(true)
    setMessage('')
    try {
      const res = await api().patch('/settings/billing', settings)
      setSettings(res.data.settings)
      setMessage('Ajustes guardados correctamente')
    } catch (err: any) {
      setMessage('Error: ' + (err.response?.data?.error || err.message))
    }
    setSaving(false)
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
    <div className="flex-1 overflow-auto bg-gray-50">
      <header className="bg-white shadow-sm px-8 py-4 flex justify-between items-center sticky top-0 z-10 border-b">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft className="h-5 w-5" /></button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Settings className="h-5 w-5 text-blue-600" /> Ajustes de facturación
            </h1>
            <p className="text-sm text-gray-500">{orgName} — cobro automático, morosos y suspensión</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleRunJobs} disabled={running}
            className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm font-medium flex items-center gap-2 disabled:opacity-50">
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
            <section className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
              <h2 className="font-semibold text-gray-900">Facturación automática</h2>
              <p className="text-sm text-gray-500">Genera facturas diariamente a la hora indicada para servicios con cobro pendiente.</p>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={settings.billingAutoEnabled} onChange={() => toggle('billingAutoEnabled')} className="rounded" />
                <span className="text-sm">Activar generación automática de facturas</span>
              </label>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hora de ejecución (0–23)</label>
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

            <section className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
              <h2 className="font-semibold text-gray-900">Morosos y suspensión</h2>
              <p className="text-sm text-gray-500">
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Días de gracia antes de suspender</label>
                <input type="number" min={0} max={90} value={settings.graceDaysBeforeSuspend}
                  onChange={(e) => setSettings({ ...settings, graceDaysBeforeSuspend: parseInt(e.target.value, 10) || 0 })}
                  className="w-32 border rounded-lg px-3 py-2" />
                <p className="text-xs text-gray-400 mt-1">Ej: 5 = suspende si la factura lleva 5+ días vencida</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL pantalla de mora (cautiva)</label>
                <input type="url" value={settings.suspendPortalUrl || ''}
                  placeholder="https://app.fibranexus.cl/suspended"
                  onChange={(e) => setSettings({ ...settings, suspendPortalUrl: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
                <p className="text-xs text-gray-400 mt-1">
                  Página a la que el abonado suspendido puede acceder para pagar. Deja vacío para usar /suspended por defecto.
                </p>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
