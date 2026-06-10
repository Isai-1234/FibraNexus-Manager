import { useState, useEffect } from 'react'
import { ArrowLeft, User, Wifi, DollarSign, Ticket, Edit2, X, CheckCircle, AlertTriangle, Clock, Phone, Mail, MapPin, CreditCard, Plus, Power, PowerOff } from 'lucide-react'
import axios from 'axios'

interface Props {
  clientId: number
  API: string
  onBack: () => void
}

export default function ClientDetail({ clientId, API, onBack }: Props) {
  const [client, setClient] = useState<any>(null)
  const [services, setServices] = useState<any[]>([])
  const [invoices, setInvoices] = useState<any[]>([])
  const [tickets, setTickets] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [showPayModal, setShowPayModal] = useState<any>(null)
  const [payMethod, setPayMethod] = useState('transfer')

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
    })
  }

  useEffect(() => { loadAll() }, [clientId])

  async function loadAll() {
    setLoading(true)
    try {
      const [cRes, sRes, iRes, tRes] = await Promise.all([
        api().get(`/clients/${clientId}`),
        api().get('/services'),
        api().get('/invoices'),
        api().get('/tickets'),
      ])
      setClient(cRes.data)
      setServices((Array.isArray(sRes.data) ? sRes.data : []).filter((s: any) => s.client?.id === clientId || s.clientId === clientId))
      setInvoices((Array.isArray(iRes.data) ? iRes.data : []).filter((i: any) => i.client?.id === clientId || i.clientId === clientId))
      setTickets((Array.isArray(tRes.data) ? tRes.data : []).filter((t: any) => t.client?.id === clientId || t.clientId === clientId))
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function toggleService(serviceId: number, currentStatus: string) {
    try {
      const action = currentStatus === 'active' ? 'suspend' : 'reactivate'
      await api().put(`/services/${serviceId}/${action}`)
      loadAll()
    } catch (e: any) { alert('Error: ' + e.message) }
  }

  async function payInvoice() {
    if (!showPayModal) return
    try {
      await api().post('/payments', { invoiceId: showPayModal.id, method: payMethod, amount: showPayModal.total })
      setShowPayModal(null)
      loadAll()
    } catch (e: any) { alert('Error: ' + (e.response?.data?.error || e.message)) }
  }

  const statusColor: Record<string, string> = {
    active: 'bg-green-100 text-green-700', suspended: 'bg-yellow-100 text-yellow-700',
    cancelled: 'bg-red-100 text-red-700', pending: 'bg-blue-100 text-blue-700',
    paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700',
    open: 'bg-yellow-100 text-yellow-700', resolved: 'bg-green-100 text-green-700',
    in_progress: 'bg-blue-100 text-blue-700', closed: 'bg-gray-100 text-gray-500',
    critical: 'bg-red-100 text-red-700', high: 'bg-orange-100 text-orange-700',
    medium: 'bg-blue-100 text-blue-700', low: 'bg-gray-100 text-gray-500',
  }
  const statusLabel: Record<string, string> = {
    active: 'Activo', suspended: 'Suspendido', cancelled: 'Cancelado', pending: 'Pendiente',
    paid: 'Pagada', overdue: 'Vencida', open: 'Abierto', resolved: 'Resuelto',
    in_progress: 'En proceso', closed: 'Cerrado', cut: 'Cortado',
    critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja',
    individual: 'Individual', business: 'Empresa',
  }

  const pendingInvoices = invoices.filter(i => i.status === 'pending' || i.status === 'overdue')
  const totalDeuda = pendingInvoices.reduce((sum, i) => sum + Number(i.total || 0), 0)

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-500">Cargando cliente...</p>
      </div>
    </div>
  )

  if (!client) return (
    <div className="flex-1 flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <p className="text-gray-500">Cliente no encontrado</p>
        <button onClick={onBack} className="mt-4 text-blue-600 hover:underline">Volver</button>
      </div>
    </div>
  )

  return (
    <div className="flex-1 overflow-auto bg-gray-50">
      {/* Pay Modal */}
      {showPayModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
            <div className="flex justify-between items-center mb-4 border-b pb-3">
              <h3 className="font-bold text-lg">Registrar pago</h3>
              <button onClick={() => setShowPayModal(null)}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500">Factura</p>
                <p className="font-bold text-lg">{showPayModal.invoiceNumber}</p>
                <p className="text-2xl font-bold text-blue-600 mt-1">${Number(showPayModal.total).toLocaleString('es-CL')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Método de pago</label>
                <select className="w-full border rounded-lg px-3 py-2" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                  <option value="transfer">Transferencia bancaria</option>
                  <option value="cash">Efectivo</option>
                  <option value="card">Tarjeta</option>
                  <option value="flow">Flow</option>
                  <option value="other">Otro</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t">
              <button onClick={() => setShowPayModal(null)} className="flex-1 py-2.5 border rounded-lg hover:bg-gray-50 font-medium">Cancelar</button>
              <button onClick={payInvoice} className="flex-1 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium">Confirmar pago</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b px-8 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-3 flex-1">
            <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
              {client.user?.fullName?.charAt(0) || '?'}
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{client.user?.fullName}</h1>
              <p className="text-sm text-gray-500">{client.user?.email} · {client.city || 'Sin ciudad'}</p>
            </div>
          </div>
          {totalDeuda > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-center">
              <p className="text-xs text-red-500 font-medium">Deuda pendiente</p>
              <p className="text-lg font-bold text-red-600">${totalDeuda.toLocaleString('es-CL')}</p>
            </div>
          )}
          <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${services.some(s => s.status === 'active') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {services.some(s => s.status === 'active') ? 'Servicio activo' : 'Sin servicio activo'}
          </span>
        </div>
      </header>

      <div className="p-8 max-w-6xl mx-auto">
        {/* Stats rápidas */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Servicios', value: services.length, icon: Wifi, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'Facturas', value: invoices.length, icon: DollarSign, color: 'text-purple-600', bg: 'bg-purple-50' },
            { label: 'Por cobrar', value: '$' + totalDeuda.toLocaleString('es-CL'), icon: CreditCard, color: 'text-red-600', bg: 'bg-red-50' },
            { label: 'Tickets', value: tickets.filter(t => t.status === 'open').length + ' abiertos', icon: Ticket, color: 'text-yellow-600', bg: 'bg-yellow-50' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-lg ${s.bg}`}><s.icon className={`h-4 w-4 ${s.color}`} /></div>
                <p className="text-xs text-gray-500 font-medium">{s.label}</p>
              </div>
              <p className="text-xl font-bold text-gray-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
          {[
            { id: 'overview', label: 'Resumen' },
            { id: 'services', label: `Servicios (${services.length})` },
            { id: 'invoices', label: `Facturas (${invoices.length})` },
            { id: 'tickets', label: `Tickets (${tickets.length})` },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === tab.id ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Datos personales */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-semibold text-gray-900 flex items-center gap-2"><User className="h-4 w-4 text-blue-600" /> Datos personales</h2>
              </div>
              <div className="space-y-3">
                {[
                  { label: 'Nombre', value: client.user?.fullName, icon: User },
                  { label: 'Email', value: client.user?.email, icon: Mail },
                  { label: 'Teléfono', value: client.user?.phone || '—', icon: Phone },
                  { label: 'RUT', value: client.rut || '—', icon: CreditCard },
                  { label: 'Dirección', value: client.address || '—', icon: MapPin },
                  { label: 'Ciudad', value: client.city || '—', icon: MapPin },
                  { label: 'Región', value: client.region || '—', icon: MapPin },
                  { label: 'Tipo', value: statusLabel[client.clientType] || client.clientType, icon: User },
                ].map(f => (
                  <div key={f.label} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                    <f.icon className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 font-medium">{f.label}</p>
                      <p className="text-sm text-gray-900 truncate">{f.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Servicio activo */}
            <div className="space-y-4">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4"><Wifi className="h-4 w-4 text-green-600" /> Servicio actual</h2>
                {services.length === 0 ? (
                  <div className="text-center py-6 text-gray-400">
                    <Wifi className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Sin servicios asignados</p>
                  </div>
                ) : services.slice(0, 2).map(s => (
                  <div key={s.id} className="border rounded-lg p-4 mb-3 last:mb-0">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold text-gray-900">{s.plan?.name || 'Plan desconocido'}</p>
                        <p className="text-sm text-gray-500">{s.plan?.downloadSpeed}/{s.plan?.uploadSpeed} Mbps</p>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[s.status] || 'bg-gray-100'}`}>
                        {statusLabel[s.status] || s.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 mt-3">
                      <div><span className="font-medium">IP:</span> {s.ipAddress || '—'}</div>
                      <div><span className="font-medium">MAC:</span> {s.macAddress || '—'}</div>
                      <div><span className="font-medium">Instalación:</span> {s.installationDate || '—'}</div>
                      <div><span className="font-medium">Precio:</span> ${Number(s.plan?.price || 0).toLocaleString('es-CL')}</div>
                    </div>
                    <button onClick={() => toggleService(s.id, s.status)}
                      className={`mt-3 w-full py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 ${s.status === 'active' ? 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>
                      {s.status === 'active' ? <><PowerOff className="h-3.5 w-3.5" /> Suspender servicio</> : <><Power className="h-3.5 w-3.5" /> Reactivar servicio</>}
                    </button>
                  </div>
                ))}
              </div>

              {/* Última factura */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4"><DollarSign className="h-4 w-4 text-purple-600" /> Facturas recientes</h2>
                {invoices.length === 0 ? (
                  <div className="text-center py-4 text-gray-400 text-sm">Sin facturas</div>
                ) : invoices.slice(0, 3).map(inv => (
                  <div key={inv.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{inv.invoiceNumber}</p>
                      <p className="text-xs text-gray-400">{inv.billingPeriod || inv.dueDate}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold">${Number(inv.total).toLocaleString('es-CL')}</p>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[inv.status] || 'bg-gray-100'}`}>
                        {statusLabel[inv.status] || inv.status}
                      </span>
                      {(inv.status === 'pending' || inv.status === 'overdue') && (
                        <button onClick={() => setShowPayModal(inv)} className="px-2 py-0.5 bg-green-600 text-white rounded text-xs hover:bg-green-700">Pagar</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* SERVICIOS */}
        {activeTab === 'services' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100">
            {services.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Wifi className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="font-medium">Sin servicios asignados</p>
              </div>
            ) : (
              <div className="divide-y">
                {services.map(s => (
                  <div key={s.id} className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="font-bold text-lg text-gray-900">{s.plan?.name}</h3>
                        <p className="text-gray-500">{s.plan?.downloadSpeed}/{s.plan?.uploadSpeed} Mbps · ${Number(s.plan?.price || 0).toLocaleString('es-CL')}/mes</p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColor[s.status] || 'bg-gray-100'}`}>
                        {statusLabel[s.status] || s.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm bg-gray-50 rounded-lg p-4">
                      <div><p className="text-gray-400 text-xs mb-1">Dirección IP</p><p className="font-mono font-medium">{s.ipAddress || '—'}</p></div>
                      <div><p className="text-gray-400 text-xs mb-1">MAC Address</p><p className="font-mono font-medium">{s.macAddress || '—'}</p></div>
                      <div><p className="text-gray-400 text-xs mb-1">Instalación</p><p className="font-medium">{s.installationDate || '—'}</p></div>
                      <div><p className="text-gray-400 text-xs mb-1">Próx. factura</p><p className="font-medium">{s.nextBillingDate || '—'}</p></div>
                    </div>
                    <div className="flex gap-2 mt-4">
                      <button onClick={() => toggleService(s.id, s.status)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${s.status === 'active' ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
                        {s.status === 'active' ? <><PowerOff className="h-4 w-4" /> Suspender</> : <><Power className="h-4 w-4" /> Reactivar</>}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* FACTURAS */}
        {activeTab === 'invoices' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100">
            {invoices.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <DollarSign className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="font-medium">Sin facturas registradas</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    {['Nº Factura', 'Período', 'Neto', 'IVA', 'Total', 'Vencimiento', 'Estado', 'Acción'].map(h => (
                      <th key={h} className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoices.map(inv => (
                    <tr key={inv.id} className="hover:bg-gray-50">
                      <td className="p-4 font-mono text-sm text-blue-600 font-medium">{inv.invoiceNumber}</td>
                      <td className="p-4 text-sm">{inv.billingPeriod || '—'}</td>
                      <td className="p-4 text-sm">${Number(inv.amount).toLocaleString('es-CL')}</td>
                      <td className="p-4 text-sm">${Number(inv.tax).toLocaleString('es-CL')}</td>
                      <td className="p-4 font-bold">${Number(inv.total).toLocaleString('es-CL')}</td>
                      <td className="p-4 text-sm text-gray-500">{inv.dueDate}</td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[inv.status] || 'bg-gray-100'}`}>
                          {statusLabel[inv.status] || inv.status}
                        </span>
                      </td>
                      <td className="p-4">
                        {(inv.status === 'pending' || inv.status === 'overdue') && (
                          <button onClick={() => setShowPayModal(inv)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700">
                            Registrar pago
                          </button>
                        )}
                        {inv.status === 'paid' && <span className="text-green-600 text-xs flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> Pagada</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t">
                  <tr>
                    <td colSpan={4} className="p-4 text-sm font-semibold text-gray-700">Total pendiente</td>
                    <td className="p-4 font-bold text-red-600">${totalDeuda.toLocaleString('es-CL')}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        )}

        {/* TICKETS */}
        {activeTab === 'tickets' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100">
            {tickets.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Ticket className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="font-medium">Sin tickets registrados</p>
              </div>
            ) : (
              <div className="divide-y">
                {tickets.map(t => (
                  <div key={t.id} className="p-6 hover:bg-gray-50">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold text-gray-900">{t.subject}</p>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[t.priority] || 'bg-gray-100'}`}>{statusLabel[t.priority] || t.priority}</span>
                        </div>
                        <p className="text-sm text-gray-500 mb-2">{t.description}</p>
                        <div className="flex items-center gap-4 text-xs text-gray-400">
                          <span className="font-mono">{t.ticketNumber}</span>
                          <span>{t.category || 'Sin categoría'}</span>
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(t.createdAt).toLocaleDateString('es-CL')}</span>
                        </div>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ml-4 ${statusColor[t.status] || 'bg-gray-100'}`}>
                        {statusLabel[t.status] || t.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}