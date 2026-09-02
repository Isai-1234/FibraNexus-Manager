/**
 * FibraNexus — Prototipo interactivo (sin backend).
 * Todo simulado en memoria: CRM, Network, Alerts, pagos Flow, polling.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createInitialState,
  formatDate,
  formatMoney,
  formatTime,
  signalBarColor,
  signalBarWidth,
} from './data';

const TABS = [
  { id: 'crm', label: 'CRM' },
  { id: 'network', label: 'Network' },
  { id: 'alerts', label: 'Alerts' },
];

let alertSeq = 1;

function uid() {
  return alertSeq++;
}

/** Toast top-right */
function Notifications({ items, onDismiss }) {
  if (!items.length) return null;
  return (
    <div className="notifications">
      {items.map((n) => (
        <div key={n.id} className={`toast toast-${n.type}`} onClick={() => onDismiss(n.id)}>
          <strong>{n.title}</strong>
          {n.message && <span>{n.message}</span>}
        </div>
      ))}
    </div>
  );
}

function StatusDot({ estado }) {
  const map = { active: '🟢', online: '🟢', suspended: '🔴', offline: '🔴', unknown: '🟡', pending: '🟡', paid: '🟢' };
  return <span title={estado}>{map[estado] || '⚪'}</span>;
}

export default function App() {
  const initial = useMemo(() => createInitialState(), []);
  const [clients, setClients] = useState(initial.clients);
  const [devices, setDevices] = useState(initial.devices);
  const [invoices, setInvoices] = useState(initial.invoices);
  const [alerts, setAlerts] = useState([
    { id: uid(), type: 'success', message: 'Prototipo iniciado — datos simulados cargados', ts: new Date().toISOString() },
  ]);
  const [toasts, setToasts] = useState([]);
  const [activeTab, setActiveTab] = useState('crm');
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [clientDetailTab, setClientDetailTab] = useState('servicios');
  const [crmSearch, setCrmSearch] = useState('');
  const [paying, setPaying] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [lastSync, setLastSync] = useState(Date.now());
  const [notesDraft, setNotesDraft] = useState('');

  const crmScrollRef = useRef(0);
  const listRef = useRef(null);

  const selectedClient = clients.find((c) => c.id === selectedClientId) || null;
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) || null;

  const syncAgeSec = Math.floor((Date.now() - lastSync) / 1000);
  const syncStale = syncAgeSec > 5;

  const breadcrumbs = useMemo(() => {
    const crumbs = [{ label: 'FibraNexus', action: () => { setSelectedClientId(null); setSelectedDeviceId(null); setActiveTab('crm'); } }];
    if (activeTab === 'crm') {
      crumbs.push({ label: 'CRM', action: () => setSelectedClientId(null) });
      if (selectedClient) crumbs.push({ label: selectedClient.nombre, action: null });
    } else if (activeTab === 'network') {
      crumbs.push({ label: 'Network', action: () => setSelectedDeviceId(null) });
      if (selectedDevice) crumbs.push({ label: selectedDevice.nombre, action: null });
    } else {
      crumbs.push({ label: 'Alerts', action: null });
    }
    return crumbs;
  }, [activeTab, selectedClient, selectedDevice]);

  const pushAlert = useCallback((type, message) => {
    const entry = { id: uid(), type, message, ts: new Date().toISOString() };
    setAlerts((prev) => [entry, ...prev].slice(0, 20));
    return entry;
  }, []);

  const pushToast = useCallback((type, title, message) => {
    const id = uid();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const filteredClients = useMemo(() => {
    const q = crmSearch.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.nombre.toLowerCase().includes(q));
  }, [clients, crmSearch]);

  const clientInvoices = useMemo(() => {
    if (!selectedClientId) return [];
    return invoices
      .filter((i) => i.clientId === selectedClientId)
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .slice(0, 5);
  }, [invoices, selectedClientId]);

  const pendingInvoice = useMemo(() => {
    if (!selectedClientId) return null;
    return invoices.find((i) => i.clientId === selectedClientId && i.estado === 'pending');
  }, [invoices, selectedClientId]);

  const openClient = (id) => {
    if (listRef.current) crmScrollRef.current = listRef.current.scrollTop;
    const cl = clients.find((c) => c.id === id);
    setSelectedClientId(id);
    setClientDetailTab('servicios');
    setNotesDraft(cl?.notas || '');
  };

  const closeClient = () => {
    setSelectedClientId(null);
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = crmScrollRef.current;
    });
  };

  const openDevice = (id) => setSelectedDeviceId(id);
  const closeDevice = () => setSelectedDeviceId(null);

  const handlePay = async () => {
    if (!selectedClient || !pendingInvoice || paying) return;
    setPaying(true);
    const delay = 1000 + Math.random() * 2000;
    await new Promise((r) => setTimeout(r, delay));
    const ok = Math.random() < 0.9;
    if (ok) {
      setInvoices((prev) =>
        prev.map((inv) => (inv.id === pendingInvoice.id ? { ...inv, estado: 'paid' } : inv)),
      );
      setClients((prev) =>
        prev.map((c) =>
          c.id === selectedClient.id ? { ...c, balance: 0, ultimoPago: new Date().toISOString() } : c,
        ),
      );
      pushAlert('success', `Cliente ${selectedClient.nombre} pagó ${formatMoney(pendingInvoice.monto)}`);
      pushToast('success', 'Pago exitoso', `${pendingInvoice.numero} pagada vía Flow (simulado)`);
    } else {
      pushAlert('error', `Tarjeta rechazada — ${selectedClient.nombre}`);
      pushToast('error', 'Tarjeta rechazada', 'Flow simuló un rechazo (10% probabilidad)');
    }
    setPaying(false);
  };

  const handleSuspend = () => {
    if (!selectedClient) return;
    setClients((prev) =>
      prev.map((c) => (c.id === selectedClient.id ? { ...c, estado: 'suspended', servicios: c.servicios.map((s) => ({ ...s, estado: 'suspended' })) } : c)),
    );
    pushAlert('warning', `Cliente ${selectedClient.nombre} suspendido`);
    pushToast('warning', 'Servicio cortado', `${selectedClient.nombre} ahora está suspendido`);
  };

  const handleSaveNotes = () => {
    if (!selectedClient) return;
    setClients((prev) => prev.map((c) => (c.id === selectedClient.id ? { ...c, notas: notesDraft } : c)));
    pushToast('success', 'Notas guardadas', 'Cambio solo en memoria del prototipo');
  };

  const handleReconnect = async () => {
    if (!selectedDevice || reconnecting) return;
    setReconnecting(true);
    await new Promise((r) => setTimeout(r, 1000));
    setDevices((prev) =>
      prev.map((d) =>
        d.id === selectedDevice.id
          ? { ...d, estado: 'online', signal: -45 - (d.id % 30), uptimeHoras: d.uptimeHoras + 1, ultimaConexion: new Date().toISOString() }
          : d,
      ),
    );
    pushAlert('success', `Antena ${selectedDevice.nombre} reconectada`);
    pushToast('success', 'Reconexión OK', `${selectedDevice.nombre} vuelve a online`);
    setReconnecting(false);
  };

  // Polling simulado cada 2s (prototipo; prod 30s)
  useEffect(() => {
    const t = setInterval(() => {
      setLastSync(Date.now());
      const online = devices.filter((d) => d.estado === 'online').length;
      const offline = devices.filter((d) => d.estado === 'offline').length;
      const ts = new Date().toLocaleTimeString('es-CL');
      console.log(`[POLLING] online: ${online}, offline: ${offline}, timestamp: ${ts}`);
    }, 2000);
    return () => clearInterval(t);
  }, [devices]);

  // Simulación automática cada 30s — random device cambia estado
  useEffect(() => {
    const t = setInterval(() => {
      setDevices((prev) => {
        const idx = Math.floor(Math.random() * prev.length);
        const dev = prev[idx];
        const nextEstado = dev.estado === 'online' ? 'offline' : 'online';
        const updated = prev.map((d, i) =>
          i === idx
            ? {
                ...d,
                estado: nextEstado,
                signal: nextEstado === 'online' ? -40 - (idx % 50) : -98,
                ultimaConexion: new Date().toISOString(),
              }
            : d,
        );
        const msg = nextEstado === 'offline'
          ? `Antena ${dev.nombre} offline`
          : `Antena ${dev.nombre} online`;
        pushAlert(nextEstado === 'offline' ? 'error' : 'success', msg);
        return updated;
      });
      setLastSync(Date.now());
    }, 30000);
    return () => clearInterval(t);
  }, [pushAlert]);

  const onlineCount = devices.filter((d) => d.estado === 'online').length;
  const offlineCount = devices.filter((d) => d.estado === 'offline').length;

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <span className="logo">FibraNexus</span>
          <span className="badge-proto">PROTOTIPO</span>
        </div>
        <div className="header-right">
          <span className={`sync ${syncStale ? 'sync-stale' : ''}`}>
            Sincronizado hace {syncAgeSec} seg
          </span>
          <span className="user">Isai</span>
          <button type="button" className="btn-ghost" onClick={() => pushToast('warning', 'Sesión', 'Logout simulado — recarga para reiniciar')}>
            Cerrar sesión
          </button>
        </div>
      </header>

      <Notifications items={toasts} onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />

      <div className="body">
        <aside className="sidebar">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`sidebar-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(tab.id);
                setSelectedClientId(null);
                setSelectedDeviceId(null);
              }}
            >
              {tab.label}
              {tab.id === 'alerts' && alerts.length > 0 && (
                <span className="sidebar-badge">{Math.min(alerts.length, 20)}</span>
              )}
            </button>
          ))}
          <div className="sidebar-stats">
            <p>Clientes: {clients.length}</p>
            <p>Online: {onlineCount} / Offline: {offlineCount}</p>
          </div>
        </aside>

        <main className="main">
          <nav className="breadcrumbs">
            {breadcrumbs.map((c, i) => (
              <span key={i}>
                {i > 0 && <span className="bc-sep"> › </span>}
                {c.action ? (
                  <button type="button" className="bc-link" onClick={c.action}>{c.label}</button>
                ) : (
                  <span className="bc-current">{c.label}</span>
                )}
              </span>
            ))}
          </nav>

          {/* ─── CRM ─── */}
          {activeTab === 'crm' && !selectedClient && (
            <section className="panel">
              <div className="panel-head">
                <h2>CRM — Abonados</h2>
                <input
                  className="search"
                  placeholder="Buscar por nombre…"
                  value={crmSearch}
                  onChange={(e) => setCrmSearch(e.target.value)}
                />
              </div>
              <div className="table-wrap" ref={listRef}>
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Plan</th>
                      <th>Estado</th>
                      <th>Balance</th>
                      <th>Último pago</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredClients.map((c) => (
                      <tr key={c.id} className={c.estado === 'suspended' ? 'row-suspended' : ''}>
                        <td>{c.nombre}</td>
                        <td>{c.plan}</td>
                        <td><StatusDot estado={c.estado} /> {c.estado === 'active' ? 'Active' : 'Suspended'}</td>
                        <td>{formatMoney(c.balance)}</td>
                        <td>{formatDate(c.ultimoPago)}</td>
                        <td>
                          <button type="button" className="btn-sm" onClick={() => openClient(c.id)}>Ver</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === 'crm' && selectedClient && (
            <section className="panel detail-panel">
              <div className="detail-head">
                <button type="button" className="btn-back" onClick={closeClient}>← Volver</button>
                <div>
                  <h2>{selectedClient.nombre}</h2>
                  <p className="muted">{selectedClient.plan} · <StatusDot estado={selectedClient.estado} /> {selectedClient.estado}</p>
                </div>
                <button type="button" className="btn-danger" onClick={handleSuspend} disabled={selectedClient.estado === 'suspended'}>
                  Cortar
                </button>
              </div>

              <div className="detail-tabs">
                {['servicios', 'facturas', 'notas', 'pagar'].map((t) => (
                  <button key={t} type="button" className={clientDetailTab === t ? 'dt-active' : ''} onClick={() => setClientDetailTab(t)}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {clientDetailTab === 'servicios' && (
                <ul className="card-list">
                  {selectedClient.servicios.map((s) => (
                    <li key={s.id} className="card">
                      <strong>{s.nombre}</strong>
                      <span>IP {s.ip}</span>
                      <span><StatusDot estado={s.estado} /> {s.estado}</span>
                    </li>
                  ))}
                </ul>
              )}

              {clientDetailTab === 'facturas' && (
                <table className="mini-table">
                  <thead><tr><th>Nº</th><th>Fecha</th><th>Monto</th><th>Estado</th></tr></thead>
                  <tbody>
                    {clientInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td>{inv.numero}</td>
                        <td>{formatDate(inv.fecha)}</td>
                        <td>{formatMoney(inv.monto)}</td>
                        <td><StatusDot estado={inv.estado} /> {inv.estado}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {clientDetailTab === 'notas' && (
                <div className="notes-box">
                  <textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} rows={6} placeholder="Notas internas del abonado…" />
                  <button type="button" className="btn-primary" onClick={handleSaveNotes}>Guardar notas</button>
                </div>
              )}

              {clientDetailTab === 'pagar' && (
                <div className="pay-box">
                  {pendingInvoice ? (
                    <>
                      <p>Factura pendiente: <strong>{pendingInvoice.numero}</strong></p>
                      <p className="pay-amount">{formatMoney(pendingInvoice.monto)}</p>
                      <button type="button" className="btn-primary btn-lg" disabled={paying} onClick={handlePay}>
                        {paying ? 'Pagando…' : 'Pagar con Flow (simulado)'}
                      </button>
                      <p className="muted">90% éxito · 10% tarjeta rechazada · delay 1–3s</p>
                    </>
                  ) : (
                    <p className="muted">Sin facturas pendientes para este cliente.</p>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ─── NETWORK ─── */}
          {activeTab === 'network' && !selectedDevice && (
            <section className="panel">
              <div className="panel-head">
                <h2>Network — Dispositivos ({devices.length})</h2>
                <span className="muted">Auto-poll cada 30s · consola cada 2s</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Estado</th>
                      <th>Signal</th>
                      <th>Uptime (h)</th>
                      <th>Última conexión</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((d) => (
                      <tr key={d.id}>
                        <td>{d.nombre}</td>
                        <td><StatusDot estado={d.estado} /> {d.estado}</td>
                        <td>
                          <div className="signal-cell">
                            <div className="signal-bar-bg">
                              <div className="signal-bar-fill" style={{ width: `${signalBarWidth(d.signal)}%`, background: signalBarColor(d.signal) }} />
                            </div>
                            <span>{d.signal != null ? `${d.signal} dBm` : '—'}</span>
                          </div>
                        </td>
                        <td>{d.uptimeHoras}</td>
                        <td>{formatDate(d.ultimaConexion)}</td>
                        <td><button type="button" className="btn-sm" onClick={() => openDevice(d.id)}>Ver</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === 'network' && selectedDevice && (
            <section className="panel detail-panel">
              <div className="detail-head">
                <button type="button" className="btn-back" onClick={closeDevice}>← Volver</button>
                <div>
                  <h2>{selectedDevice.nombre}</h2>
                  <p className="muted">MAC {selectedDevice.mac} · <StatusDot estado={selectedDevice.estado} /> {selectedDevice.estado}</p>
                </div>
                <button type="button" className="btn-primary" disabled={reconnecting} onClick={handleReconnect}>
                  {reconnecting ? 'Reconectando…' : 'Reconectar'}
                </button>
              </div>

              <div className="device-meta">
                <div><label>Signal</label><strong>{selectedDevice.signal ?? '—'} dBm</strong></div>
                <div><label>Uptime</label><strong>{selectedDevice.uptimeHoras} h</strong></div>
                <div><label>Última conexión</label><strong>{formatDate(selectedDevice.ultimaConexion)}</strong></div>
                <div><label>Clientes en antena</label><strong>{selectedDevice.connectedClientIds.length}</strong></div>
              </div>

              <h3>Abonados en esta antena</h3>
              <table className="mini-table">
                <thead><tr><th>Nombre</th><th>Plan</th><th>Estado</th></tr></thead>
                <tbody>
                  {selectedDevice.connectedClientIds.map((cid) => {
                    const cl = clients.find((c) => c.id === cid);
                    if (!cl) return null;
                    return (
                      <tr key={cid}>
                        <td>{cl.nombre}</td>
                        <td>{cl.plan}</td>
                        <td><StatusDot estado={cl.estado} /> {cl.estado}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {/* ─── ALERTS ─── */}
          {activeTab === 'alerts' && (
            <section className="panel">
              <div className="panel-head"><h2>Alerts — últimos 20 eventos</h2></div>
              <ul className="alerts-list">
                {alerts.slice(0, 20).map((a) => (
                  <li key={a.id} className={`alert-item alert-${a.type}`}>
                    <span className="alert-time">{formatTime(a.ts)}</span>
                    <span>{a.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
