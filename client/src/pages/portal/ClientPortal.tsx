import { useState, useEffect } from 'react'
import {
  Wifi, DollarSign, Ticket, LogOut, AlertTriangle, Plus, X, Clock, Send,
  MessageSquare, ChevronLeft, CreditCard, Download, Signal, Calendar,
} from 'lucide-react'
import axios from 'axios'
import { getStoredTheme, applyTheme } from '../../lib/theme'

const statusColor: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-800',
  suspended: 'bg-amber-50 text-amber-800',
  pending: 'bg-sky-50 text-sky-800',
  paid: 'bg-emerald-50 text-emerald-800',
  overdue: 'bg-red-50 text-red-800',
  partial: 'bg-amber-50 text-amber-800',
  open: 'bg-amber-50 text-amber-800',
  in_progress: 'bg-sky-50 text-sky-800',
  resolved: 'bg-emerald-50 text-emerald-800',
  waiting_client: 'bg-amber-50 text-amber-800',
  closed: 'bg-slate-100 text-slate-600',
}

const statusLabel: Record<string, string> = {
  active: 'Activo', suspended: 'Suspendido', pending: 'Pendiente', paid: 'Pagada',
  overdue: 'Vencida', partial: 'Parcial', open: 'Abierto', in_progress: 'En proceso', resolved: 'Resuelto',
  waiting_client: 'Esperando tu respuesta', closed: 'Cerrado',
}

const TABS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'facturas', label: 'Facturas' },
  { id: 'tickets', label: 'Soporte' },
] as const

function formatDate(v?: string | null) {
  if (!v) return '—'
  const raw = String(v)
  // Fechas date-only (vencimiento/cobro): no usar UTC midnight o Chile ve un día menos.
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10)
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatMoney(n: number) {
  return '$' + Number(n || 0).toLocaleString('es-CL')
}

function signalTone(dbm: number | null | undefined) {
  if (dbm == null) return 'text-slate-500'
  if (dbm >= -55) return 'text-emerald-700'
  if (dbm >= -70) return 'text-amber-700'
  return 'text-red-700'
}

/** Fuerza tema claro en el portal del abonado sin pisar la preferencia del ISP en localStorage. */
function usePortalLightTheme() {
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('dark')
    root.classList.add('light')
    return () => {
      applyTheme(getStoredTheme())
    }
  }, [])
}

export default function ClientPortal({ user, API }: { user: any; API: string }) {
  usePortalLightTheme()

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('resumen')
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

  const brand = data?.branding || {}
  const primary = brand.primaryColor || '#2563eb'
  const accent = brand.accentColor || '#0ea5e9'
  const orgName = brand.orgName || user?.organization?.name || 'Mi ISP'
  const portalTitle = brand.portalTitle || 'Mi cuenta'
  const portalSlug = brand.slug || user?.organization?.slug || null

  useEffect(() => {
    document.title = `${portalTitle} · ${orgName}`
    return () => { document.title = 'FibraNexus Manager' }
  }, [portalTitle, orgName])

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

  const logout = () => {
    localStorage.removeItem('token')
    const dest = portalSlug ? `/portal/${portalSlug}` : '/login'
    window.location.href = dest
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f3eee6]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-200 border-b-transparent"
          style={{ borderBottomColor: primary }} />
      </div>
    )
  }

  return (
    <div
      className="min-h-screen text-slate-900"
      style={{
        background: 'linear-gradient(180deg, #f7f2ea 0%, #efe6da 100%)',
        ['--brand' as any]: primary,
        ['--brand-accent' as any]: accent,
      }}
    >
      <header className="bg-[#fbf7f1]/95 backdrop-blur border-b border-[#e5d9c8] px-4 sm:px-6 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-3 min-w-0">
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt={orgName} className="h-9 w-9 object-contain rounded-lg bg-white" />
          ) : (
            <div className="h-9 w-9 rounded-lg flex items-center justify-center text-white text-sm font-bold"
              style={{ background: primary }}>{(orgName || 'I').slice(0, 1)}</div>
          )}
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 truncate">{portalTitle}</h1>
            <p className="text-xs sm:text-sm text-slate-500 truncate">{orgName} · {user?.fullName}</p>
          </div>
        </div>
        <button type="button" onClick={logout}
          className="flex items-center gap-2 text-slate-500 hover:text-red-600 text-sm shrink-0">
          <LogOut className="h-4 w-4" /> Salir
        </button>
      </header>

      <main className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Días como cliente', value: data?.daysAsClient ?? 0, icon: Clock },
            { label: 'Deuda pendiente', value: formatMoney(data?.pendingAmount || 0), icon: DollarSign },
            { label: 'Tickets abiertos', value: data?.openTickets ?? 0, icon: Ticket },
            { label: 'Servicios', value: data?.services?.length ?? 0, icon: Wifi },
          ].map(s => (
            <div key={s.label} className="bg-[#fbf7f1] rounded-xl p-4 border border-[#e5d9c8] shadow-sm">
              <s.icon className="h-5 w-5 mb-2" style={{ color: primary }} />
              <p className="text-xs text-slate-500">{s.label}</p>
              <p className="text-lg font-bold text-slate-900">{s.value}</p>
            </div>
          ))}
        </div>

        {data?.pendingAmount > 0 && (
          <div className="rounded-xl p-4 flex flex-wrap items-center gap-3 border"
            style={{ background: `${accent}18`, borderColor: `${accent}55` }}>
            <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: accent }} />
            <p className="text-sm text-slate-900 flex-1 min-w-[200px]">
              Tienes facturas pendientes por <strong>{formatMoney(data.pendingAmount)}</strong>.
            </p>
            <button type="button" onClick={() => setTab('facturas')}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: primary }}>
              Ir a pagar
            </button>
          </div>
        )}

        <div className="flex gap-1 bg-[#e8dfd2] rounded-xl p-1 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} type="button"
              onClick={() => { setTab(t.id); setSelectedTicketId(null); setTicketDetail(null) }}
              className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                tab === t.id ? 'bg-[#fbf7f1] shadow-sm text-slate-900' : 'text-slate-600 hover:text-slate-900'
              }`}
              style={tab === t.id ? { color: primary } : undefined}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'resumen' && (
          <div className="space-y-4">
            <div className="bg-[#fbf7f1] rounded-xl border border-[#e5d9c8] p-5 sm:p-6">
              <h2 className="font-semibold text-slate-900 mb-4">Mi servicio de internet</h2>
              {!data?.services?.length ? (
                <p className="text-slate-500 text-sm">Aún no tienes un servicio asignado. Si acabas de contratar, tu ISP te avisará cuando esté activo.</p>
              ) : data.services.map((s: any) => (
                <div key={s.id} className="border border-[#e5d9c8] rounded-xl p-4 space-y-3 bg-white/60">
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <p className="font-bold text-slate-900 text-lg">{s.plan?.name || 'Plan'}</p>
                      <p className="text-sm text-slate-600">
                        {s.plan?.downloadSpeed}/{s.plan?.uploadSpeed} Mbps · {formatMoney(Number(s.plan?.price || 0))}/mes
                      </p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColor[s.status] || 'bg-slate-100 text-slate-600'}`}>
                      {statusLabel[s.status] || s.status}
                    </span>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3 text-sm">
                    <div className="flex items-start gap-2 text-slate-700">
                      <Calendar className="h-4 w-4 mt-0.5 text-slate-400 shrink-0" />
                      <div>
                        <p className="text-xs text-slate-500">Próximo cobro</p>
                        <p className="font-medium">{formatDate(s.nextBillingDate)}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 text-slate-700">
                      <Signal className={`h-4 w-4 mt-0.5 shrink-0 ${signalTone(s.link?.signalDbm)}`} />
                      <div>
                        <p className="text-xs text-slate-500">Enlace</p>
                        <p className="font-medium">
                          {s.link?.statusLabel || 'Sin datos'}
                          {s.link?.signalDbm != null && (
                            <span className={`ml-1 ${signalTone(s.link.signalDbm)}`}>
                              · {s.link.signalDbm} dBm
                              {s.link.ccqPercent != null ? ` · CCQ ${s.link.ccqPercent}%` : ''}
                            </span>
                          )}
                        </p>
                        {s.link?.displayIp && (
                          <p className="text-xs text-slate-400 font-mono mt-0.5">IP {s.link.displayIp}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {data?.pendingAmount > 0 && (
              <div className="bg-[#fbf7f1] rounded-xl border border-[#e5d9c8] p-5">
                <h3 className="font-semibold text-slate-900 mb-2">Pagar ahora</h3>
                <p className="text-sm text-slate-600 mb-3">
                  Regulariza tu cuenta para mantener el servicio sin interrupciones.
                </p>
                <button type="button" onClick={() => setTab('facturas')}
                  className="px-4 py-2.5 rounded-lg text-sm font-medium text-white"
                  style={{ background: primary }}>
                  Ver facturas
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'facturas' && (
          <div className="bg-[#fbf7f1] rounded-xl border border-[#e5d9c8] divide-y divide-[#e5d9c8]">
            {!data?.invoices?.length ? (
              <p className="p-6 text-slate-500 text-sm">Aún no hay facturas en tu cuenta.</p>
            ) : data.invoices.map((inv: any) => {
              const payable = ['pending', 'overdue', 'partial'].includes(inv.status)
              return (
                <div key={inv.id} className="p-4 flex flex-wrap justify-between items-center gap-3">
                  <div>
                    <p className="font-medium text-slate-900">{inv.invoiceNumber}</p>
                    <p className="text-xs text-slate-500">Vence {formatDate(inv.dueDate)}</p>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="text-right">
                      <p className="font-bold text-slate-900">{formatMoney(Number(inv.total))}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor[inv.status]}`}>
                        {statusLabel[inv.status] || inv.status}
                      </span>
                    </div>
                    <button type="button" onClick={() => downloadPdf(inv.id, inv.invoiceNumber)}
                      className="px-2.5 py-2 rounded-lg text-xs font-medium border border-[#e5d9c8] bg-white hover:bg-[#f3eee6] text-slate-700 flex items-center gap-1"
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

        {tab === 'tickets' && (
          <div className="space-y-4">
            {!selectedTicketId ? (
              <>
                <button type="button" onClick={() => setShowTicket(true)}
                  className="px-4 py-2 text-white rounded-lg text-sm flex items-center gap-2"
                  style={{ background: primary }}>
                  <Plus className="h-4 w-4" /> Reportar problema
                </button>
                <div className="bg-[#fbf7f1] rounded-xl border border-[#e5d9c8] divide-y divide-[#e5d9c8]">
                  {!data?.tickets?.length ? (
                    <p className="p-6 text-slate-500 text-sm">Sin solicitudes de soporte. Si tienes un problema, repórtalo aquí.</p>
                  ) : data.tickets.map((t: any) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => loadTicketDetail(t.id)}
                      className="w-full text-left p-4 hover:bg-white/70 transition"
                    >
                      <div className="flex justify-between items-start gap-3">
                        <div>
                          <p className="font-medium text-slate-900">{t.subject}</p>
                          <p className="text-xs text-slate-400 font-mono mt-1">{t.ticketNumber}</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${statusColor[t.status]}`}>
                          {statusLabel[t.status] || t.status}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 mt-2 line-clamp-2">{t.description}</p>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="bg-[#fbf7f1] rounded-xl border border-[#e5d9c8] overflow-hidden">
                <div className="p-4 border-b border-[#e5d9c8] flex items-center gap-3">
                  <button type="button" onClick={() => { setSelectedTicketId(null); setTicketDetail(null) }}
                    className="p-2 hover:bg-white/80 rounded-lg">
                    <ChevronLeft className="h-5 w-5 text-slate-700" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-900 truncate">{ticketDetail?.subject}</h3>
                    <p className="text-xs text-slate-400 font-mono">{ticketDetail?.ticketNumber}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${statusColor[ticketDetail?.status] || 'bg-slate-100'}`}>
                    {statusLabel[ticketDetail?.status] || ticketDetail?.status}
                  </span>
                </div>

                <div className="p-4 space-y-3 max-h-[360px] overflow-y-auto bg-[#f3eee6]/60">
                  {(ticketDetail?.messages?.length ? ticketDetail.messages : [{
                    id: 0,
                    message: ticketDetail?.description,
                    authorName: user?.fullName,
                    authorRole: 'client',
                    createdAt: ticketDetail?.createdAt,
                  }]).map((msg: any) => (
                    <div key={msg.id} className={`rounded-lg p-3 ${
                      msg.authorRole === 'client'
                        ? 'bg-white border border-[#e5d9c8] ml-4'
                        : 'bg-sky-50 border border-sky-100 mr-4'
                    }`}>
                      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                        <MessageSquare className="h-3 w-3" />
                        <span className="font-medium">{msg.authorName || 'Soporte'}</span>
                        {msg.createdAt && <span>· {new Date(msg.createdAt).toLocaleString('es-CL')}</span>}
                      </div>
                      <p className="text-sm text-slate-800 whitespace-pre-wrap">{msg.message}</p>
                    </div>
                  ))}
                </div>

                {!['closed', 'resolved'].includes(ticketDetail?.status) && (
                  <form onSubmit={sendReply} className="p-4 border-t border-[#e5d9c8] flex gap-2">
                    <input value={replyText} onChange={e => setReplyText(e.target.value)}
                      placeholder="Escribe tu respuesta…"
                      className="flex-1 border border-[#e5d9c8] rounded-lg px-3 py-2 text-sm bg-white text-slate-900" />
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

        <p className="text-center text-xs text-slate-500 pt-2 pb-6">
          ¿Necesitas ayuda? Contacta a {orgName}
          {brand.supportEmail ? (
            <> · <a className="underline hover:text-slate-700" href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a></>
          ) : null}
        </p>
      </main>

      {showTicket && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <form onSubmit={submitTicket} className="bg-[#fbf7f1] rounded-t-2xl sm:rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl border border-[#e5d9c8]">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-slate-900">Reportar problema</h3>
              <button type="button" onClick={() => setShowTicket(false)}><X className="h-5 w-5 text-slate-600" /></button>
            </div>
            <input required placeholder="Asunto" value={ticketForm.subject}
              onChange={e => setTicketForm({ ...ticketForm, subject: e.target.value })}
              className="w-full border border-[#e5d9c8] rounded-lg px-3 py-2 bg-white text-slate-900" />
            <textarea required rows={4} placeholder="Describe el problema…" value={ticketForm.description}
              onChange={e => setTicketForm({ ...ticketForm, description: e.target.value })}
              className="w-full border border-[#e5d9c8] rounded-lg px-3 py-2 bg-white text-slate-900" />
            <select value={ticketForm.priority} onChange={e => setTicketForm({ ...ticketForm, priority: e.target.value })}
              className="w-full border border-[#e5d9c8] rounded-lg px-3 py-2 bg-white text-slate-900">
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
