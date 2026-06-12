import { useState, useEffect } from 'react'
import { Wifi, DollarSign, Ticket, LogOut, AlertTriangle, Plus, X, Clock, Send, MessageSquare, ChevronLeft } from 'lucide-react'
import axios from 'axios'

const statusColor: Record<string, string> = {
  active: 'bg-green-100 text-green-700', suspended: 'bg-yellow-100 text-yellow-700',
  pending: 'bg-blue-100 text-blue-700', paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700', open: 'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700', resolved: 'bg-green-100 text-green-700',
  waiting_client: 'bg-amber-100 text-amber-800', closed: 'bg-gray-100 text-gray-500',
}

const statusLabel: Record<string, string> = {
  active: 'Activo', suspended: 'Suspendido', pending: 'Pendiente', paid: 'Pagada',
  overdue: 'Vencida', open: 'Abierto', in_progress: 'En proceso', resolved: 'Resuelto',
  waiting_client: 'Esperando tu respuesta', closed: 'Cerrado',
}

export default function ClientPortal({ user, API }: { user: any; API: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('resumen')
  const [showTicket, setShowTicket] = useState(false)
  const [ticketForm, setTicketForm] = useState({ subject: '', description: '', priority: 'medium' })
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null)
  const [ticketDetail, setTicketDetail] = useState<any>(null)
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    })
  }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const res = await api().get('/portal/dashboard')
      setData(res.data)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  async function loadTicketDetail(ticketId: number) {
    setSelectedTicketId(ticketId)
    setReplyText('')
    try {
      const res = await api().get(`/portal/tickets/${ticketId}`)
      setTicketDetail(res.data)
    } catch {
      setTicketDetail(null)
    }
  }

  async function submitTicket(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api().post('/portal/tickets', ticketForm)
      setShowTicket(false)
      setTicketForm({ subject: '', description: '', priority: 'medium' })
      await load()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Error al crear ticket')
    }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedTicketId || !replyText.trim()) return
    setSendingReply(true)
    try {
      const res = await api().post(`/portal/tickets/${selectedTicketId}/messages`, { message: replyText.trim() })
      setTicketDetail(res.data)
      setReplyText('')
      await load()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Error al enviar mensaje')
    }
    setSendingReply(false)
  }

  const logout = () => { localStorage.removeItem('token'); window.location.href = '/login' }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    )
  }

  const orgName = user?.organization?.name || 'Mi ISP'

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex justify-between items-center sticky top-0 z-10">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Portal Cliente</h1>
          <p className="text-sm text-gray-500">{orgName} · {user?.fullName}</p>
        </div>
        <button onClick={logout} className="flex items-center gap-2 text-gray-500 hover:text-red-600 text-sm">
          <LogOut className="h-4 w-4" /> Salir
        </button>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Días como cliente', value: data?.daysAsClient ?? 0, icon: Clock },
            { label: 'Deuda pendiente', value: '$' + (data?.pendingAmount || 0).toLocaleString('es-CL'), icon: DollarSign },
            { label: 'Tickets abiertos', value: data?.openTickets ?? 0, icon: Ticket },
            { label: 'Servicios', value: data?.services?.length ?? 0, icon: Wifi },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-4 border shadow-sm">
              <s.icon className="h-5 w-5 text-blue-600 mb-2" />
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className="text-lg font-bold">{s.value}</p>
            </div>
          ))}
        </div>

        {data?.pendingAmount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <p className="text-sm text-amber-900">Tienes facturas pendientes por <strong>${data.pendingAmount.toLocaleString('es-CL')}</strong>. Contacta a {orgName} para regularizar.</p>
          </div>
        )}

        <div className="flex gap-2 bg-gray-100 rounded-xl p-1 w-fit">
          {['resumen', 'facturas', 'tickets'].map(t => (
            <button key={t} onClick={() => { setTab(t); setSelectedTicketId(null); setTicketDetail(null) }}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${tab === t ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}>
              {t}
            </button>
          ))}
        </div>

        {tab === 'resumen' && (
          <div className="bg-white rounded-xl border p-6">
            <h2 className="font-semibold mb-4">Mi servicio de internet</h2>
            {!data?.services?.length ? (
              <p className="text-gray-400 text-sm">Sin servicio activo asignado.</p>
            ) : data.services.map((s: any) => (
              <div key={s.id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold">{s.plan?.name}</p>
                    <p className="text-sm text-gray-500">{s.plan?.downloadSpeed}/{s.plan?.uploadSpeed} Mbps · ${Number(s.plan?.price || 0).toLocaleString('es-CL')}/mes</p>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[s.status] || 'bg-gray-100'}`}>
                    {statusLabel[s.status] || s.status}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-2 font-mono">IP: {s.ipAddress || '—'}</p>
              </div>
            ))}
          </div>
        )}

        {tab === 'facturas' && (
          <div className="bg-white rounded-xl border divide-y">
            {!data?.invoices?.length ? (
              <p className="p-6 text-gray-400 text-sm">Sin facturas.</p>
            ) : data.invoices.map((inv: any) => (
              <div key={inv.id} className="p-4 flex justify-between items-center">
                <div>
                  <p className="font-medium">{inv.invoiceNumber}</p>
                  <p className="text-xs text-gray-400">Vence: {inv.dueDate}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">${Number(inv.total).toLocaleString('es-CL')}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor[inv.status]}`}>{statusLabel[inv.status] || inv.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'tickets' && (
          <div className="space-y-4">
            {!selectedTicketId ? (
              <>
                <button onClick={() => setShowTicket(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-2">
                  <Plus className="h-4 w-4" /> Reportar problema
                </button>
                <div className="bg-white rounded-xl border divide-y">
                  {!data?.tickets?.length ? (
                    <p className="p-6 text-gray-400 text-sm">Sin tickets.</p>
                  ) : data.tickets.map((t: any) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => loadTicketDetail(t.id)}
                      className="w-full text-left p-4 hover:bg-blue-50/50 transition"
                    >
                      <div className="flex justify-between items-start gap-3">
                        <div>
                          <p className="font-medium">{t.subject}</p>
                          <p className="text-xs text-gray-400 font-mono mt-1">{t.ticketNumber}</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${statusColor[t.status]}`}>
                          {statusLabel[t.status] || t.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mt-2 line-clamp-2">{t.description}</p>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="bg-white rounded-xl border overflow-hidden">
                <div className="p-4 border-b flex items-center gap-3">
                  <button type="button" onClick={() => { setSelectedTicketId(null); setTicketDetail(null) }}
                    className="p-2 hover:bg-gray-100 rounded-lg">
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold truncate">{ticketDetail?.subject}</h3>
                    <p className="text-xs text-gray-400 font-mono">{ticketDetail?.ticketNumber}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${statusColor[ticketDetail?.status] || 'bg-gray-100'}`}>
                    {statusLabel[ticketDetail?.status] || ticketDetail?.status}
                  </span>
                </div>

                <div className="p-4 space-y-3 max-h-[360px] overflow-y-auto bg-slate-50">
                  {(ticketDetail?.messages?.length ? ticketDetail.messages : [{
                    id: 0,
                    message: ticketDetail?.description,
                    authorName: user?.fullName,
                    authorRole: 'client',
                    createdAt: ticketDetail?.createdAt,
                  }]).map((msg: any) => (
                    <div key={msg.id} className={`flex ${msg.authorRole === 'client' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-xl px-4 py-3 ${
                        msg.authorRole === 'client' ? 'bg-blue-600 text-white' : 'bg-white border text-gray-800 shadow-sm'
                      }`}>
                        <p className="text-xs font-semibold mb-1 opacity-80">
                          {msg.authorRole === 'client' ? 'Tú' : (msg.authorName || orgName)}
                        </p>
                        <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                        <p className="text-[10px] opacity-60 mt-2">{new Date(msg.createdAt).toLocaleString('es-CL')}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {!['closed', 'resolved'].includes(ticketDetail?.status || '') ? (
                  <form onSubmit={sendReply} className="p-4 border-t flex gap-2">
                    <textarea
                      className="flex-1 border rounded-lg px-3 py-2 text-sm min-h-[64px] resize-none"
                      placeholder="Escribe un mensaje de seguimiento..."
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      required
                    />
                    <button type="submit" disabled={sendingReply || !replyText.trim()}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg self-end disabled:opacity-50 flex items-center gap-2 text-sm">
                      <Send className="h-4 w-4" />
                    </button>
                  </form>
                ) : (
                  <p className="p-4 text-sm text-gray-500 border-t flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" /> Este ticket fue cerrado por soporte.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {showTicket && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={submitTicket} className="bg-white rounded-xl p-6 w-full max-w-md">
            <div className="flex justify-between mb-4">
              <h3 className="font-bold">Reportar problema</h3>
              <button type="button" onClick={() => setShowTicket(false)}><X className="h-5 w-5" /></button>
            </div>
            <input className="w-full border rounded-lg px-3 py-2 mb-3" placeholder="Asunto" required value={ticketForm.subject}
              onChange={e => setTicketForm({ ...ticketForm, subject: e.target.value })} />
            <textarea className="w-full border rounded-lg px-3 py-2 mb-3" rows={4} placeholder="Describe el problema" required
              value={ticketForm.description} onChange={e => setTicketForm({ ...ticketForm, description: e.target.value })} />
            <select className="w-full border rounded-lg px-3 py-2 mb-4" value={ticketForm.priority}
              onChange={e => setTicketForm({ ...ticketForm, priority: e.target.value })}>
              <option value="low">Baja</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
              <option value="critical">Crítica</option>
            </select>
            <button type="submit" className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium">Enviar ticket</button>
          </form>
        </div>
      )}
    </div>
  )
}
