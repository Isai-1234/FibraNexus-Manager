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

async function appendPendingCmd(routerId, cmd, extraCredFields = {}) {
  const [current] = await db.select().from(equipment).where(eq(equipment.id, routerId)).limit(1);
  if (!current) throw new Error('Router no encontrado');
  const creds = current.credentials || {};
  const pending = [...(creds.pendingCmds || []), cmd];
  console.log(`[EdgeOS] CMD ENCOLADO router=${routerId} id=${cmd.id} type=${cmd.type} total_cola=${pending.length}`);
  await db.update(equipment).set({
    credentials: { ...creds, pendingCmds: pending, ...extraCredFields },
    updatedAt: new Date(),
  }).where(eq(equipment.id, routerId));
  return cmd;
}

// GET /api/edgeos/:routerId/bandwidth — ancho de banda en tiempo real
// Fuente 1: heartbeat (siempre disponible, ~28s de resolución)
// Fuente 2: API EdgeOS directa (requiere túnel Cloudflare al EdgeRouter, 5s timeout)
edgeosRouter.get('/:routerId/bandwidth', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const router = await getEdgeRouter(parseInt(req.params.routerId), orgId);
    if (!router) return res.status(404).json({ error: 'Router no encontrado' });

    const creds = router.credentials || {};
    const isConnected = creds.lastHeartbeat
      ? Date.now() - new Date(creds.lastHeartbeat).getTime() < 120_000
      : false;
    if (!isConnected) return res.json({ connected: false, interfaces: [] });

    // --- Fuente 1: datos del heartbeat (bandwidthSamples) ---
    const latestSample = (creds.bandwidthSamples || []).slice(-1)[0];
    const heartbeatIfaces = latestSample?.ifaces
      ? latestSample.ifaces
          .filter(i => i.iface && i.iface !== 'lo')
          .map(i => ({ iface: i.iface, up: true, rxBps: Math.max(0, i.rxBps || 0), txBps: Math.max(0, i.txBps || 0), rxBytes: 0, txBytes: 0 }))
      : null;

    // --- Fuente 2: API EdgeOS directa (opcional, falla silenciosa) ---
    let apiIfaces = null;
    try {
      const session = await getEdgeosSession(router, { timeout: 5000 });
      const data = await edgeosDataGet({ ...session, dataPath: 'interfaces', timeout: 5000 });
      const raw = data?.data?.interfaces || data?.GET?.interfaces || data?.interfaces || {};
      if (Object.keys(raw).length > 0) {
        apiIfaces = Object.entries(raw).map(([name, info]) => {
          const stats = info?.stats || info?.stat || {};
          return {
            iface: name, up: info?.up ?? info?.l1up ?? true,
            rxBps: Math.round(Number(stats.rx_bps) || 0),
            txBps: Math.round(Number(stats.tx_bps) || 0),
            rxBytes: Number(stats.rx_bytes) || 0,
            txBytes: Number(stats.tx_bytes) || 0,
          };
        }).filter(i => i.iface !== 'lo');
        console.log(`[EdgeOS] bandwidth via API: ${apiIfaces.length} ifaces`);
      }
    } catch (apiErr) {
      // La API EdgeOS no está accesible vía túnel — usar heartbeat como fallback
      console.log(`[EdgeOS] bandwidth API no disponible (${apiErr.message.slice(0, 60)}) — usando heartbeat`);
      sessionCache.delete(parseInt(req.params.routerId));
    }

    // [] es truthy en JS — usar length para decidir qué fuente es válida
    const useApi = Array.isArray(apiIfaces) && apiIfaces.length > 0;
    const interfaces = useApi ? apiIfaces : (heartbeatIfaces || []);
    const source = useApi ? 'api' : (heartbeatIfaces ? 'heartbeat' : 'none');

    res.json({ connected: true, ts: Date.now(), interfaces, source });
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

    await appendPendingCmd(routerId, cmd, { edgeosNetworks: updatedNetworks });
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
    const routerId = parseInt(req.params.routerId);
    const router = await getEdgeRouter(routerId, orgId);
    if (!router) return res.status(404).json({ error: 'Router no encontrado' });

    const iface = req.params.iface;
    const script = buildDeleteNetworkScript({ iface });
    const cmd = makePendingCmd('network_delete', script, { iface });

    const creds = router.credentials || {};
    const updatedNetworks = (creds.edgeosNetworks || []).filter(n => n.iface !== iface);
    await appendPendingCmd(routerId, cmd, { edgeosNetworks: updatedNetworks });
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

    await appendPendingCmd(routerId, cmd);

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
    const routerId = parseInt(req.params.routerId);
    const serviceId = parseInt(req.params.serviceId);
    const router = await getEdgeRouter(routerId, orgId);
    if (!router) return res.status(404).json({ error: 'Router no encontrado' });

    const [svc] = await db.select().from(clientServices).where(eq(clientServices.id, serviceId)).limit(1);
    if (!svc) return res.status(404).json({ error: 'Servicio no encontrado' });

    const iface = svc.networkMeta?.edgeosQueue?.iface || router.credentials?.lanInterface || 'eth2';
    const script = buildRemoveQueueScript({ iface, serviceId });
    const cmd = makePendingCmd('queue_remove', script, { serviceId, iface });

    await appendPendingCmd(routerId, cmd);

    const meta = { ...(svc.networkMeta || {}), edgeosQueue: null };
    await db.update(clientServices).set({ networkMeta: meta, updatedAt: new Date() }).where(eq(clientServices.id, serviceId));

    res.json({ cmd: { id: cmd.id, status: 'pending' }, message: 'Eliminación de queue encolada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
