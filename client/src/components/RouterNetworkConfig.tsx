import { useState, useEffect } from 'react'
import { Plus, RefreshCw, Server, Wifi, Radio } from 'lucide-react'
import axios from 'axios'

type Tab = 'dhcp' | 'ppp' | 'snmp'

interface Props {
  API: string
  routerId: number
  routerName: string
  siteEquipment?: any[]
}

export default function RouterNetworkConfig({ API, routerId, routerName, siteEquipment = [] }: Props) {
  const [tab, setTab] = useState<Tab>('dhcp')
  const [snapshot, setSnapshot] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [snmpResults, setSnmpResults] = useState<any[]>([])
  const [snmpPolling, setSnmpPolling] = useState(false)
  const [forms, setForms] = useState<any>({
    pool: { name: 'pool-wisp', ranges: '172.16.140.10-172.16.140.254' },
    network: { address: '172.16.140.0/24', gateway: '172.16.140.1', dnsServer: '8.8.8.8' },
    server: { name: 'dhcp-wisp', interface: 'bridge', addressPool: 'pool-wisp' },
    lease: { address: '', macAddress: '', comment: '' },
    profile: { name: '', localAddress: '172.16.140.1', remoteAddress: 'pool-wisp', rateLimit: '10M/20M' },
    pppServer: { serviceName: 'internet', interface: 'bridge', defaultProfile: '', oneSessionPerHost: true },
  })

  function api() {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    })
  }

  async function loadSnapshot() {
    setLoading(true)
    try {
      const res = await api().get(`/network/routers/${routerId}/snapshot`)
      setSnapshot(res.data)
      if (res.data.ipPools?.[0]?.name) {
        setForms((f: any) => ({
          ...f,
          server: { ...f.server, addressPool: res.data.ipPools[0].name },
          profile: { ...f.profile, 'remote-address': res.data.ipPools[0].name },
        }))
      }
      if (res.data.interfaces?.[0]?.name && !forms.server.interface) {
        setForms((f: any) => ({ ...f, server: { ...f.server, interface: res.data.interfaces[0].name } }))
      }
      if (res.data.pppProfiles?.[0]?.name && !forms.pppServer.defaultProfile) {
        setForms((f: any) => ({
          ...f,
          pppServer: { ...f.pppServer, defaultProfile: res.data.pppProfiles[0].name, interface: f.pppServer.interface || res.data.interfaces?.[0]?.name || 'bridge' },
        }))
      }
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    }
    setLoading(false)
  }

  useEffect(() => { if (routerId) loadSnapshot() }, [routerId])

  async function submit(path: string, body: any, msg: string) {
    try {
      await api().post(`/network/routers/${routerId}/${path}`, body)
      alert(msg)
      loadSnapshot()
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    }
  }

  async function pollAllSnmp() {
    setSnmpPolling(true)
    try {
      const res = await api().post('/network/equipment/snmp/poll-all')
      setSnmpResults(res.data.results || [])
    } catch (e: any) {
      alert('SNMP: ' + (e.response?.data?.error || e.message))
    }
    setSnmpPolling(false)
  }

  async function pollOne(id: number) {
    try {
      const res = await api().post(`/network/equipment/${id}/snmp/poll`)
      alert(`${res.data.equipment}: ${res.data.online ? 'Online' : 'Offline'} — ${res.data.sysName || ''}`)
      loadSnapshot()
    } catch (e: any) {
      alert('SNMP: ' + (e.response?.data?.error || e.message))
    }
  }

  const cpeDevices = siteEquipment.filter((e) => e.type === 'cpe' || e.type === 'ap' || e.brand?.toLowerCase()?.includes('ubiquiti'))

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'dhcp', label: 'DHCP', icon: Server },
    { id: 'ppp', label: 'Perfiles PPPoE', icon: Wifi },
    { id: 'snmp', label: 'SNMP', icon: Radio },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-2 border-b bg-gray-50">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${tab === t.id ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
        <button onClick={loadSnapshot} className="ml-auto p-1.5 hover:bg-gray-200 rounded-lg" title="Actualizar">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === 'dhcp' && (
          <>
            <p className="text-xs text-gray-500">Crea pool → red DHCP → servidor → leases estáticos para abonados con IP fija + MAC (antena Ubiquiti).</p>

            <section className="rounded-xl border p-4 space-y-3 bg-white">
              <h4 className="font-semibold text-sm">1. Pool de IPs</h4>
              <div className="grid grid-cols-2 gap-2">
                <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Nombre pool"
                  value={forms.pool.name} onChange={e => setForms({ ...forms, pool: { ...forms.pool, name: e.target.value } })} />
                <input className="border rounded-lg px-3 py-2 text-sm font-mono" placeholder="10.0.0.10-10.0.0.254"
                  value={forms.pool.ranges} onChange={e => setForms({ ...forms, pool: { ...forms.pool, ranges: e.target.value } })} />
              </div>
              <button onClick={() => submit('dhcp/pool', forms.pool, 'Pool creado')}
                className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Crear pool
              </button>
              {snapshot?.ipPools?.length > 0 && (
                <ul className="text-xs space-y-1 mt-2">
                  {snapshot.ipPools.map((p: any) => (
                    <li key={p['.id'] || p.name} className="font-mono bg-gray-50 px-2 py-1 rounded">{p.name} → {p.ranges}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border p-4 space-y-3 bg-white">
              <h4 className="font-semibold text-sm">2. Red DHCP</h4>
              <div className="grid grid-cols-2 gap-2">
                <input className="border rounded-lg px-3 py-2 text-sm font-mono" placeholder="172.16.140.0/24"
                  value={forms.network.address} onChange={e => setForms({ ...forms, network: { ...forms.network, address: e.target.value } })} />
                <input className="border rounded-lg px-3 py-2 text-sm font-mono" placeholder="Gateway"
                  value={forms.network.gateway} onChange={e => setForms({ ...forms, network: { ...forms.network, gateway: e.target.value } })} />
                <input className="border rounded-lg px-3 py-2 text-sm font-mono col-span-2" placeholder="DNS (8.8.8.8)"
                  value={forms.network.dnsServer} onChange={e => setForms({ ...forms, network: { ...forms.network, dnsServer: e.target.value } })} />
              </div>
              <button onClick={() => submit('dhcp/network', forms.network, 'Red DHCP creada')}
                className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Agregar red
              </button>
              {snapshot?.dhcpNetworks?.length > 0 && (
                <ul className="text-xs space-y-1">
                  {snapshot.dhcpNetworks.map((n: any) => (
                    <li key={n['.id']} className="bg-gray-50 px-2 py-1 rounded">{n.address} gw {n.gateway}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border p-4 space-y-3 bg-white">
              <h4 className="font-semibold text-sm">3. Servidor DHCP</h4>
              <div className="grid grid-cols-3 gap-2">
                <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Nombre"
                  value={forms.server.name} onChange={e => setForms({ ...forms, server: { ...forms.server, name: e.target.value } })} />
                <select className="border rounded-lg px-3 py-2 text-sm bg-white"
                  value={forms.server.interface} onChange={e => setForms({ ...forms, server: { ...forms.server, interface: e.target.value } })}>
                  <option value="">Interfaz…</option>
                  {(snapshot?.interfaces || []).map((i: any) => (
                    <option key={i.name} value={i.name}>{i.name} ({i.type})</option>
                  ))}
                </select>
                <select className="border rounded-lg px-3 py-2 text-sm bg-white"
                  value={forms.server.addressPool} onChange={e => setForms({ ...forms, server: { ...forms.server, addressPool: e.target.value } })}>
                  <option value="">Pool…</option>
                  {(snapshot?.ipPools || []).map((p: any) => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>
              <button onClick={() => submit('dhcp/server', forms.server, 'Servidor DHCP activo')}
                className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Crear servidor
              </button>
              {snapshot?.dhcpServers?.length > 0 && (
                <ul className="text-xs space-y-1">
                  {snapshot.dhcpServers.map((s: any) => (
                    <li key={s['.id']} className="bg-emerald-50 text-emerald-800 px-2 py-1 rounded">
                      {s.name} · {s.interface} · pool {s['address-pool']}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border p-4 space-y-3 bg-white">
              <h4 className="font-semibold text-sm">4. Lease estático (IP + MAC abonado)</h4>
              <div className="grid grid-cols-2 gap-2">
                <input className="border rounded-lg px-3 py-2 text-sm font-mono" placeholder="IP"
                  value={forms.lease.address} onChange={e => setForms({ ...forms, lease: { ...forms.lease, address: e.target.value } })} />
                <input className="border rounded-lg px-3 py-2 text-sm font-mono" placeholder="MAC antena"
                  value={forms.lease.macAddress} onChange={e => setForms({ ...forms, lease: { ...forms.lease, macAddress: e.target.value } })} />
                <input className="border rounded-lg px-3 py-2 text-sm col-span-2" placeholder="Comentario (nombre abonado)"
                  value={forms.lease.comment} onChange={e => setForms({ ...forms, lease: { ...forms.lease, comment: e.target.value } })} />
              </div>
              <button onClick={() => submit('dhcp/lease', forms.lease, 'Lease estático guardado')}
                className="text-sm px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Reservar IP
              </button>
              {snapshot?.dhcpLeases?.length > 0 && (
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {snapshot.dhcpLeases.slice(0, 30).map((l: any) => (
                    <div key={l['.id']} className="text-xs flex gap-2 bg-gray-50 px-2 py-1 rounded font-mono">
                      <span className="font-medium text-gray-800">{l.comment || l.address}</span>
                      <span>{l.address}</span>
                      <span className="text-gray-400">{l['mac-address'] || '—'}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {tab === 'ppp' && (
          <>
            <p className="text-xs text-gray-500">
              Pool (tab DHCP) → perfil PPPoE → servidor PPPoE en interfaz. Luego provisiona abonados con modo PPPoE + Cola.
            </p>

            <section className="rounded-xl border p-4 space-y-3 bg-white">
              <h4 className="font-semibold text-sm">1. Perfil PPPoE (pool remoto + rate-limit)</h4>
              <div className="grid grid-cols-2 gap-2">
                <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Nombre perfil (ej: 20M)"
                  value={forms.profile.name} onChange={e => setForms({ ...forms, profile: { ...forms.profile, name: e.target.value } })} />
                <input className="border rounded-lg px-3 py-2 text-sm font-mono" placeholder="Rate 10M/20M"
                  value={forms.profile.rateLimit} onChange={e => setForms({ ...forms, profile: { ...forms.profile, rateLimit: e.target.value } })} />
                <input className="border rounded-lg px-3 py-2 text-sm font-mono" placeholder="Local address (GW router)"
                  value={forms.profile.localAddress} onChange={e => setForms({ ...forms, profile: { ...forms.profile, localAddress: e.target.value } })} />
                <select className="border rounded-lg px-3 py-2 text-sm bg-white"
                  value={forms.profile.remoteAddress} onChange={e => setForms({ ...forms, profile: { ...forms.profile, remoteAddress: e.target.value } })}>
                  <option value="">Remote pool…</option>
                  {(snapshot?.ipPools || []).map((p: any) => (
                    <option key={p.name} value={p.name}>{p.name} ({p.ranges})</option>
                  ))}
                </select>
              </div>
              {(snapshot?.ipPools || []).length === 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded">Primero crea un pool en la tab DHCP.</p>
              )}
              <button onClick={() => submit('ppp-profiles', {
                name: forms.profile.name,
                localAddress: forms.profile.localAddress,
                remoteAddress: forms.profile.remoteAddress,
                rateLimit: forms.profile.rateLimit,
              }, 'Perfil PPPoE creado')}
                disabled={!forms.profile.name || !forms.profile.remoteAddress}
                className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Crear perfil
              </button>
              {snapshot?.pppProfiles?.length > 0 && (
                <ul className="text-xs space-y-1 mt-2">
                  {snapshot.pppProfiles.map((p: any) => (
                    <li key={p['.id'] || p.name} className="bg-gray-50 px-2 py-1.5 rounded flex justify-between">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-gray-500">{p['local-address'] || ''} → {p['remote-address'] || p['rate-limit'] || ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border p-4 space-y-3 bg-white">
              <h4 className="font-semibold text-sm">2. Servidor PPPoE (escucha en interfaz)</h4>
              <div className="grid grid-cols-2 gap-2">
                <input className="border rounded-lg px-3 py-2 text-sm font-mono" placeholder="Service name"
                  value={forms.pppServer.serviceName}
                  onChange={e => setForms({ ...forms, pppServer: { ...forms.pppServer, serviceName: e.target.value } })} />
                <select className="border rounded-lg px-3 py-2 text-sm bg-white"
                  value={forms.pppServer.interface}
                  onChange={e => setForms({ ...forms, pppServer: { ...forms.pppServer, interface: e.target.value } })}>
                  <option value="">Interfaz…</option>
                  {(snapshot?.interfaces || []).map((i: any) => (
                    <option key={i.name} value={i.name}>{i.name} ({i.type})</option>
                  ))}
                </select>
                <select className="border rounded-lg px-3 py-2 text-sm bg-white col-span-2"
                  value={forms.pppServer.defaultProfile}
                  onChange={e => setForms({ ...forms, pppServer: { ...forms.pppServer, defaultProfile: e.target.value } })}>
                  <option value="">Perfil por defecto…</option>
                  {(snapshot?.pppProfiles || []).map((p: any) => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={forms.pppServer.oneSessionPerHost !== false}
                  onChange={e => setForms({ ...forms, pppServer: { ...forms.pppServer, oneSessionPerHost: e.target.checked } })} />
                Una sesión por host (recomendado WISP)
              </label>
              <button onClick={() => submit('ppp/server', {
                serviceName: forms.pppServer.serviceName,
                interface: forms.pppServer.interface,
                defaultProfile: forms.pppServer.defaultProfile,
                oneSessionPerHost: forms.pppServer.oneSessionPerHost !== false,
                authentication: 'pap,chap,mschap2,mschap1',
              }, 'Servidor PPPoE activo')}
                disabled={!forms.pppServer.serviceName || !forms.pppServer.interface || !forms.pppServer.defaultProfile}
                className="text-sm px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-40 flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Crear / actualizar servidor
              </button>
              {snapshot?.pppoeServers?.length > 0 && (
                <ul className="text-xs space-y-1 mt-2">
                  {snapshot.pppoeServers.map((s: any) => (
                    <li key={s['.id'] || s.interface} className="bg-emerald-50 text-emerald-800 px-2 py-1.5 rounded">
                      <span className="font-medium">{s['service-name']}</span>
                      {' · '}{s.interface}
                      {' · perfil '}{s['default-profile']}
                      {s.disabled === 'true' && ' (deshabilitado)'}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-dashed p-3 bg-gray-50 text-xs text-gray-600 space-y-1">
              <p className="font-medium text-gray-800">3. Abonado (Cliente → Provisionar)</p>
              <p>Modo <strong>PPPoE + Simple Queue</strong> → crea usuario/clave en el router. La antena usa service-name <code className="bg-white px-1 rounded">{forms.pppServer.serviceName || 'internet'}</code>.</p>
            </section>
          </>
        )}

        {tab === 'snmp' && (
          <>
            <p className="text-xs text-gray-500">Polling SNMP v2c — ideal para antenas Ubiquiti, OLTs y switches. Si el equipo está en la LAN del router, el poll se hace vía MikroTik automáticamente.</p>
            <button onClick={pollAllSnmp} disabled={snmpPolling}
              className="text-sm px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2">
              <RefreshCw className={`h-4 w-4 ${snmpPolling ? 'animate-spin' : ''}`} />
              {snmpPolling ? 'Consultando…' : 'Escanear equipos SNMP del ISP'}
            </button>

            {cpeDevices.length > 0 && (
              <section className="space-y-2">
                <h4 className="font-semibold text-sm">Equipos en {routerName}</h4>
                {cpeDevices.map((eq: any) => (
                  <div key={eq.id} className="flex items-center gap-3 border rounded-xl p-3 bg-white">
                    <span className={`w-2.5 h-2.5 rounded-full ${eq.status === 'online' ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{eq.name}</p>
                      <p className="text-xs text-gray-500 font-mono">{eq.ipAddress || 'sin IP'} · community: {eq.hasSnmpCommunity || eq.snmpCommunitySet ? '••••' : '—'}</p>
                      {eq.credentials?.lastSnmp && (
                        <p className="text-xs text-emerald-700 mt-0.5">
                          {eq.credentials.lastSnmp.sysName} · up {eq.credentials.lastSnmp.uptime}
                          {eq.credentials.lastSnmp.pollMethod === 'router' && ' · vía router'}
                        </p>
                      )}
                    </div>
                    <button onClick={() => pollOne(eq.id)} disabled={!eq.ipAddress || !(eq.snmpCommunity || eq.hasSnmpCommunity || eq.snmpCommunitySet)}
                      className="text-xs px-2 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-40">
                      SNMP
                    </button>
                  </div>
                ))}
              </section>
            )}

            {snmpResults.length > 0 && (
              <section className="text-xs space-y-1">
                {snmpResults.map((r: any) => (
                  <div key={r.id} className={`px-2 py-1 rounded ${r.online ? 'bg-green-50' : 'bg-red-50'}`}>
                    {r.name}: {r.skipped ? r.reason : r.error || `${r.sysName} · ${r.uptime}`}
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
