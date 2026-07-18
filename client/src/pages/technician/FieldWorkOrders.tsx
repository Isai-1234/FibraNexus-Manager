import { useEffect, useState } from 'react'
import axios from 'axios'
import { Loader2, CheckCircle2, Camera, ChevronLeft, MapPin, Wrench } from 'lucide-react'

type ChecklistItem = { id: string; label: string; done: boolean }
type Attachment = { name: string; url: string; note?: string }
type WorkOrder = {
  id: number
  clientId: number
  clientName?: string | null
  title: string
  type: string
  status: string
  assignedTo?: number | null
  scheduledAt?: string | null
  notes?: string | null
  checklist?: ChecklistItem[]
  attachments?: Attachment[]
  address?: string | null
}

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

export default function FieldWorkOrders({ API, user }: { API: string; user: any }) {
  const [rows, setRows] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mineOnly, setMineOnly] = useState(true)
  const [detail, setDetail] = useState<WorkOrder | null>(null)
  const [photoUrl, setPhotoUrl] = useState('')
  const [photoNote, setPhotoNote] = useState('')
  const [saving, setSaving] = useState(false)

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
      const q = mineOnly ? '?mine=1' : ''
      const res = await api().get(`/work-orders${q}`)
      const list = Array.isArray(res.data) ? res.data : []
      setRows(list.filter((w: WorkOrder) => w.status === 'open' || w.status === 'in_progress'))
    } catch (err: any) {
      setError(err.response?.data?.error || err.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [mineOnly])

  async function openDetail(id: number) {
    try {
      const res = await api().get(`/work-orders/${id}`)
      setDetail(res.data)
      if (res.data.status === 'open') {
        await api().patch(`/work-orders/${id}`, { status: 'in_progress' })
        const again = await api().get(`/work-orders/${id}`)
        setDetail(again.data)
      }
    } catch (err: any) {
      alert(err.response?.data?.error || err.message)
    }
  }

  async function toggleCheck(itemId: string) {
    if (!detail?.checklist) return
    const checklist = detail.checklist.map((c) =>
      c.id === itemId ? { ...c, done: !c.done } : c
    )
    setSaving(true)
    try {
      const res = await api().patch(`/work-orders/${detail.id}`, { checklist })
      setDetail(res.data)
    } catch (err: any) {
      alert(err.response?.data?.error || err.message)
    }
    setSaving(false)
  }

  async function addPhoto(e: React.FormEvent) {
    e.preventDefault()
    if (!detail || !photoUrl.trim()) return
    const attachments = [
      ...(Array.isArray(detail.attachments) ? detail.attachments : []),
      { name: photoNote.trim() || `Foto ${new Date().toLocaleString('es-CL')}`, url: photoUrl.trim(), note: photoNote.trim() || undefined },
    ]
    setSaving(true)
    try {
      const res = await api().patch(`/work-orders/${detail.id}`, { attachments })
      setDetail(res.data)
      setPhotoUrl('')
      setPhotoNote('')
    } catch (err: any) {
      alert(err.response?.data?.error || err.message)
    }
    setSaving(false)
  }

  async function claim() {
    if (!detail) return
    setSaving(true)
    try {
      const res = await api().patch(`/work-orders/${detail.id}`, { assignedTo: user.id, status: 'in_progress' })
      setDetail(res.data)
      load()
    } catch (err: any) {
      alert(err.response?.data?.error || err.message)
    }
    setSaving(false)
  }

  async function complete(force = false) {
    if (!detail) return
    setSaving(true)
    try {
      await api().post(`/work-orders/${detail.id}/complete`, { force })
      setDetail(null)
      load()
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message
      if (String(msg).includes('checklist') && confirm(`${msg}\n\n¿Cerrar de todas formas?`)) {
        await complete(true)
      } else {
        alert(msg)
      }
    }
    setSaving(false)
  }

  if (detail) {
    const pending = (detail.checklist || []).filter((c) => !c.done).length
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <button type="button" onClick={() => { setDetail(null); load() }}
          className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
          <ChevronLeft className="h-4 w-4" /> Volver a mis OT
        </button>

        <div className="bg-white rounded-2xl border shadow-sm p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400">{TYPE_LABEL[detail.type] || detail.type}</p>
              <h2 className="text-lg font-bold text-gray-900">{detail.title}</h2>
              <p className="text-sm text-gray-600 mt-1 flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {detail.clientName || `Cliente #${detail.clientId}`}
              </p>
            </div>
            <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800 font-medium">
              {STATUS_LABEL[detail.status] || detail.status}
            </span>
          </div>
          {detail.notes && <p className="text-sm text-gray-600 bg-slate-50 rounded-lg p-3">{detail.notes}</p>}
          {!detail.assignedTo && (
            <button type="button" onClick={claim} disabled={saving}
              className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium disabled:opacity-50">
              Tomar esta orden
            </button>
          )}
        </div>

        <div className="bg-white rounded-2xl border shadow-sm p-5">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Wrench className="h-4 w-4 text-blue-600" /> Checklist ({(detail.checklist || []).length - pending}/{detail.checklist?.length || 0})
          </h3>
          <ul className="space-y-2">
            {(detail.checklist || []).map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => toggleCheck(c.id)} disabled={saving}
                  className={`w-full text-left flex items-center gap-3 px-3 py-3 rounded-xl border text-sm ${
                    c.done ? 'bg-green-50 border-green-200 text-green-900' : 'bg-white border-gray-200'
                  }`}>
                  <CheckCircle2 className={`h-5 w-5 shrink-0 ${c.done ? 'text-green-600' : 'text-gray-300'}`} />
                  <span className={c.done ? 'line-through opacity-70' : ''}>{c.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-white rounded-2xl border shadow-sm p-5 space-y-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Camera className="h-4 w-4 text-blue-600" /> Fotos / evidencias
          </h3>
          <p className="text-xs text-gray-500">Pega la URL de una foto (Drive, Imgur, etc.). Upload directo post-MVP.</p>
          {(detail.attachments || []).length > 0 && (
            <ul className="space-y-2">
              {(detail.attachments || []).map((a, i) => (
                <li key={i} className="text-sm">
                  <a href={a.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-medium">{a.name}</a>
                  {a.note && <span className="text-gray-500"> — {a.note}</span>}
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addPhoto} className="space-y-2">
            <input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} required
              placeholder="https://… URL de la foto"
              className="w-full border rounded-xl px-3 py-2.5 text-sm" />
            <input value={photoNote} onChange={(e) => setPhotoNote(e.target.value)}
              placeholder="Nota (opcional)"
              className="w-full border rounded-xl px-3 py-2.5 text-sm" />
            <button type="submit" disabled={saving}
              className="w-full py-2.5 rounded-xl border border-blue-200 bg-blue-50 text-blue-800 text-sm font-medium disabled:opacity-50">
              Agregar evidencia
            </button>
          </form>
        </div>

        <button type="button" onClick={() => complete(false)} disabled={saving}
          className="w-full py-3.5 rounded-2xl bg-green-600 hover:bg-green-700 text-white font-semibold text-sm disabled:opacity-50">
          Cerrar orden de trabajo
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900">Vista de campo</h2>
          <p className="text-xs text-gray-500">Órdenes abiertas para instalar o visitar</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-600 bg-white border rounded-lg px-3 py-2">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          Solo mías
        </label>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="bg-white border rounded-2xl p-8 text-center text-sm text-gray-500">
          No hay órdenes abiertas{mineOnly ? ' asignadas a ti' : ''}.
          {mineOnly && (
            <button type="button" onClick={() => setMineOnly(false)} className="block mx-auto mt-3 text-blue-600 hover:underline">
              Ver todas las abiertas
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((wo) => (
            <li key={wo.id}>
              <button type="button" onClick={() => openDetail(wo.id)}
                className="w-full text-left bg-white border rounded-2xl p-4 shadow-sm hover:border-blue-300 transition">
                <div className="flex justify-between gap-2">
                  <span className="text-[10px] uppercase font-semibold text-gray-400">{TYPE_LABEL[wo.type] || wo.type}</span>
                  <span className="text-[10px] font-medium text-blue-700">{STATUS_LABEL[wo.status]}</span>
                </div>
                <p className="font-semibold text-gray-900 mt-1">{wo.title}</p>
                <p className="text-sm text-gray-500 mt-0.5">{wo.clientName || `Cliente #${wo.clientId}`}</p>
                {wo.scheduledAt && (
                  <p className="text-xs text-gray-400 mt-2">Programada: {new Date(wo.scheduledAt).toLocaleString('es-CL')}</p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
