import { useState, useEffect } from 'react'
import { Wifi, DollarSign, Ticket, LogOut, AlertTriangle, Plus, X, Clock, Send, MessageSquare, ChevronLeft, FileText, CreditCard, Download } from 'lucide-react'
import axios from 'axios'

const statusColor: Record<string, string> = {
  active: 'bg-green-100 text-green-700', suspended: 'bg-yellow-100 text-yellow-700',
  pending: 'bg-blue-100 text-blue-700', paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700', partial: 'bg-amber-100 text-amber-800',
  open: 'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700', resolved: 'bg-green-100 text-green-700',
  waiting_client: 'bg-amber-100 text-amber-800', closed: 'bg-gray-100 text-gray-500',
}

const statusLabel: Record<string, string> = {
  active: 'Activo', suspended: 'Suspendido', pending: 'Pendiente', paid: 'Pagada',
  overdue: 'Vencida', partial: 'Parcial', open: 'Abierto', in_progress: 'En proceso', resolved: 'Resuelto',
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
  const [payingId, setPayingId] = useState<number | null>(null)

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

  async function payInvoice(invoiceId: number) {
    setPayingId(invoiceId)
    try {
      const res = await api().post('/portal/checkout', {
        invoiceId,
        returnUrl: window.location.origin + '/',
      })
      const url = res.data?.checkoutUrl
      if (url) {
        window.location.href = url
        return
      }
      alert('No se obtuvo URL de pago')
    } catch (err: any) {
      alert(err.response?.data?.error || 'Error al iniciar pago')
    }
    setPayingId(null)
  }

  async function downloadPdf(invoiceId: number, invoiceNumber?: string) {
    try {
      const res = await api().get(`/portal/invoices/${invoiceId}/pdf`, { responseType: 'blob' })
      const blob = new Blob([res.data], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${invoiceNumber || `factura-${invoiceId}`}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      alert(err.response?.data?.error || 'Error al descargar PDF')
    }
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

  const brand = data?.branding || {}
  const primary = brand.primaryColor || '#2563eb'
  const accent = brand.accentColor || '#0ea5e9'
  const orgName = brand.orgName || user?.organization?.name || 'Mi ISP'
  const portalTitle = brand.portalTitle || 'Portal Cliente'

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderBottomColor: primary }} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50" style={{ ['--brand' as any]: primary, ['--brand-accent' as any]: accent }}>
      <header className="bg-white border-b px-4 sm:px-6 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-3 min-w-0">
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt={orgName} className="h-9 w-9 object-contain rounded-lg" />
          ) : (
            <div className="h-9 w-9 rounded-lg flex items-center justify-center text-white text-sm font-bold"
              style={{ background: primary }}>{(orgName || 'I').slice(0, 1)}</div>
          )}
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{portalTitle}</h1>
            <p className="text-xs sm:text-sm text-gray-500 truncate">{orgName} · {user?.fullName}</p>
          </div>
        </div>
        <button onClick={logout} className="flex items-center gap-2 text-gray-500 hover:text-red-600 text-sm shrink-0">
          <LogOut className="h-4 w-4" /> Salir
        </button>
      </header>

      <main className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Días como cliente', value: data?.daysAsClient ?? 0, icon: Clock },
            { label: 'Deuda pendiente', value: '$' + (data?.pendingAmount || 0).toLocaleString('es-CL'), icon: DollarSign },
            { label: 'Tickets abiertos', value: data?.openTickets ?? 0, icon: Ticket },
            { label: 'Servicios', value: data?.services?.length ?? 0, icon: Wifi },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-4 border shadow-sm">
              <s.icon className="h-5 w-5 mb-2" style={{ color: primary }} />
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className="text-lg font-bold">{s.value}</p>
            </div>
          ))}
        </div>

        {data?.pendingAmount > 0 && (
          <div className="rounded-xl p-4 flex flex-wrap items-center gap-3 border"
            style={{ background: `${accent}18`, borderColor: `${accent}55` }}>
            <AlertTriangle className="h-5 w-5" style={{ color: accent }} />
            <p className="text-sm text-gray-900 flex-1 min-w-[200px]">
              Tienes facturas pendientes por <strong>${data.pendingAmount.toLocaleString('es-CL')}</strong>.
            </p>
            <button type="button" onClick={() => setTab('facturas')}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: primary }}>
              Ir a pagar
            </button>
          </div>
        )}

        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
          {['resumen', 'facturas', 'documentos', 'tickets'].map(t => (
            <button key={t} onClick={() => { setTab(t); setSelectedTicketId(null); setTicketDetail(null) }}
              className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium capitalize whitespace-nowrap ${
                tab === t ? 'bg-white shadow' : 'text-gray-500'
              }`}
              style={tab === t ? { color: primary } : undefined}>
              {t}
            </button>
          ))}
        </div>

        {tab === 'resumen' && (
          <div className="bg-white rounded-xl border p-5 sm:p-6">
            <h2 className="font-semibold mb-4">Mi servicio de internet</h2>
            {!data?.services?.length ? (
              <p className="text-gray-400 text-sm">Sin servicio activo asignado.</p>
            ) : data.services.map((s: any) => (
              <div key={s.id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start gap-3">
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
            ) : data.invoices.map((inv: any) => {
              const payable = ['pending', 'overdue', 'partial'].includes(inv.status)
              return (
                <div key={inv.id} className="p-4 flex flex-wrap justify-between items-center gap-3">
                  <div>
                    <p className="font-medium">{inv.invoiceNumber}</p>
                    <p className="text-xs text-gray-400">Vence: {inv.dueDate}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="font-bold">${Number(inv.total).toLocaleString('es-CL')}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor[inv.status]}`}>{statusLabel[inv.status] || inv.status}</span>
                    </div>
                    <button type="button" onClick={() => downloadPdf(inv.id, inv.invoiceNumber)}
                      className="px-2.5 py-2 rounded-lg text-xs font-medium border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 flex items-center gap-1"
                      title="Descargar PDF">
                      <Download className="h-3.5 w-3.5" /> PDF
                    </button>
                    {payable && (
                      <button type="button" disabled={payingId === inv.id} onClick={() => payInvoice(inv.id)}
                        className="px-3 py-2 rounded-lg text-xs font-medium text-white flex items-center gap-1 disabled:opacity-60"
                        style={{ background: primary }}>
                        <CreditCard className="h-3.5 w-3.5" />
                        {payingId === inv.id ? '…' : 'Pagar'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'documentos' && (
          <div className="bg-white rounded-xl border divide-y">
            <div className="px-4 py-3 bg-slate-50 border-b">
              <p className="text-sm font-medium text-gray-800 flex items-center gap-2">
                <FileText className="h-4 w-4" style={{ color: primary }} /> Documentos de facturación
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Comprobantes internos emitidos por {orgName} (PDF electrónico post-MVP).</p>
            </div>
            {!data?.documents?.length ? (
              <p className="p-6 text-gray-400 text-sm">Sin documentos aún.</p>
            ) : data.documents.map((doc: any) => (
              <div key={doc.id} className="p-4 flex flex-wrap justify-between items-center gap-3">
                <div>
                  <p className="font-medium text-sm">{doc.title}</p>
                  <p className="text-xs text-gray-400">
                    {doc.type === 'invoice' ? 'Factura interna' : doc.type}
                    {doc.dueDate ? ` · vence ${doc.dueDate}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor[doc.status] || 'bg-gray-100'}`}>
                    {statusLabel[doc.status] || doc.status}
                  </span>
                  <span className="text-sm font-semibold">${Number(doc.balance ?? doc.amount ?? 0).toLocaleString('es-CL')}</span>
                  <button type="button" onClick={() => downloadPdf(doc.id, doc.title)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 flex items-center gap-1">
                    <Download className="h-3 w-3" /> PDF
                  </button>
                  {doc.payable && (
                    <button type="button" onClick={() => payInvoice(doc.id)}
                      className="text-xs px-2.5 py-1 rounded-lg text-white" style={{ background: primary }}>
                      Pagar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'tickets' && (
          <div className="space-y-4">
            {!selectedTicketId ? (
              <>
                <button onClick={() => setShowTicket(true)} className="px-4 py-2 text-white rounded-lg text-sm flex items-center gap-2"
                  style={{ background: primary }}>
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
                    <div key={msg.id} className={`rounded-lg p-3 ${msg.authorRole === 'client' ? 'bg-white border ml-4' : 'bg-blue-50 border border-blue-100 mr-4'}`}>
                      <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                        <MessageSquare className="h-3 w-3" />
                        <span className="font-medium">{msg.authorName || 'Sistema'}</span>
                        {msg.createdAt && <span>· {new Date(msg.createdAt).toLocaleString('es-CL')}</span>}
                      </div>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">{msg.message}</p>
                    </div>
                  ))}
                </div>

                {!['closed', 'resolved'].includes(ticketDetail?.status) && (
                  <form onSubmit={sendReply} className="p-4 border-t flex gap-2">
                    <input value={replyText} onChange={e => setReplyText(e.target.value)}
                      placeholder="Escribe tu respuesta…"
                      className="flex-1 border rounded-lg px-3 py-2 text-sm" />
                    <button type="submit" disabled={sendingReply || !replyText.trim()}
                      className="px-3 py-2 text-white rounded-lg disabled:opacity-50" style={{ background: primary }}>
                      <Send className="h-4 w-4" />
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {showTicket && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <form onSubmit={submitTicket} className="bg-white rounded-t-2xl sm:rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <div className="flex justify-between items-center">
              <h3 className="font-bold">Reportar problema</h3>
              <button type="button" onClick={() => setShowTicket(false)}><X className="h-5 w-5" /></button>
            </div>
            <input required placeholder="Asunto" value={ticketForm.subject}
              onChange={e => setTicketForm({ ...ticketForm, subject: e.target.value })}
              className="w-full border rounded-lg px-3 py-2" />
            <textarea required rows={4} placeholder="Describe el problema…" value={ticketForm.description}
              onChange={e => setTicketForm({ ...ticketForm, description: e.target.value })}
              className="w-full border rounded-lg px-3 py-2" />
            <select value={ticketForm.priority} onChange={e => setTicketForm({ ...ticketForm, priority: e.target.value })}
              className="w-full border rounded-lg px-3 py-2">
              <option value="low">Baja</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
            </select>
            <button type="submit" className="w-full py-2.5 text-white rounded-lg font-medium" style={{ background: primary }}>
              Enviar
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
