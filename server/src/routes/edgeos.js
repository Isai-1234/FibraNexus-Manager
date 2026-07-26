import { Router } from 'express';
import { db } from '../db/index.js';
import { equipment, clientServices, clients, plans, users } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId } from '../lib/tenant.js';
import {
  buildNetworkScript,
  buildDeleteNetworkScript,
  buildAddQueueScript,
  buildRemoveQueueScript,
  makePendingCmd,
  parseCidr,
} from '../lib/edgeosCommands.js';
import { edgeosLogin, edgeosDataGet, getRouterCredentials, resolveHost, resolvePort } from '../lib/edgeosClient.js';
import { mikrotikRequest } from '../lib/mikrotikClient.js';
import { appendPendingCmd } from '../lib/edgeosPending.js';

// Caché de sesiones EdgeOS en memoria (evita login por cada poll)
const sessionCache = new Map(); // routerId → { cookie, csrfToken, host, port, createdAt }

async function getEdgeosSession(router, { timeout = 10000 } = {}) {
  const host = resolveHost(router);
  const port = resolvePort(router);
  if (!host) throw new Error('Router sin host configurado (tunnelHostname o ipAddress)');
  const cached = sessionCache.get(router.id);
  if (cached && cached.host === host && Date.now() - cached.createdAt < 18 * 60 * 1000) {
    return cached;
  }
  console.log(`[EdgeOS] login sesión → host=${host} port=${port}`);
  const { user, pass } = getRouterCredentials(router);
  const { cookie, csrfToken } = await edgeosLogin({ host, port, user, pass, timeout });
  const session = { cookie, csrfToken, host, port, createdAt: Date.now() };
  sessionCache.set(router.id, session);
  return session;
}

export const edgeosRouter = Router();

async function getEdgeRouter(routerId, orgId) {
  const [router] = await db.select().from(equipment).where(
    and(eq(equipment.id, routerId), orgFilter(equipment, orgId)),
  ).limit(1);
  return router || null;
}

// appendPendingCmd importado desde lib/edgeosPending.js

// GET /api/edgeos/:routerId/bandwidth — ancho de banda en tiempo real
// Fuente 1: heartbeat (siempre disponible, ~28s de resolución) — prioridad si es fresco (<35s)
// Fuente 2: RouterOS REST API para MikroTik (calcula BPS desde bytes acumulados)
// Fuente 3: EdgeOS API directa con timeout corto (2s) como último recurso
edgeosRouter.get('/:routerId/bandwidth', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const router = await getEdgeRouter(parseInt(req.params.routerId), orgId);
    if (!router) return res.status(404).json({ error: 'Router no encontrado' });

    const creds = router.credentials || {};
    const routerType = String(creds.routerType || '');
    const brandModel = `${router.brand || ''} ${router.model || ''} ${router.name || ''}`;
    const isMikrotik = routerType.startsWith('mikrotik')
      || /mikrotik|routeros|l009|rb\d|ccr|crs/i.test(brandModel)
      || Boolean(creds.routerUser && (creds.apiPort || creds.routerPass));
    const isEdgeRouter = routerType.startsWith('edgerouter')
      || (router.brand || '').toLowerCase() === 'ubiquiti'
      || /edgerouter|edgeos/i.test(brandModel);

    // Conectado si: heartbeat reciente, status online reciente, o MikroTik con API lista para consultar
    const isConnected = Boolean(
      (creds.lastHeartbeat && Date.now() - new Date(creds.lastHeartbeat).getTime() < 120_000)
      || (router.status === 'online' && router.lastSeen
        && Date.now() - new Date(router.lastSeen).getTime() < 300_000)
      || (router.status === 'online' && isMikrotik && creds.routerUser && creds.routerPass)
      || (isEdgeRouter && creds.lastHeartbeat),
    );
    if (!isConnected) return res.json({ connected: false, interfaces: [] });

    // WAN filtering: solo si está configurada explícitamente en credentials.wanInterface
    const wanIface = creds.wanInterface || null;

    // --- Fuente 1: datos del heartbeat (bandwidthSamples) ---
    const latestSample = (creds.bandwidthSamples || []).slice(-1)[0];
    const heartbeatAge = latestSample ? Date.now() - latestSample.ts : Infinity;
    const heartbeatIfaces = latestSample?.ifaces
      ? latestSample.ifaces
          .filter(i => {
            if (!i.iface || i.iface === 'lo') return false;
            return wanIface ? i.iface === wanIface : true;
          })
          .map(i => ({ iface: i.iface, up: true, rxBps: Math.max(0, i.rxBps || 0), txBps: Math.max(0, i.txBps || 0), rxBytes: 0, txBytes: 0 }))
      : null;

    // Heartbeat fresco (<35s) → respuesta inmediata, sin tocar la API del router
    if (heartbeatIfaces && heartbeatAge < 35_000) {
      return res.json({ connected: true, ts: Date.now(), interfaces: heartbeatIfaces, source: 'heartbeat' });
    }

    // --- Fuente 2: RouterOS REST API para MikroTik ---
    if (isMikrotik && creds.routerUser && creds.routerPass) {
      try {
        const now = Date.now();
        let resultIfaces = null;

        // Intento A: monitor-traffic — tasas instantáneas del hardware (respeta FastTrack/offloading)
        try {
          const monitorRaw = await mikrotikRequest(router, 'POST', '/interface/monitor-traffic', {
            interface: 'all', duration: '1', once: '',
          });
          const monItems = Array.isArray(monitorRaw) ? monitorRaw : [];
          if (monItems.length > 0 && 'rx-bits-per-second' in (monItems[0] || {})) {
            resultIfaces = monItems
              .filter(i => i.name && i.name !== 'lo')
              .map(i => ({
                iface: i.name,
                rxBps: Math.round(Number(i['rx-bits-per-second'] || 0) / 8),
                txBps: Math.round(Number(i['tx-bits-per-second'] || 0) / 8),
                rxRaw: null, txRaw: null, up: true,
              }));
            console.log(`[Bandwidth] MikroTik monitor-traffic OK: ${resultIfaces.length} ifaces`);
          }
        } catch (monErr) {
          console.log(`[Bandwidth] monitor-traffic: ${monErr.message.slice(0, 60)} — usando delta`);
        }

        // Intento B: delta de contadores acumulados (fallback para RouterOS sin monitor-traffic)
        if (!resultIfaces) {
          const rawIfaces = await mikrotikRequest(router, 'GET', '/interface');
          const dtSec = latestSample ? Math.max(1, (now - latestSample.ts) / 1000) : 30;

          const newIfaces = (Array.isArray(rawIfaces) ? rawIfaces : [])
            .filter(i => i.name && i.name !== 'lo' && i.type !== 'bridge')
            .map(i => {
              const rx = Number(i['rx-byte']) || 0;
              const tx = Number(i['tx-byte']) || 0;
              const prev = (latestSample?.ifaces || []).find(p => p.iface === i.name);
              const rxBps = (prev && prev.rxRaw != null) ? Math.max(0, Math.round((rx - prev.rxRaw) / dtSec)) : 0;
              const txBps = (prev && prev.txRaw != null) ? Math.max(0, Math.round((tx - prev.txRaw) / dtSec)) : 0;
              return { iface: i.name, rxBps, txBps, rxRaw: rx, txRaw: tx, up: i.running !== false && i.running !== 'false' };
            });

          const newSample = { ts: now, ifaces: newIfaces };
          db.update(equipment)
            .set({ credentials: { ...creds, bandwidthSamples: [...(creds.bandwidthSamples || []).slice(-59), newSample] } })
            .where(eq(equipment.id, router.id)).catch(() => {});

          resultIfaces = newIfaces;
        }

        const result = (resultIfaces || [])
          .filter(i => wanIface ? i.iface === wanIface : i.iface !== 'lo')
          .map(({ iface, rxBps, txBps, up }) => ({ iface, rxBps, txBps, rxBytes: 0, txBytes: 0, up }));

        return res.json({ connected: true, ts: now, interfaces: result, source: 'api' });
      } catch (mikErr) {
        console.log(`[Bandwidth] MikroTik API no disponible (${mikErr.message.slice(0, 60)}) — usando heartbeat`);
      }
    }

    // --- Fuente 3: EdgeOS API directa con timeout corto para no bloquear ---
    if (isEdgeRouter) {
      try {
        const session = await getEdgeosSession(router, { timeout: 2000 });
        const data = await edgeosDataGet({ ...session, dataPath: 'interfaces', timeout: 2000 });
        const raw = data?.data?.interfaces || data?.GET?.interfaces || data?.interfaces || {};
        if (Object.keys(raw).length > 0) {
          const apiIfaces = Object.entries(raw).map(([name, info]) => {
            const stats = info?.stats || info?.stat || {};
            return {
              iface: name, up: info?.up ?? info?.l1up ?? true,
              rxBps: Math.round(Number(stats.rx_bps) || 0),
              txBps: Math.round(Number(stats.tx_bps) || 0),
              rxBytes: Number(stats.rx_bytes) || 0,
              txBytes: Number(stats.tx_bytes) || 0,
            };
          }).filter(i => {
            if (i.iface === 'lo') return false;
            return wanIface ? i.iface === wanIface : true;
          });
          if (apiIfaces.length > 0) {
            console.log(`[EdgeOS] bandwidth via API: ${apiIfaces.length} ifaces (filtro WAN: ${wanIface || 'ninguno'})`);
            return res.json({ connected: true, ts: Date.now(), interfaces: apiIfaces, source: 'api' });
          }
        }
      } catch (apiErr) {
        console.log(`[EdgeOS] bandwidth API no disponible (${apiErr.message.slice(0, 60)}) — usando heartbeat`);
        sessionCache.delete(parseInt(req.params.routerId));
      }
    }

    res.json({ connected: true, ts: Date.now(), interfaces: heartbeatIfaces || [], source: heartbeatIfaces ? 'heartbeat' : 'none' });
  } catch (err) {
    console.error(`[EdgeOS] bandwidth ERROR router=${req.params.routerId}: ${err.message}`);
    res.json({ connected: false, error: err.message, interfaces: [] });
  }
});

// GET /api/edgeos/:routerId/status
edgeosRouter.get('/:routerId/status', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const router = await getEdgeRouter(parseInt(req.params.routerId), orgId);
    if (!router) return res.status(404).json({ error: 'Router no encontrado' });

    const creds = router.credentials || {};
    const isConnected = creds.lastHeartbeat
      ? Date.now() - new Date(creds.lastHeartbeat).getTime() < 120_000
      : false;

    res.json({
      routerId: router.id,
      routerName: router.name,
      connected: isConnected,
      lastHeartbeat: creds.lastHeartbeat || null,
      lanInterface: creds.lanInterface || 'eth2',
      networks: creds.edgeosNetworks || [],
      pendingCmds: (creds.pendingCmds || []).map(c => ({
        id: c.id, type: c.type, status: c.status, meta: c.meta, createdAt: c.createdAt,
        retries: c.retries || 0, maxRetries: c.maxRetries || 3, nextRetryAt: c.nextRetryAt || null,
      })),
      cmdHistory: (creds.cmdHistory || []).slice(-20).reverse(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/edgeos/:routerId/network — crear interfaz + DHCP
edgeosRouter.post('/:routerId/network', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    if (!req.body?.confirm) {
      return res.status(400).json({ error: 'Confirma la acción remota enviando confirm=true', requiresConfirm: true });
    }
    const routerId = parseInt(req.params.routerId);
    const router = await getEdgeRouter(routerId, orgId);
    if (!router) return res.status(404).json({ error: 'Router no encontrado' });

    const { iface, ipCidr, description = '', dhcp = true, poolStart, poolEnd, dnsServers } = req.body;
    if (!iface || !ipCidr) return res.status(400).json({ error: 'iface e ipCidr son obligatorios' });

    let net;
    try { net = parseCidr(ipCidr); } catch { return res.status(400).json({ error: 'IP/CIDR inválido (ej: 192.168.100.1/24)' }); }

    const script = buildNetworkScript({ iface, ipCidr, description, dhcp, poolStart, poolEnd, dnsServers });
    const cmd = makePendingCmd('network_create', script, { iface, ipCidr, description, dhcp });

    const creds = router.credentials || {};
    const updatedNetworks = [
      ...(creds.edgeosNetworks || []).filter(n => n.iface !== iface),
      { iface, ipCidr, subnet: net.subnet, description, dhcp, poolStart: poolStart || net.poolStart, poolEnd: poolEnd || net.poolEnd, addedAt: new Date().toISOString() },
    ];

    await appendPendingCmd(routerId, cmd, { edgeosNetworks: updatedNetworks }, {
      organizationId: orgId,
      userId: req.user.id,
      confirmed: true,
      ipAddress: req.ip,
    });
    res.json({ cmd: { id: cmd.id, type: cmd.type }, message: 'Comando encolado — EdgeRouter aplicará en ≤30 s' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/edgeos/:routerId/network/:iface
edgeosRouter.delete('/:routerId/network/:iface', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    if (!req.body?.confirm && req.query.confirm !== 'true') {
      return res.status(400).json({ error: 'Confirma la eliminación remota con confirm=true', requiresConfirm: true });
    }
    const routerId = parseInt(req.params.routerId);
    const router = await getEdgeRouter(routerId, orgId);
    if (!router) return res.status(404).json({ error: 'Router no encontrado' });

    const iface = req.params.iface;
    const script = buildDeleteNetworkScript({ iface });
    const cmd = makePendingCmd('network_delete', script, { iface });

    const creds = router.credentials || {};
    const updatedNetworks = (creds.edgeosNetworks || []).filter(n => n.iface !== iface);
    await appendPendingCmd(routerId, cmd, { edgeosNetworks: updatedNetworks }, {
      organizationId: orgId,
      userId: req.user.id,
      confirmed: true,
      ipAddress: req.ip,
    });
    res.json({ cmd: { id: cmd.id, type: cmd.type }, message: 'Eliminación encolada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/edgeos/:routerId/subscribers — lista abonados con su estado de queue
edgeosRouter.get('/:routerId/subscribers', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const routerId = parseInt(req.params.routerId);
    const router = await getEdgeRouter(routerId, orgId);
    if (!router) return res.status(404).json({ error: 'Router no encontrado' });

    const rows = await db.select({
      serviceId: clientServices.id,
      status: clientServices.status,
      ipAddress: clientServices.ipAddress,
      networkMeta: clientServices.networkMeta,
      fullName: users.fullName,
      planName: plans.name,
      downloadSpeed: plans.downloadSpeed,
      uploadSpeed: plans.uploadSpeed,
    }).from(clientServices)
      .innerJoin(clients, eq(clientServices.clientId, clients.id))
      .innerJoin(users, eq(clients.userId, users.id))
      .innerJoin(plans, eq(clientServices.planId, plans.id))
      .where(eq(clientServices.routerId, routerId));

    res.json(rows.map(r => ({
      serviceId: r.serviceId,
      fullName: r.fullName,
      ipAddress: r.ipAddress,
      planName: r.planName,
      downloadSpeed: r.downloadSpeed,
      uploadSpeed: r.uploadSpeed,
      serviceStatus: r.status,
      edgeosQueue: r.networkMeta?.edgeosQueue || null,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/edgeos/:routerId/provision/:serviceId — crear queue para un abonado
edgeosRouter.post('/:routerId/provision/:serviceId', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    if (!req.body?.confirm) {
      return res.status(400).json({ error: 'Confirma el aprovisionamiento remoto con confirm=true', requiresConfirm: true });
    }
    const routerId = parseInt(req.params.routerId);
    const serviceId = parseInt(req.params.serviceId);
    const router = await getEdgeRouter(routerId, orgId);
    if (!router) return res.status(404).json({ error: 'Router no encontrado' });

    const rows = await db.select({
      service: clientServices,
      fullName: users.fullName,
      downloadSpeed: plans.downloadSpeed,
      uploadSpeed: plans.uploadSpeed,
      planName: plans.name,
    }).from(clientServices)
      .innerJoin(clients, eq(clientServices.clientId, clients.id))
      .innerJoin(users, eq(clients.userId, users.id))
      .innerJoin(plans, eq(clientServices.planId, plans.id))
      .where(eq(clientServices.id, serviceId))
      .limit(1);

    if (!rows.length) return res.status(404).json({ error: 'Servicio no encontrado' });
    const { service, fullName, downloadSpeed, uploadSpeed } = rows[0];
    if (!service.ipAddress) return res.status(400).json({ error: 'El servicio no tiene IP asignada — asígnale una IP antes de provisionar' });

    const iface = req.body.iface || router.credentials?.lanInterface || 'eth2';
    const classId = (Math.abs(serviceId) % 4090) + 2;

    const script = buildAddQueueScript({ iface, serviceId, clientIp: service.ipAddress, downloadMbps: downloadSpeed, uploadMbps: uploadSpeed, clientName: fullName });
    const cmd = makePendingCmd('queue_add', script, { serviceId, clientIp: service.ipAddress, iface, downloadMbps: downloadSpeed, uploadMbps: uploadSpeed });

    await appendPendingCmd(routerId, cmd, {}, {
      organizationId: orgId,
      userId: req.user.id,
      confirmed: true,
      ipAddress: req.ip,
    });

    const meta = {
      ...(service.networkMeta || {}),
      edgeosQueue: { cmdId: cmd.id, classId, iface, routerId, status: 'pending', queuedAt: new Date().toISOString() },
    };
    await db.update(clientServices).set({ networkMeta: meta, updatedAt: new Date() }).where(eq(clientServices.id, serviceId));

    res.json({ cmd: { id: cmd.id, classId, status: 'pending' }, message: `Queue encolada — EdgeRouter aplicará en ≤30 s` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/edgeos/:routerId/queue — cancelar todos los comandos pendientes
edgeosRouter.delete('/:routerId/queue', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const routerId = parseInt(req.params.routerId);
    const router = await getEdgeRouter(routerId, orgId);
    if (!router) return res.status(404).json({ error: 'Router no encontrado' });

    const creds = router.credentials || {};
    const pending = creds.pendingCmds || [];
    const now = new Date().toISOString();
    const cancelled = pending.map(c => ({ ...c, status: 'cancelled', cancelledAt: now }));
    const history = [...(creds.cmdHistory || []), ...cancelled].slice(-50);

    await db.update(equipment).set({
      credentials: { ...creds, pendingCmds: [], cmdHistory: history },
      updatedAt: new Date(),
    }).where(eq(equipment.id, routerId));

    console.log(`[EdgeOS] QUEUE CLEARED router=${routerId} cancelled=${cancelled.length}`);
    res.json({ cancelled: cancelled.length, message: 'Cola vaciada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/edgeos/:routerId/queue/:cmdId — cancelar un comando pendiente
edgeosRouter.delete('/:routerId/queue/:cmdId', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const routerId = parseInt(req.params.routerId);
    const router = await getEdgeRouter(routerId, orgId);
    if (!router) return res.status(404).json({ error: 'Router no encontrado' });

    const { cmdId } = req.params;
    const creds = router.credentials || {};
    const pending = creds.pendingCmds || [];
    const target = pending.find(c => c.id === cmdId);
    if (!target) return res.status(404).json({ error: 'Comando no encontrado en la cola' });

    const remaining = pending.filter(c => c.id !== cmdId);
    const cancelled = { ...target, status: 'cancelled', cancelledAt: new Date().toISOString() };
    const history = [...(creds.cmdHistory || []), cancelled].slice(-50);

    await db.update(equipment).set({
      credentials: { ...creds, pendingCmds: remaining, cmdHistory: history },
      updatedAt: new Date(),
    }).where(eq(equipment.id, routerId));

    console.log(`[EdgeOS] CMD CANCELLED router=${routerId} id=${cmdId} type=${target.type}`);
    res.json({ cancelled: cmdId, message: 'Comando cancelado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/edgeos/:routerId/provision/:serviceId — eliminar queue de un abonado
edgeosRouter.delete('/:routerId/provision/:serviceId', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    if (!req.body?.confirm && req.query.confirm !== 'true') {
      return res.status(400).json({ error: 'Confirma el retiro remoto con confirm=true', requiresConfirm: true });
    }
    const routerId = parseInt(req.params.routerId);
    const serviceId = parseInt(req.params.serviceId);
    const router = await getEdgeRouter(routerId, orgId);
    if (!router) return res.status(404).json({ error: 'Router no encontrado' });

    const [svc] = await db.select().from(clientServices).where(eq(clientServices.id, serviceId)).limit(1);
    if (!svc) return res.status(404).json({ error: 'Servicio no encontrado' });

    const iface = svc.networkMeta?.edgeosQueue?.iface || router.credentials?.lanInterface || 'eth2';
    const script = buildRemoveQueueScript({ iface, serviceId });
    const cmd = makePendingCmd('queue_remove', script, { serviceId, iface });

    await appendPendingCmd(routerId, cmd, {}, {
      organizationId: orgId,
      userId: req.user.id,
      confirmed: true,
      ipAddress: req.ip,
    });

    const meta = { ...(svc.networkMeta || {}), edgeosQueue: null };
    await db.update(clientServices).set({ networkMeta: meta, updatedAt: new Date() }).where(eq(clientServices.id, serviceId));

    res.json({ cmd: { id: cmd.id, status: 'pending' }, message: 'Eliminación de queue encolada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
