import { Router } from 'express';
import { db } from '../db/index.js';
import { sites, equipment, clients } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId } from '../lib/tenant.js';
import { connectedAgents } from './routers.js';
import { inferConnectionMethod } from '../lib/tenant.js';
import { listPppoeActive, listPppoeSecrets, listSimpleQueues } from '../lib/mikrotikClient.js';
import { loadRouter } from '../lib/networkProvision.js';
import { assignEquipmentToClient, enrichEquipmentWithClients, syncEquipmentToClientService } from '../lib/equipmentClientLink.js';
import { attachSnmpDisplay, isPollStale, isPollable } from '../lib/equipmentStatus.js';
import { dispatch, JobNames } from '../lib/jobs/queue.js';
import { enrichMacFromDhcp } from '../lib/ipAllocation.js';

export const sitesRouter = Router();

async function resolveEquipmentParentRouter(orgId, parentId, siteId, equipmentId = null) {
  if (parentId === undefined || parentId === null || parentId === '') return { parentId: null };
  const pid = parseInt(parentId, 10);
  if (!Number.isFinite(pid)) return { error: 'Router padre inválido', status: 400 };
  if (equipmentId && pid === equipmentId) return { error: 'Un equipo no puede ser padre de sí mismo', status: 400 };
  const [parent] = await db.select().from(equipment)
    .where(and(eq(equipment.id, pid), orgFilter(equipment, orgId)))
    .limit(1);
  if (!parent) return { error: 'Router padre no encontrado', status: 404 };
  if (parent.type !== 'router') return { error: 'El padre debe ser un router', status: 400 };
  const resolvedSiteId = siteId != null ? parseInt(siteId, 10) : null;
  if (resolvedSiteId && parent.siteId !== resolvedSiteId) {
    return { error: 'El router padre debe estar en el mismo nodo', status: 400 };
  }
  return { parentId: pid };
}

function buildSiteTree(flatSites, equipmentList) {
  const byParent = new Map();
  for (const s of flatSites) {
    const key = s.parentId ?? 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(s);
  }

  function attachEquipment(siteId) {
    return equipmentList.filter((e) => e.siteId === siteId);
  }

  function build(parentKey) {
    return (byParent.get(parentKey) || []).map((site) => ({
      ...site,
      equipment: attachEquipment(site.id),
      children: build(site.id),
    }));
  }

  return build('root');
}

sitesRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;

    const flatSites = await db.select().from(sites).where(orgFilter(sites, orgId));
    const allEquipment = await db.select().from(equipment).where(orgFilter(equipment, orgId));

    // Capa 4: caché BD directo — sin SNMP en el handler HTTP
    const enrichedEquipment = await enrichEquipmentWithClients(
      allEquipment.map((item) => {
        const agent = item.type === 'router' ? connectedAgents.get(item.id.toString()) : null;
        const agentFresh = agent != null && Date.now() - new Date(agent.lastSeen).getTime() < 120_000;
        return {
          ...attachSnmpDisplay(item),
          isStale: isPollStale(item.lastSeen),
          connectionMethod: item.type === 'router' ? inferConnectionMethod(item) : null,
          agentConnected: item.type === 'router' && (
            agentFresh ||
            (item.credentials?.lastHeartbeat
              ? Date.now() - new Date(item.credentials.lastHeartbeat).getTime() < 120_000
              : item.status === 'online')
          ),
          agentLastSeen: agent?.lastSeen || item.lastSeen || null,
        };
      }),
      orgId,
    );

    const unassigned = enrichedEquipment.filter((e) => !e.siteId);
    res.json({
      tree: buildSiteTree(flatSites, enrichedEquipment),
      unassigned,
      stats: {
        sites: flatSites.length,
        routers: enrichedEquipment.filter((e) => e.type === 'router').length,
        online: enrichedEquipment.filter((e) => e.type === 'router' && (e.agentConnected || e.status === 'online')).length,
        cpe: enrichedEquipment.filter((e) => e.type === 'cpe' || e.brand === 'Ubiquiti').length,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al listar sitios: ' + error.message });
  }
});

sitesRouter.post('/', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const { name, type, parentId, address, city, latitude, longitude, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });

    if (parentId) {
      const [parent] = await db.select().from(sites)
        .where(and(eq(sites.id, parseInt(parentId)), orgFilter(sites, orgId)))
        .limit(1);
      if (!parent) return res.status(404).json({ error: 'Sitio padre no encontrado' });
    }

    const [site] = await db.insert(sites).values({
      organizationId: orgId,
      parentId: parentId ? parseInt(parentId) : null,
      name,
      type: type || 'node',
      address,
      city,
      latitude,
      longitude,
      notes,
    }).returning();

    res.status(201).json(site);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear sitio: ' + error.message });
  }
});

sitesRouter.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const siteId = parseInt(req.params.id);
    const [existing] = await db.select().from(sites)
      .where(and(eq(sites.id, siteId), orgFilter(sites, orgId)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: 'Sitio no encontrado' });

    const { name, type, parentId, address, city, latitude, longitude, notes } = req.body;
    const [updated] = await db.update(sites).set({
      ...(name !== undefined && { name }),
      ...(type !== undefined && { type }),
      ...(parentId !== undefined && { parentId: parentId ? parseInt(parentId) : null }),
      ...(address !== undefined && { address }),
      ...(city !== undefined && { city }),
      ...(latitude !== undefined && { latitude }),
      ...(longitude !== undefined && { longitude }),
      ...(notes !== undefined && { notes }),
      updatedAt: new Date(),
    }).where(eq(sites.id, siteId)).returning();

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar sitio: ' + error.message });
  }
});

sitesRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const siteId = parseInt(req.params.id);

    const [existing] = await db.select().from(sites)
      .where(and(eq(sites.id, siteId), orgFilter(sites, orgId)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: 'Sitio no encontrado' });

    await db.update(equipment).set({ siteId: null }).where(eq(equipment.siteId, siteId));
    await db.update(sites).set({ parentId: null }).where(eq(sites.parentId, siteId));
    await db.delete(sites).where(eq(sites.id, siteId));

    res.json({ message: 'Sitio eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar sitio: ' + error.message });
  }
});

sitesRouter.post('/equipment/:id/assign', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const equipmentId = parseInt(req.params.id);
    const { siteId } = req.body;

    if (siteId) {
      const [site] = await db.select().from(sites)
        .where(and(eq(sites.id, parseInt(siteId)), orgFilter(sites, orgId)))
        .limit(1);
      if (!site) return res.status(404).json({ error: 'Sitio no encontrado' });
    }

    const [updated] = await db.update(equipment).set({
      siteId: siteId ? parseInt(siteId) : null,
      updatedAt: new Date(),
    }).where(and(eq(equipment.id, equipmentId), orgFilter(equipment, orgId))).returning();

    if (!updated) return res.status(404).json({ error: 'Equipo no encontrado' });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Error al asignar equipo: ' + error.message });
  }
});

sitesRouter.post('/equipment', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const {
      name, type, brand, model, ipAddress, siteId, macAddress, notes, snmpCommunity, clientId,
      connectionMode, pppoeUsername, parentId,
    } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'Nombre y tipo requeridos' });

    const parsedSiteId = siteId ? parseInt(siteId, 10) : null;
    const parentResult = await resolveEquipmentParentRouter(orgId, parentId, parsedSiteId);
    if (parentResult.error) return res.status(parentResult.status).json({ error: parentResult.error });

    if (siteId) {
      const [site] = await db.select().from(sites)
        .where(and(eq(sites.id, parseInt(siteId)), orgFilter(sites, orgId)))
        .limit(1);
      if (!site) return res.status(404).json({ error: 'Sitio no encontrado' });
    }

    if (clientId) {
      const parsedClientId = parseInt(clientId, 10);
      const [clientRow] = await db.select({ id: clients.id }).from(clients)
        .where(and(eq(clients.id, parsedClientId), orgFilter(clients, orgId)))
        .limit(1);
      if (!clientRow) return res.status(404).json({ error: 'Abonado no encontrado' });
    }

    const resolvedMac = await enrichMacFromDhcp(orgId, {
      siteId: parsedSiteId,
      ipAddress,
      macAddress,
    });

    const initCreds = {};
    if (connectionMode && connectionMode !== 'static') initCreds.connectionMode = connectionMode;
    if (pppoeUsername) initCreds.pppoeUsername = pppoeUsername;
    if (parentResult.parentId) initCreds.routerId = parentResult.parentId;

    const [created] = await db.insert(equipment).values({
      organizationId: orgId,
      siteId: parsedSiteId,
      parentId: parentResult.parentId,
      name,
      type,
      brand: brand || 'Generic',
      model: model || 'Unknown',
      ipAddress: ipAddress || null,
      macAddress: resolvedMac || macAddress || null,
      snmpCommunity: snmpCommunity || null,
      notes: notes || null,
      status: 'offline',
      credentials: Object.keys(initCreds).length ? initCreds : null,
    }).returning();

    if (clientId) {
      const linked = await assignEquipmentToClient(created.id, parseInt(clientId, 10), orgId);
      const [enriched] = await enrichEquipmentWithClients([linked], orgId);
      return res.status(201).json(enriched[0]);
    }

    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear equipo: ' + error.message });
  }
});

sitesRouter.patch('/equipment/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const equipmentId = parseInt(req.params.id, 10);
    const [existing] = await db.select().from(equipment)
      .where(and(eq(equipment.id, equipmentId), orgFilter(equipment, orgId)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: 'Equipo no encontrado' });

    const {
      name, brand, model, ipAddress, macAddress, snmpCommunity, notes, clientId, siteId,
      connectionMode, pppoeUsername, parentId,
    } = req.body;

    const mergedSiteForParent = siteId !== undefined
      ? (siteId ? parseInt(siteId, 10) : null)
      : existing.siteId;
    if (parentId !== undefined) {
      const parentResult = await resolveEquipmentParentRouter(
        orgId, parentId, mergedSiteForParent, equipmentId,
      );
      if (parentResult.error) return res.status(parentResult.status).json({ error: parentResult.error });
    }

    const patch = { updatedAt: new Date() };
    if (name !== undefined) patch.name = name;
    if (brand !== undefined) patch.brand = brand;
    if (model !== undefined) patch.model = model;
    if (ipAddress !== undefined) patch.ipAddress = ipAddress || null;
    if (macAddress !== undefined) patch.macAddress = macAddress || null;

    const mergedIp = patch.ipAddress !== undefined ? patch.ipAddress : existing.ipAddress;
    const mergedMac = patch.macAddress !== undefined ? patch.macAddress : existing.macAddress;
    const mergedSiteId = patch.siteId !== undefined ? patch.siteId : existing.siteId;
    const dhcpMac = await enrichMacFromDhcp(orgId, {
      siteId: mergedSiteId,
      ipAddress: mergedIp,
      macAddress: mergedMac,
    });
    if (dhcpMac && !mergedMac) patch.macAddress = dhcpMac;

    if (snmpCommunity !== undefined && String(snmpCommunity).length > 0) {
      const { encryptSecret } = await import('../lib/secrets.js');
      patch.snmpCommunity = encryptSecret(snmpCommunity);
    } else if (snmpCommunity === '' || snmpCommunity === null) {
      // no borrar community existente si el form envía vacío (UI no precarga)
    }
    if (notes !== undefined) patch.notes = notes || null;
    if (siteId !== undefined) patch.siteId = siteId ? parseInt(siteId, 10) : null;

    if (parentId !== undefined) {
      patch.parentId = parentId ? parseInt(parentId, 10) : null;
    }

    if (parentId !== undefined || connectionMode !== undefined || pppoeUsername !== undefined) {
      const currentCreds = existing.credentials || {};
      const mergedCreds = { ...currentCreds };
      if (parentId !== undefined) {
        if (patch.parentId) mergedCreds.routerId = patch.parentId;
        else delete mergedCreds.routerId;
      }
      if (connectionMode !== undefined) {
        if (connectionMode && connectionMode !== 'static') {
          mergedCreds.connectionMode = connectionMode;
        } else {
          delete mergedCreds.connectionMode;
          delete mergedCreds.resolvedIp;
          delete mergedCreds.resolvedAt;
        }
      }
      if (pppoeUsername !== undefined) {
        if (pppoeUsername) mergedCreds.pppoeUsername = pppoeUsername;
        else delete mergedCreds.pppoeUsername;
      }
      patch.credentials = mergedCreds;
    }

    const [updated] = await db.update(equipment).set(patch)
      .where(eq(equipment.id, equipmentId)).returning();

    let result = updated;
    if (clientId !== undefined) {
      result = await assignEquipmentToClient(
        equipmentId,
        clientId ? parseInt(clientId, 10) : null,
        orgId,
      );
    }

    if (result.clientId) {
      await syncEquipmentToClientService(result, result.clientId, orgId);
    }

    // Respuesta inmediata; SNMP en background si el equipo es polleable
    if (isPollable(result)) {
      dispatch(JobNames.SNMP_POLL_ONE, { equipmentId: result.id, orgId })
        .catch((err) => console.error('[sites-equipment-put] snmp poll error:', err.message));
    }

    const [enriched] = await enrichEquipmentWithClients([{ ...attachSnmpDisplay(result), isStale: true }], orgId);
    res.json(enriched[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar equipo: ' + error.message });
  }
});

sitesRouter.get('/router/:id/network', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const routerId = parseInt(req.params.id);
    const router = await loadRouter(routerId, orgId);
    if (!router) return res.status(404).json({ error: 'Router no encontrado' });

    const [secrets, queues, active] = await Promise.all([
      listPppoeSecrets(router).catch(() => []),
      listSimpleQueues(router).catch(() => []),
      listPppoeActive(router).catch(() => []),
    ]);

    res.json({
      router: { id: router.id, name: router.name, status: router.status },
      pppoeSecrets: Array.isArray(secrets) ? secrets : [secrets],
      simpleQueues: Array.isArray(queues) ? queues : [queues],
      pppoeActive: Array.isArray(active) ? active : [active],
    });
  } catch (error) {
    res.status(503).json({ error: 'No se pudo leer red del router: ' + error.message });
  }
});
