import { useState, useEffect } from 'react'
import {
  Building2, Users, Router, LogOut, Wifi, AlertTriangle, RefreshCw,
  Search, ChevronRight, Calendar, Shield, X, Save, Clock, Mail, Globe,
} from 'lucide-react'
import axios from 'axios'

const planLabels: Record<string, string> = {
  trial: 'Trial',
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

const planColors: Record<string, string> = {
  trial: 'bg-amber-900/50 text-amber-300 border-amber-800',
  starter: 'bg-blue-900/50 text-blue-300 border-blue-800',
  pro: 'bg-violet-900/50 text-violet-300 border-violet-800',
  enterprise: 'bg-emerald-900/50 text-emerald-300 border-emerald-800',
}

export default function PlatformDashboard({ user, API }: { user: any; API: string }) {
  const [tab, setTab] = useState<'overview' | 'isps'>('overview')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null)
  const [orgDetail, setOrgDetail] = useState<any>(null)
  const [editForm, setEditForm] = useState<any>({})
  const [saving, setSaving] = useState(false)

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    })
  }

  async function loadDashboard() {
    setLoading(true)
    try {
      const res = await api().get('/platform/dashboard')
      setData(res.data)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  async function loadOrgDetail(id: number) {
    try {
      const res = await api().get(`/platform/organizations/${id}`)
      setOrgDetail(res.data)
      setEditForm({
        name: res.data.name,
        email: res.data.email || '',
        plan: res.data.plan,
        trialEndsAt: res.data.trialEndsAt ? res.data.trialEndsAt.slice(0, 10) : '',
        isActive: res.data.isActive,
        maxRouters: res.data.maxRouters ?? 5,
        maxClients: res.data.maxClients ?? 100,
      })
      setSelectedOrgId(id)
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error al cargar ISP')
    }
  }

  async function saveOrg() {
    if (!selectedOrgId) return
    setSaving(true)
    try {
      const res = await api().patch(`/platform/organizations/${selectedOrgId}`, editForm)
      setOrgDetail({ ...orgDetail, ...res.data, staff: orgDetail.staff })
      await loadDashboard()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error al guardar')
    }
    setSaving(false)
  }

  async function extendTrial(days: number) {
    if (!selectedOrgId) return
    try {
      const res = await api().post(`/platform/organizations/${selectedOrgId}/extend-trial`, { days })
      setOrgDetail({ ...orgDetail, ...res.data, staff: orgDetail.staff })
      setEditForm((f: any) => ({ ...f, trialEndsAt: res.data.trialEndsAt?.slice(0, 10), plan: 'trial' }))
      await loadDashboard()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    }
  }

  useEffect(() => { loadDashboard() }, [])

  const logout = () => { localStorage.removeItem('token'); window.location.href = '/login' }

  const orgs = (data?.organizations || []).filter((o: any) =>
    !search || o.name.toLowerCase().includes(search.toLowerCase())
    || o.slug.toLowerCase().includes(search.toLowerCase())
    || (o.email || '').toLowerCase().includes(search.toLowerCase()),
  )

  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-400" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex">
      <aside className="w-64 border-r border-slate-800 flex flex-col flex-shrink-0">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center">
              <Wifi className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-bold text-sm leading-tight">FibraNexus</h1>
              <p className="text-violet-400 text-xs font-medium">Platform · Super Admin</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {[
            { id: 'overview', label: 'Overview', icon: Globe },
            { id: 'isps', label: 'ISPs (tenants)', icon: Building2 },
          ].map((item) => (
            <button key={item.id} onClick={() => setTab(item.id as 'overview' | 'isps')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition ${tab === item.id ? 'bg-violet-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'}`}>
              <item.icon className="h-4 w-4" /> {item.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 bg-violet-800 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                {user?.fullName?.charAt(0) || 'S'}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">{user?.fullName}</p>
                <p className="text-[10px] text-violet-400">Dueño plataforma</p>
              </div>
            </div>
            <button onClick={logout} className="text-slate-500 hover:text-red-400 p-1"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </aside>

      <div className="flex-1 overflow-auto">
        <header className="sticky top-0 z-10 bg-slate-950/90 backdrop-blur border-b border-slate-800 px-8 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold">{tab === 'overview' ? 'Overview plataforma' : 'Gestión de ISPs'}</h2>
            <p className="text-sm text-slate-400">SaaS multi-tenant · cada ISP es un cliente tuyo de FibraNexus</p>
          </div>
          <button onClick={loadDashboard} className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm">
            <RefreshCw className="h-4 w-4" /> Actualizar
          </button>
        </header>

        <main className="p-8 max-w-6xl space-y-8">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'ISPs totales', value: data?.stats?.totalOrganizations ?? 0, icon: Building2, color: 'text-violet-400' },
              { label: 'ISPs activos', value: data?.stats?.activeOrganizations ?? 0, icon: Shield, color: 'text-green-400' },
              { label: 'Trials activos', value: data?.stats?.activeTrials ?? 0, icon: Clock, color: 'text-amber-400' },
              { label: 'Trials por vencer', value: data?.stats?.trialsExpiringSoon ?? 0, icon: AlertTriangle, color: 'text-red-400' },
              { label: 'Abonados totales', value: data?.stats?.totalClients ?? 0, icon: Users, color: 'text-blue-400' },
              { label: 'Routers totales', value: data?.stats?.totalRouters ?? 0, icon: Router, color: 'text-cyan-400' },
            ].map((s) => (
              <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <s.icon className={`h-4 w-4 ${s.color} mb-2`} />
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">{s.label}</p>
                <p className="text-2xl font-bold mt-1">{s.value}</p>
              </div>
            ))}
          </div>

          {tab === 'overview' && (
            <>
              {(data?.expiringSoon?.length > 0) && (
                <div className="bg-red-950/30 border border-red-900 rounded-xl p-5">
                  <h3 className="font-semibold text-red-300 flex items-center gap-2 mb-3">
                    <AlertTriangle className="h-5 w-5" /> Trials por vencer (7 días)
                  </h3>
                  <div className="space-y-2">
                    {data.expiringSoon.map((o: any) => (
                      <div key={o.id} className="flex items-center justify-between bg-slate-900/50 rounded-lg px-4 py-2">
                        <span>{o.name} <span className="text-slate-500 text-sm">· {o.trialDaysLeft} días</span></span>
                        <button onClick={() => { setTab('isps'); loadOrgDetail(o.id) }}
                          className="text-xs text-violet-400 hover:underline">Gestionar →</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center">
                  <h3 className="font-semibold">ISPs recientes</h3>
                  <button onClick={() => setTab('isps')} className="text-sm text-violet-400 hover:underline">Ver todos →</button>
                </div>
                <OrgTable orgs={data?.recent || []} onSelect={loadOrgDetail} compact />
              </div>
            </>
          )}

          {tab === 'isps' && (
            <div className="space-y-4">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 outline-none"
                  placeholder="Buscar ISP por nombre, slug o email…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <OrgTable orgs={orgs} onSelect={loadOrgDetail} />
              </div>
            </div>
          )}
        </main>
      </div>

      {selectedOrgId && orgDetail && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => { setSelectedOrgId(null); setOrgDetail(null) }} />
          <div className="relative ml-auto w-full max-w-lg bg-slate-900 border-l border-slate-700 h-full overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-6 py-4 flex justify-between items-start z-10">
              <div>
                <p className="text-xs text-violet-400 font-medium uppercase tracking-wide">Tenant ISP</p>
                <h3 className="text-xl font-bold">{orgDetail.name}</h3>
                <p className="text-sm text-slate-400">{orgDetail.slug}</p>
              </div>
              <button onClick={() => { setSelectedOrgId(null); setOrgDetail(null) }} className="text-slate-400 hover:text-white p-1">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Abonados', value: orgDetail.clientCount },
                  { label: 'Routers', value: orgDetail.routerCount },
                  { label: 'Tickets', value: orgDetail.openTickets },
                ].map((m) => (
                  <div key={m.label} className="bg-slate-800 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold">{m.value}</p>
                    <p className="text-[10px] text-slate-400 uppercase">{m.label}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-4">
                <h4 className="font-semibold text-sm text-slate-300">Configuración del tenant</h4>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Nombre ISP</label>
                  <input className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                    value={editForm.name || ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Email contacto</label>
                  <input className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                    value={editForm.email || ''} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Plan SaaS</label>
                    <select className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                      value={editForm.plan || 'trial'} onChange={(e) => setEditForm({ ...editForm, plan: e.target.value })}>
                      {['trial', 'starter', 'pro', 'enterprise'].map((p) => (
                        <option key={p} value={p}>{planLabels[p]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Estado</label>
                    <select className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                      value={editForm.isActive ? '1' : '0'} onChange={(e) => setEditForm({ ...editForm, isActive: e.target.value === '1' })}>
                      <option value="1">Activo</option>
                      <option value="0">Suspendido</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Fin del trial</label>
                  <input type="date" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                    value={editForm.trialEndsAt || ''} onChange={(e) => setEditForm({ ...editForm, trialEndsAt: e.target.value })} />
                </div>
                <div className="flex gap-2">
                  {[14, 30, 90, 365].map((d) => (
                    <button key={d} type="button" onClick={() => extendTrial(d)}
                      className="flex-1 py-1.5 text-xs bg-slate-800 hover:bg-violet-900 border border-slate-700 rounded-lg">
                      +{d}d trial
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Máx. routers</label>
                    <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                      value={editForm.maxRouters} onChange={(e) => setEditForm({ ...editForm, maxRouters: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Máx. abonados</label>
                    <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                      value={editForm.maxClients} onChange={(e) => setEditForm({ ...editForm, maxClients: e.target.value })} />
                  </div>
                </div>
                <button onClick={saveOrg} disabled={saving}
                  className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg font-medium flex items-center justify-center gap-2">
                  <Save className="h-4 w-4" /> {saving ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>

              <div>
                <h4 className="font-semibold text-sm text-slate-300 mb-3">Staff del ISP</h4>
                {!orgDetail.staff?.length ? (
                  <p className="text-sm text-slate-500">Sin staff registrado</p>
                ) : (
                  <div className="space-y-2">
                    {orgDetail.staff.map((s: any) => (
                      <div key={s.id} className="flex items-center gap-3 bg-slate-800 rounded-lg px-4 py-3">
                        <div className="w-8 h-8 bg-blue-900 rounded-full flex items-center justify-center text-xs font-bold">
                          {s.fullName?.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{s.fullName}</p>
                          <p className="text-xs text-slate-400 truncate flex items-center gap-1"><Mail className="h-3 w-3" />{s.email}</p>
                        </div>
                        <span className="text-[10px] uppercase px-2 py-0.5 bg-slate-700 rounded text-slate-300">{s.role}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-xs text-slate-500 flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Registrado: {new Date(orgDetail.createdAt).toLocaleDateString('es-CL')}
                {orgDetail.trialDaysLeft != null && ` · Trial: ${orgDetail.trialDaysLeft} días restantes`}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function OrgTable({ orgs, onSelect, compact }: { orgs: any[]; onSelect: (id: number) => void; compact?: boolean }) {
  if (!orgs.length) {
    return <p className="p-8 text-center text-slate-500 text-sm">Sin ISPs registrados</p>
  }
  return (
    <table className="w-full">
      <thead className="bg-slate-950 text-[10px] uppercase text-slate-500 tracking-wide">
        <tr>
          {['ISP', 'Plan', 'Trial', 'Abonados', 'Routers', !compact && 'Staff', 'Estado', ''].filter(Boolean).map((h) => (
            <th key={String(h)} className="text-left p-4">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-800">
        {orgs.map((org) => (
          <tr key={org.id} className="hover:bg-slate-800/40 cursor-pointer" onClick={() => onSelect(org.id)}>
            <td className="p-4">
              <p className="font-medium">{org.name}</p>
              <p className="text-xs text-slate-500">{org.slug}</p>
            </td>
            <td className="p-4">
              <span className={`text-xs px-2 py-0.5 rounded border ${planColors[org.plan] || 'bg-slate-800 text-slate-300'}`}>
                {planLabels[org.plan] || org.plan}
              </span>
            </td>
            <td className="p-4 text-sm">
              {org.trialDaysLeft != null ? (
                <span className={org.trialExpiringSoon ? 'text-red-400 font-medium' : 'text-slate-300'}>
                  {org.trialDaysLeft}d
                </span>
              ) : '—'}
            </td>
            <td className="p-4 text-sm">{org.clientCount}</td>
            <td className="p-4 text-sm">{org.routerCount}</td>
            {!compact && <td className="p-4 text-sm">{org.staffCount}</td>}
            <td className="p-4">
              <span className={`text-xs px-2 py-0.5 rounded-full ${org.isActive ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
                {org.isActive ? 'Activo' : 'Off'}
              </span>
            </td>
            <td className="p-4"><ChevronRight className="h-4 w-4 text-slate-600" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
