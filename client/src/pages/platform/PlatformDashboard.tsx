import { useState, useEffect } from 'react'
import { Building2, Users, Router, LogOut, Wifi, AlertTriangle } from 'lucide-react'
import axios from 'axios'

export default function PlatformDashboard({ user, API }: { user: any; API: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    })
  }

  useEffect(() => {
    api().get('/platform/dashboard').then(r => setData(r.data)).finally(() => setLoading(false))
  }, [])

  const logout = () => { localStorage.removeItem('token'); window.location.href = '/login' }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 px-8 py-5 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-600 rounded-lg flex items-center justify-center">
            <Wifi className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold">FibraNexus Platform</h1>
            <p className="text-slate-400 text-sm">Super Admin · {user?.fullName}</p>
          </div>
        </div>
        <button onClick={logout} className="text-slate-400 hover:text-red-400 flex items-center gap-2 text-sm">
          <LogOut className="h-4 w-4" /> Salir
        </button>
      </header>

      <main className="p-8 max-w-6xl mx-auto space-y-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'ISPs registrados', value: data?.stats?.totalOrganizations ?? 0, icon: Building2 },
            { label: 'Trials activos', value: data?.stats?.activeTrials ?? 0, icon: AlertTriangle },
            { label: 'Abonados totales', value: data?.stats?.totalClients ?? 0, icon: Users },
            { label: 'Routers conectados', value: data?.stats?.totalRouters ?? 0, icon: Router },
          ].map(s => (
            <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <s.icon className="h-5 w-5 text-violet-400 mb-2" />
              <p className="text-xs text-slate-400">{s.label}</p>
              <p className="text-2xl font-bold">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="font-semibold">Organizaciones (ISPs)</h2>
            <p className="text-sm text-slate-400">Cada ISP es un tenant aislado con sus abonados, routers y facturación.</p>
          </div>
          <table className="w-full">
            <thead className="bg-slate-950 text-xs uppercase text-slate-500">
              <tr>
                {['ISP', 'Plan', 'Trial', 'Abonados', 'Staff', 'Routers', 'Estado'].map(h => (
                  <th key={h} className="text-left p-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {(data?.organizations || []).map((org: any) => (
                <tr key={org.id} className="hover:bg-slate-800/50">
                  <td className="p-4">
                    <p className="font-medium">{org.name}</p>
                    <p className="text-xs text-slate-500">{org.slug} · {org.email}</p>
                  </td>
                  <td className="p-4 capitalize">{org.plan}</td>
                  <td className="p-4">{org.trialDaysLeft != null ? `${org.trialDaysLeft} días` : '—'}</td>
                  <td className="p-4">{org.clientCount}</td>
                  <td className="p-4">{org.staffCount}</td>
                  <td className="p-4">{org.routerCount}</td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded-full text-xs ${org.isActive ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                      {org.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.organizations?.length && (
            <p className="p-8 text-center text-slate-500">Sin organizaciones registradas.</p>
          )}
        </div>
      </main>
    </div>
  )
}
