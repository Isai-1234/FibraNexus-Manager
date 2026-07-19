import { useEffect, useState } from 'react'
import { X, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import axios from 'axios'
import { formatDateCL } from '../lib/formatDate'

type Props = {
  API: string
  service: any
  clientId: number
  onClose: () => void
  onSaved: () => void
}

function Section({ title, open, onToggle, children }: {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border border-line rounded-xl overflow-hidden bg-surface-card">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left font-medium text-ink hover:bg-surface-raised">
        <span>{title}</span>
        {open ? <ChevronDown className="h-4 w-4 text-ink-muted" /> : <ChevronRight className="h-4 w-4 text-ink-muted" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-3 border-t border-line pt-3">{children}</div>}
    </div>
  )
}

function moneyStr(v: any) {
  if (v == null || v === '') return ''
  return String(v)
}

export default function ServiceEditPanel({ API, service, clientId, onClose, onSaved }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    plan: true,
    contrato: true,
    facturas: true,
    descuentos: false,
    impuestos: false,
    atributos: false,
    preview: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  const [form, setForm] = useState({
    customPrice: moneyStr(service.customPrice),
    etiquetaFactura: service.etiquetaFactura || '',
    contratoTipo: service.contratoTipo || 'abierto',
    contratoId: service.contratoId || '',
    costoInstalacion: moneyStr(service.costoInstalacion),
    cargoCancelacionAnticipada: moneyStr(service.cargoCancelacionAnticipada),
    duracionMinimaMeses: service.duracionMinimaMeses != null ? String(service.duracionMinimaMeses) : '',
    diaComienzoPeriodo: String(service.diaComienzoPeriodo || service.billingDay || 1),
    tipoFacturacion: service.tipoFacturacion || 'retroactiva',
    prorratearPrimeraFactura: service.prorratearPrimeraFactura !== false,
    crearFacturaDiasAntes: String(service.crearFacturaDiasAntes ?? 0),
    facturarPorSeparado: Boolean(service.facturarPorSeparado),
    aprobarEnviarAutomaticamente: service.aprobarEnviarAutomaticamente !== false,
    usarCreditoAutomaticamente: service.usarCreditoAutomaticamente !== false,
    tipoDescuento: service.tipoDescuento || 'sin_descuento',
    valorDescuento: moneyStr(service.valorDescuento),
    impuestoOverride: moneyStr(service.impuestoOverride),
    billingDueDay: String(service.billingDueDay ?? 5),
    atributos: Object.entries(service.atributosPersonalizados || {}).map(([k, v]) => ({
      key: k,
      value: String(v ?? ''),
    })),
  })

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    })
  }

  function toggle(key: string) {
    setOpen((o) => ({ ...o, [key]: !o[key] }))
  }

  function setField(key: string, value: any) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function loadPreview(overrides?: Record<string, any>) {
    setLoadingPreview(true)
    try {
      const res = await api().get(`/services/${service.id}/billing-preview`, {
        params: { cantidad: 3 },
      })
      setPreview(res.data)
    } catch (e: any) {
      setPreview(null)
      if (!overrides) setError(e.response?.data?.error || e.message)
    }
    setLoadingPreview(false)
  }

  useEffect(() => {
    loadPreview()
  }, [service.id])

  function buildPayload() {
    const attrs: Record<string, string> = {}
    for (const row of form.atributos) {
      const k = row.key.trim()
      if (k) attrs[k] = row.value
    }
    return {
      customPrice: form.customPrice === '' ? null : Number(form.customPrice),
      etiquetaFactura: form.etiquetaFactura.trim() || null,
      contratoTipo: form.contratoTipo,
      contratoId: form.contratoId.trim() || null,
      costoInstalacion: form.costoInstalacion === '' ? null : Number(form.costoInstalacion),
      cargoCancelacionAnticipada: form.cargoCancelacionAnticipada === '' ? null : Number(form.cargoCancelacionAnticipada),
      duracionMinimaMeses: form.duracionMinimaMeses === '' ? null : Number(form.duracionMinimaMeses),
      diaComienzoPeriodo: Number(form.diaComienzoPeriodo) || 1,
      tipoFacturacion: form.tipoFacturacion,
      prorratearPrimeraFactura: form.prorratearPrimeraFactura,
      crearFacturaDiasAntes: Number(form.crearFacturaDiasAntes) || 0,
      facturarPorSeparado: form.facturarPorSeparado,
      aprobarEnviarAutomaticamente: form.aprobarEnviarAutomaticamente,
      usarCreditoAutomaticamente: form.usarCreditoAutomaticamente,
      tipoDescuento: form.tipoDescuento,
      valorDescuento: form.valorDescuento === '' ? null : Number(form.valorDescuento),
      impuestoOverride: form.impuestoOverride === '' ? null : Number(form.impuestoOverride),
      billingDueDay: Number(form.billingDueDay) || 5,
      atributosPersonalizados: attrs,
    }
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const payload = buildPayload()
      await api().put(`/services/${service.id}`, payload)
      if (payload.customPrice != null) {
        await api().put(`/clients/${clientId}`, { precioEfectivo: payload.customPrice }).catch(() => {})
      }
      await loadPreview()
      onSaved()
    } catch (e: any) {
      setError(e.response?.data?.error || e.message)
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-surface rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line bg-surface-card">
          <div>
            <h3 className="text-lg font-bold text-ink">Editar servicio</h3>
            <p className="text-sm text-ink-muted">{service.plan?.name || `Servicio #${service.id}`}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-surface-raised rounded-lg">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
          )}

          <Section title="Plan de servicio" open={open.plan} onToggle={() => toggle('plan')}>
            <div>
              <label className="block text-xs font-medium text-ink-soft mb-1">Precio efectivo (mensual)</label>
              <input type="number" min="0" step="1" className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.customPrice} onChange={(e) => setField('customPrice', e.target.value)}
                placeholder={`Lista: ${Number(service.plan?.price || 0).toLocaleString('es-CL')}`} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-soft mb-1">Etiqueta en factura</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.etiquetaFactura} onChange={(e) => setField('etiquetaFactura', e.target.value)}
                placeholder={service.plan?.name || 'Nombre del plan'} />
            </div>
          </Section>

          <Section title="Contrato" open={open.contrato} onToggle={() => toggle('contrato')}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">Tipo</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.contratoTipo} onChange={(e) => setField('contratoTipo', e.target.value)}>
                  <option value="abierto">Abierto</option>
                  <option value="cerrado">Cerrado</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">ID contrato</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.contratoId} onChange={(e) => setField('contratoId', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">{'Duraci\u00f3n m\u00ednima (meses)'}</label>
                <input type="number" min="0" className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.duracionMinimaMeses} onChange={(e) => setField('duracionMinimaMeses', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">{'Cargo cancelaci\u00f3n anticipada'}</label>
                <input type="number" min="0" className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.cargoCancelacionAnticipada}
                  onChange={(e) => setField('cargoCancelacionAnticipada', e.target.value)} />
              </div>
            </div>
          </Section>

          <Section title={'Recargos / instalaci\u00f3n'} open={open.facturas} onToggle={() => toggle('facturas')}>
            <div>
              <label className="block text-xs font-medium text-ink-soft mb-1">{'Costo de instalaci\u00f3n'}</label>
              <input type="number" min="0" className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.costoInstalacion} onChange={(e) => setField('costoInstalacion', e.target.value)} />
              <p className="text-xs text-ink-muted mt-1">{'Se suma a la primera factura si a\u00fan no hay facturas.'}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">{'Tipo de facturaci\u00f3n'}</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.tipoFacturacion} onChange={(e) => setField('tipoFacturacion', e.target.value)}>
                  <option value="retroactiva">Retroactiva</option>
                  <option value="anticipada">Anticipada</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">{'D\u00eda comienzo periodo'}</label>
                <input type="number" min="1" max="31" className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.diaComienzoPeriodo} onChange={(e) => setField('diaComienzoPeriodo', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">{'Crear factura (d\u00edas antes)'}</label>
                <input type="number" min="0" max="60" className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.crearFacturaDiasAntes} onChange={(e) => setField('crearFacturaDiasAntes', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">{'D\u00eda vencimiento pago'}</label>
                <input type="number" min="0" max="31" className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.billingDueDay} onChange={(e) => setField('billingDueDay', e.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.prorratearPrimeraFactura}
                onChange={(e) => setField('prorratearPrimeraFactura', e.target.checked)} />
              Prorratear primera factura
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.facturarPorSeparado}
                onChange={(e) => setField('facturarPorSeparado', e.target.checked)} />
              Facturar por separado
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.aprobarEnviarAutomaticamente}
                onChange={(e) => setField('aprobarEnviarAutomaticamente', e.target.checked)} />
              {'Aprobar y enviar autom\u00e1ticamente'}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.usarCreditoAutomaticamente}
                onChange={(e) => setField('usarCreditoAutomaticamente', e.target.checked)} />
              {'Usar cr\u00e9dito autom\u00e1ticamente'}
            </label>
          </Section>

          <Section title={'Configuraci\u00f3n de descuentos'} open={open.descuentos} onToggle={() => toggle('descuentos')}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">Tipo</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.tipoDescuento} onChange={(e) => setField('tipoDescuento', e.target.value)}>
                  <option value="sin_descuento">Sin descuento</option>
                  <option value="porcentaje">Porcentaje</option>
                  <option value="monto_fijo">Monto fijo</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">Valor</label>
                <input type="number" min="0" className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.valorDescuento} onChange={(e) => setField('valorDescuento', e.target.value)}
                  disabled={form.tipoDescuento === 'sin_descuento'} />
              </div>
            </div>
          </Section>

          <Section title="Impuestos" open={open.impuestos} onToggle={() => toggle('impuestos')}>
            <div>
              <label className="block text-xs font-medium text-ink-soft mb-1">IVA override (%)</label>
              <input type="number" min="0" max="100" step="0.01" className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.impuestoOverride} onChange={(e) => setField('impuestoOverride', e.target.value)}
                placeholder={'Vac\u00edo = 19% Chile'} />
            </div>
          </Section>

          <Section title="Atributos personalizados" open={open.atributos} onToggle={() => toggle('atributos')}>
            <div className="space-y-2">
              {form.atributos.map((row, idx) => (
                <div key={idx} className="flex gap-2">
                  <input className="flex-1 border rounded-lg px-2 py-1.5 text-sm" placeholder="Clave"
                    value={row.key}
                    onChange={(e) => {
                      const next = [...form.atributos]
                      next[idx] = { ...next[idx], key: e.target.value }
                      setField('atributos', next)
                    }} />
                  <input className="flex-1 border rounded-lg px-2 py-1.5 text-sm" placeholder="Valor"
                    value={row.value}
                    onChange={(e) => {
                      const next = [...form.atributos]
                      next[idx] = { ...next[idx], value: e.target.value }
                      setField('atributos', next)
                    }} />
                  <button type="button" className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                    onClick={() => setField('atributos', form.atributos.filter((_, i) => i !== idx))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button type="button"
                className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                onClick={() => setField('atributos', [...form.atributos, { key: '', value: '' }])}>
                <Plus className="h-3.5 w-3.5" /> Agregar atributo
              </button>
            </div>
          </Section>

          <Section title={'Vista previa de pr\u00f3ximas facturas'} open={open.preview} onToggle={() => toggle('preview')}>
            <p className="text-xs text-ink-muted mb-2">
              Basada en la config guardada. Guarda cambios y se actualiza.
            </p>
            {loadingPreview ? (
              <div className="text-sm text-ink-muted py-4">Calculando...</div>
            ) : !preview?.items?.length ? (
              <div className="text-sm text-ink-muted py-2">Sin preview</div>
            ) : (
              <div className="overflow-x-auto border border-line rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-surface-raised text-xs text-ink-muted uppercase">
                    <tr>
                      <th className="text-left p-2">Periodo</th>
                      <th className="text-left p-2">{'Creaci\u00f3n'}</th>
                      <th className="text-left p-2">Vencimiento</th>
                      <th className="text-right p-2">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.map((it: any) => (
                      <tr key={it.index} className="border-t border-line">
                        <td className="p-2 text-ink">{it.periodo}</td>
                        <td className="p-2">{formatDateCL(it.fechaCreacion)}</td>
                        <td className="p-2">{formatDateCL(it.fechaVencimiento)}</td>
                        <td className="p-2 text-right font-semibold">
                          ${Number(it.monto).toLocaleString('es-CL')}
                          {it.isProrated && <span className="block text-[10px] font-normal text-amber-700">prorrateo</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button type="button" onClick={() => loadPreview()}
              className="text-xs text-blue-600 hover:underline mt-2">Actualizar preview</button>
          </Section>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-line bg-surface-card">
          <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancelar</button>
          <button type="button" onClick={save} disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Guardando...' : 'Aplicar los cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}
