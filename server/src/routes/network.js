import { Router } from 'express';
import { db } from '../db/index.js';
import { equipment } from '../db/schema.js';
import { and, eq, ne } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId } from '../lib/tenant.js';
import { loadRouter } from '../lib/networkProvision.js';
import {
  getRouterNetworkSnapshot,
  createIpPool,
  createDhcpNetwork,
  createDhcpServer,
  upsertDhcpStaticLease,
  createPppProfile,
  listPppProfiles,
  upsertPppoeServer,
  listPppoeServers,
  listDhcpLeases,
} from '../lib/mikrotikNetwork.js';
import { listPppoeActive } from '../lib/mikrotikClient.js';
import { pollEquipmentList } from '../lib/snmpPoller.js';
import { persistPollResult } from '../lib/equipmentStatus.js';
import { dispatch, JobNames } from '../lib/jobs/queue.js';
import { findNextFreeIpForSite, resolveMacForIp } from '../lib/ipAllocation.js';

export const networkRouter = Router();

async function getRouterOr404(routerId, orgId, res) {
  const router = await loadRouter(parseInt(routerId, 10), orgId);
  if (!router) {
    res.status(404).json({ error: 'Router no encontrado' });
    return null;
  }
  return router;
}

networkRouter.get('/sites/:siteId/next-free-ip', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const siteId = parseInt(req.params.siteId, 10);
    const { routerId, poolName } = req.query;
    const result = await findNextFreeIpForSite(orgId, siteId, {
      routerId: routerId ? parseInt(routerId, 10) : undefined,
      poolName: poolName || undefined,
    });
    const macLookup = await resolveMacForIp(orgId, siteId, result.ip, {
      routerId: routerId ? parseInt(routerId, 10) : result.routerId,
    });
    res.json({ ...result, macAddress: macLookup.macAddress || null, macSource: macLookup.source || null });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

networkRouter.get('/sites/:siteId/mac-for-ip', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const siteId = parseInt(req.params.siteId, 10);
    const { ip, routerId } = req.query;
    if (!ip) return res.status(400).json({ error: 'Parámetro ip requerido' });
    const result = await resolveMacForIp(orgId, siteId, String(ip), {
      routerId: routerId ? parseInt(routerId, 10) : undefined,
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

networkRouter.get('/routers/:id/snapshot', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const router = await getRouterOr404(req.params.id, orgId, res);
    if (!router) return;
    res.json(await getRouterNetworkSnapshot(router));
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

networkRouter.get('/routers/:id/ppp-profiles', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const router = await getRouterOr404(req.params.id, orgId, res);
    if (!router) return;
    res.json(await listPppProfiles(router));
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

networkRouter.post('/routers/:id/ppp-profiles', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const router = await getRouterOr404(req.params.id, orgId, res);
    if (!router) return;
    const { name, localAddress, remoteAddress, rateLimit, comment } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre de perfil requerido' });
    const result = await createPppProfile(router, {
      name,
      'local-address': localAddress,
      'remote-address': remoteAddress,
      'rate-limit': rateLimit,
      comment,
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

networkRouter.post('/routers/:id/ppp/server', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const router = await getRouterOr404(req.params.id, orgId, res);
    if (!router) return;
    const {
      serviceName,
      interface: iface,
      defaultProfile,
      authentication,
      oneSessionPerHost,
      comment,
    } = req.body;
    if (!serviceName || !iface || !defaultProfile) {
      return res.status(400).json({ error: 'serviceName, interface y defaultProfile requeridos' });
    }
    const result = await upsertPppoeServer(router, {
      serviceName,
      interface: iface,
      defaultProfile,
      authentication,
      oneSessionPerHost: oneSessionPerHost !== false,
      comment,
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

networkRouter.get('/routers/:id/ppp/servers', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const router = await getRouterOr404(req.params.id, orgId, res);
    if (!router) return;
    res.json(await listPppoeServers(router));
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

networkRouter.post('/routers/:id/dhcp/pool', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const router = await getRouterOr404(req.params.id, orgId, res);
    if (!router) return;
    const { name, ranges, comment } = req.body;
    if (!name || !ranges) return res.status(400).json({ error: 'Nombre y rango requeridos (ej: 172.16.140.10-172.16.140.254)' });
    const result = await createIpPool(router, { name, ranges, comment });
    res.status(201).json(result);
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

networkRouter.post('/routers/:id/dhcp/network', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const router = await getRouterOr404(req.params.id, orgId, res);
    if (!router) return;
    const { address, gateway, dnsServer, comment } = req.body;
    if (!address || !gateway) return res.status(400).json({ error: 'address (CIDR) y gateway requeridos' });
    const result = await createDhcpNetwork(router, {
      address,
      gateway,
      'dns-server': dnsServer,
      comment,
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

networkRouter.post('/routers/:id/dhcp/server', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const router = await getRouterOr404(req.params.id, orgId, res);
    if (!router) return;
    const { name, interface: iface, addressPool } = req.body;
    if (!name || !iface || !addressPool) {
      return res.status(400).json({ error: 'name, interface y addressPool requeridos' });
    }
    const result = await createDhcpServer(router, {
      name,
      interface: iface,
      'address-pool': addressPool,
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

networkRouter.post('/routers/:id/dhcp/lease', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const router = await getRouterOr404(req.params.id, orgId, res);
    if (!router) return;
    const { address, macAddress, comment } = req.body;
    if (!address) return res.status(400).json({ error: 'IP requerida' });
    const result = await upsertDhcpStaticLease(router, { address, macAddress, comment });
    res.json(result);
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

async function getSiteRouter(eqRow, orgId) {
  if (!eqRow.siteId) return null;
  const [router] = await db.select().from(equipment)
    .where(and(
      eq(equipment.siteId, eqRow.siteId),
      eq(equipment.type, 'router'),
      orgFilter(equipment, orgId),
    ))
    .limit(1);
  return router || null;
}

async function buildRouterBySiteMap(items, orgId) {
  const siteIds = [...new Set(items.map((e) => e.siteId).filter(Boolean))];
  const map = new Map();
  for (const siteId of siteIds) {
    const [router] = await db.select().from(equipment)
      .where(and(eq(equipment.siteId, siteId), eq(equipment.type, 'router'), orgFilter(equipment, orgId)))
      .limit(1);
    if (router) map.set(siteId, router);
  }
  return map;
}

networkRouter.get('/sites/:siteId/resolve-dynamic-ip', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const siteId = parseInt(req.params.siteId, 10);
    const { mode, mac, username } = req.query;

    if (!['dhcp', 'pppoe'].includes(mode)) {
      return res.status(400).json({ error: 'mode debe ser dhcp o pppoe' });
    }

    const [router] = await db.select().from(equipment)
      .where(and(eq(equipment.siteId, siteId), eq(equipment.type, 'router'), orgFilter(equipment, orgId)))
      .limit(1);
    if (!router) return res.status(404).json({ error: 'No hay router MikroTik configurado en este nodo' });

    if (mode === 'dhcp') {
      if (!mac) return res.status(400).json({ error: 'Parámetro mac requerido' });
      const norm = (mac).toLowerCase().replace(/[^0-9a-f]/g, '');
      const leases = await listDhcpLeases(router);
      const lease = leases.find((l) =>
        (l['mac-address'] || '').toLowerCase().replace(/[^0-9a-f]/g, '') === norm,
      );
      if (!lease) return res.json({ ip: null, status: 'not-found' });
      return res.json({
        ip: lease['active-address'] || lease.address || null,
        status: lease.status || null,
        hostname: lease['host-name'] || null,
      });
    }

    if (mode === 'pppoe') {
      if (!username) return res.status(400).json({ error: 'Parámetro username requerido' });
      const sessions = await listPppoeActive(router);
      const sess = sessions.find((s) => s.name === username);
      if (!sess) return res.json({ ip: null, status: 'not-connected' });
      return res.json({ ip: sess.address || null, status: 'active', uptime: sess.uptime || null });
    }
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

networkRouter.post('/equipment/:id/snmp/poll', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const id = parseInt(req.params.id, 10);
    const [equipmentRow] = await db.select().from(equipment)
      .where(and(eq(equipment.id, id), orgFilter(equipment, orgId)))
      .limit(1);
    if (!equipmentRow) return res.status(404).json({ error: 'Equipo no encontrado' });

    // El job ya persiste vía persistPollResult (conserva wireless previo y el
    // margen de fallos consecutivos); no sobrescribir el estado acá.
    const result = await dispatch(JobNames.SNMP_POLL_ONE, { equipmentId: id, orgId });

    res.json({ equipment: equipmentRow.name, ...result });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

networkRouter.post('/equipment/snmp/poll-all', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const items = await db.select().from(equipment)
      .where(and(orgFilter(equipment, orgId), ne(equipment.type, 'router')));
    const pollable = items.filter((e) => e.ipAddress && e.snmpCommunity);
    const routerBySite = await buildRouterBySiteMap(pollable, orgId);
    const results = await pollEquipmentList(pollable, routerBySite);

    for (const r of results) {
      if (r.skipped) continue;
      const eqRow = items.find((e) => e.id === r.id);
      if (!eqRow) continue;
      await persistPollResult(eqRow, r);
    }

    res.json({ polled: results.length, results });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});
