import { useEffect, useState } from 'react'
import axios from 'axios'
import { Plus, X, Loader2, CheckCircle2, Ban } from 'lucide-react'

type WorkOrder = {
  id: number
  clientId: number
  clientName?: string | null
  title: string
  type: string
  status: string
  scheduledAt?: string | null
  createdAt?: string
  checklist?: { id: string; label: string; done: boolean }[]
  notes?: string | null
}

type ClientOpt = { id: number; user?: { fullName: string } }

const TYPE_LABEL: Record<string, string> = {
  install: 'Instalación',
  visit: 'Visita',
  support: 'Soporte',
  disconnect: 'Retiro',
  other: 'Otro',
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Abierta',
  in_progress: 'En curso',
  done: 'Completada',
  cancelled: 'Anulada',
}

const STATUS_COLOR: Record<string, string> = {
  open: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  done: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-600',
}

export default function WorkOrdersManager({ API }: { API: string }) {
  const [rows, setRows] = useState<WorkOrder[]>([])
  const [clients, setClients] = useState<ClientOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [detail, setDetail] = useState<WorkOrder | null>(null)
  const [form, setForm] = useState({
    clientId: '',
    title: '',
    type: 'visit',
    notes: '',
    scheduledAt: '',
  })

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    })
  }

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [wo, cl] = await Promise.all([
        api().get('/work-orders'),
        api().get('/clients'),
      ])
      setRows(Array.isArray(wo.data) ? wo.data : [])
      setClients(Array.isArray(cl.data) ? cl.data : [])
    } catch (err: any) {
      setError(err.response?.data?.error || err.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function createOrder(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api().post('/work-orders', {
        clientId: Number(form.clientId),
        title: form.title,
        type: form.type,
        notes: form.notes || null,
        scheduledAt: form.scheduledAt || null,
      })
      setShowForm(false)
      setForm({ clientId: '', title: '', type: 'visit', notes: '', scheduledAt: '' })
      load()
    } catch (err: any) {
      alert(err.response?.data?.error || err.message)
    }
  }

  async function openDetail(id: number) {
    try {
      const res = await api().get(`/work-orders/${id}`)
      setDetail(res.data)
    } catch (err: any) {
      alert(err.response?.data?.error || err.message)
    }
  }

  async function toggleCheck(itemId: string) {
    if (!detail?.checklist) return
    const checklist = detail.checklist.map((c) =>
      c.id === itemId ? { ...c, done: !c.done } : c
    )
    try {
      const res = await api().patch(`/work-orders/${detail.id}`, { checklist })
      setDetail(res.data)
      load()
    } catch (err: any) {
      alert(err.response?.data?.error || err.message)
    }
  }

  async function complete(force = false) {
    if (!detail) return
    try {
      const res = await api().post(`/work-orders/${detail.id}/complete`, { force })
      setDetail(res.data)
      load()
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message
      if (String(msg).includes('checklist') && confirm(`${msg}\n\n¿Cerrar de todas formas?`)) {
        complete(true)
      } else {
        alert(msg)
      }
    }
  }

  async function cancel() {
    if (!detail) return
    const reason = prompt('Motivo de anulación (opcional):') ?? undefined
    if (reason === undefined && !confirm('¿Anular esta orden?')) return
    try {
      await api().post(`/work-orders/${detail.id}/cancel`, { reason: reason || null })
      setDetail(null)
      load()
    } catch (err: any) {
      alert(err.response?.data?.error || err.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">{rows.length} orden{rows.length !== 1 ? 'es' : ''}</p>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2"
        >
          <Plus className="h-4 w-4" /> Nueva OT
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                {['OT', 'Abonado', 'Tipo', 'Estado', 'Programada', ''].map((h) => (
                  <th key={h || 'a'} className="text-left p-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((wo) => (
                <tr key={wo.id} className="hover:bg-gray-50">
                  <td className="p-4">
                    <p className="font-medium">#{wo.id} · {wo.title}</p>
                  </td>
                  <td className="p-4 text-sm">{wo.clientName || `Cliente #${wo.clientId}`}</td>
                  <td className="p-4 text-sm">{TYPE_LABEL[wo.type] || wo.type}</td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[wo.status] || 'bg-gray-100'}`}>
                      {STATUS_LABEL[wo.status] || wo.status}
                    </span>
                  </td>
                  <td className="p-4 text-sm text-gray-500">
                    {wo.scheduledAt ? new Date(wo.scheduledAt).toLocaleString('es-CL') : '—'}
                  </td>
                  <td className="p-4">
                    <button onClick={() => openDetail(wo.id)} className="text-sm text-blue-600 hover:underline">
                      Abrir
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Sin órdenes de trabajo</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <form onSubmit={createOrder} className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-lg">Nueva orden de trabajo</h3>
              <button type="button" onClick={() => setShowForm(false)}><X className="h-5 w-5 text-gray-400" /></button>
            </div>
            <label className="block text-sm">
              <span className="text-gray-600">Abonado</span>
              <select
                required
                className="mt-1 w-full border rounded-lg px-3 py-2"
                value={form.clientId}
                onChange={(e) => setForm({ ...form, clientId: e.target.value })}
              >
                <option value="">Seleccionar…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.user?.fullName || `Cliente #${c.id}`}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-gray-600">Título</span>
              <input
                required
                className="mt-1 w-full border rounded-lg px-3 py-2"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600">Tipo</span>
              <select
                className="mt-1 w-full border rounded-lg px-3 py-2"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-gray-600">Programada (opcional)</span>
              <input
                type="datetime-local"
                className="mt-1 w-full border rounded-lg px-3 py-2"
                value={form.scheduledAt}
                onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600">Notas</span>
              <textarea
                className="mt-1 w-full border rounded-lg px-3 py-2"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
            <button type="submit" className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
              Crear OT
            </button>
          </form>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-lg">#{detail.id} · {detail.title}</h3>
                <p className="text-sm text-gray-500">
                  {TYPE_LABEL[detail.type] || detail.type} · {STATUS_LABEL[detail.status] || detail.status}
                </p>
              </div>
              <button type="button" onClick={() => setDetail(null)}><X className="h-5 w-5 text-gray-400" /></button>
            </div>

            {detail.notes && (
              <p className="text-sm bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{detail.notes}</p>
            )}

            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Checklist</h4>
              <ul className="space-y-2">
                {(detail.checklist || []).map((c) => (
                  <li key={c.id}>
                    <label className={`flex items-center gap-2 text-sm ${detail.status === 'done' || detail.status === 'cancelled' ? 'opacity-60' : ''}`}>
                      <input
                        type="checkbox"
                        checked={!!c.done}
                        disabled={detail.status === 'done' || detail.status === 'cancelled'}
                        onChange={() => toggleCheck(c.id)}
                      />
                      <span className={c.done ? 'line-through text-gray-400' : ''}>{c.label}</span>
                    </label>
                  </li>
                ))}
                {!detail.checklist?.length && <li className="text-sm text-gray-400">Sin ítems</li>}
              </ul>
            </div>

            {detail.status !== 'done' && detail.status !== 'cancelled' && (
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => complete(false)}
                  className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:bg-green-700"
                >
                  <CheckCircle2 className="h-4 w-4" /> Completar
                </button>
                <button
                  onClick={cancel}
                  className="px-4 py-2 border border-red-200 text-red-700 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-red-50"
                >
                  <Ban className="h-4 w-4" /> Anular
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
