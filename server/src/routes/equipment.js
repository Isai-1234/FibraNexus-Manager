import { Router } from 'express';
import { db } from '../db/index.js';
import { equipment } from '../db/schema.js';
import { and, eq, ne } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { connectedAgents } from './routers.js';
import { orgFilter, requireOrganizationId, inferConnectionMethod } from '../lib/tenant.js';
import { attachSnmpDisplay, isPollable, isPollStale } from '../lib/equipmentStatus.js';
import { enrichMacFromDhcp } from '../lib/ipAllocation.js';
import { dispatch, JobNames } from '../lib/jobs/queue.js';

export const equipmentRouter = Router();

async function patchEquipmentRow(orgId, equipmentId, body) {
  const [existing] = await db.select().from(equipment)
    .where(and(eq(equipment.id, equipmentId), orgFilter(equipment, orgId)))
    .limit(1);
  if (!existing) return null;

  const {
    name, type, brand, model, ipAddress, macAddress, serialNumber,
    location, siteId, snmpCommunity, notes, status,
  } = body;

  const patch = { updatedAt: new Date() };
  if (name !== undefined) patch.name = name;
  if (type !== undefined) patch.type = type;
  if (brand !== undefined) patch.brand = brand;
  if (model !== undefined) patch.model = model;
  if (ipAddress !== undefined) patch.ipAddress = ipAddress || null;
  if (macAddress !== undefined) patch.macAddress = macAddress || null;

  const mergedIp = ipAddress !== undefined ? (ipAddress || null) : existing.ipAddress;
  const mergedMac = macAddress !== undefined ? (macAddress || null) : existing.macAddress;
  const mergedSiteId = siteId !== undefined ? (siteId ? parseInt(siteId, 10) : null) : existing.siteId;
  const dhcpMac = await enrichMacFromDhcp(orgId, {
    siteId: mergedSiteId,
    ipAddress: mergedIp,
    macAddress: mergedMac,
  });
  if (dhcpMac && !mergedMac) patch.macAddress = dhcpMac;

  if (serialNumber !== undefined) patch.serialNumber = serialNumber || null;
  if (location !== undefined) patch.location = location || null;
  if (siteId !== undefined) patch.siteId = siteId ? parseInt(siteId, 10) : null;
  if (snmpCommunity !== undefined) patch.snmpCommunity = snmpCommunity || null;
  if (notes !== undefined) patch.notes = notes || null;
  // Estado manual solo si no es detectable por SNMP
  if (status !== undefined && !isPollable({ ...existing, ...patch })) {
    patch.status = status;
  }

  const [updated] = await db.update(equipment).set(patch)
    .where(eq(equipment.id, equipmentId)).returning();
  return updated;
}

equipmentRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const allEquipment = await db.select().from(equipment)
      .where(and(orgFilter(equipment, orgId), ne(equipment.type, 'router')))
      .limit(50);

    // Capa 4: caché BD directo — sin SNMP en el handler HTTP
    res.json(allEquipment.map((item) => ({
      ...attachSnmpDisplay(item),
      isStale: isPollStale(item.lastSeen),
    })));
  } catch (error) {
    res.status(500).json({ error: 'Error al listar equipos' });
  }
});

equipmentRouter.post('/', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const { name, type, brand, model, ipAddress, location, siteId, macAddress, snmpCommunity } = req.body;
    const [created] = await db.insert(equipment).values({
      organizationId: orgId,
      siteId: siteId ? parseInt(siteId, 10) : null,
      name, type, brand, model, ipAddress, macAddress: macAddress || null,
      snmpCommunity: snmpCommunity || null,
      location, status: 'offline',
    }).returning();
    res.status(201).json(attachSnmpDisplay(created));
  } catch (error) {
    res.status(500).json({ error: 'Error al crear equipo' });
  }
});

equipmentRouter.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const equipmentId = parseInt(req.params.id, 10);
    const updated = await patchEquipmentRow(orgId, equipmentId, req.body);
    if (!updated) return res.status(404).json({ error: 'Equipo no encontrado' });

    // Respuesta inmediata; SNMP en background si el equipo es polleable
    res.json({ ...attachSnmpDisplay(updated), isStale: true });
    if (isPollable(updated)) {
      dispatch(JobNames.SNMP_POLL_ONE, { equipmentId: updated.id, orgId })
        .catch((err) => console.error('[equipment-put] snmp poll error:', err.message));
    }
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar equipo: ' + error.message });
  }
});

equipmentRouter.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const equipmentId = parseInt(req.params.id, 10);
    const updated = await patchEquipmentRow(orgId, equipmentId, req.body);
    if (!updated) return res.status(404).json({ error: 'Equipo no encontrado' });

    res.json({ ...attachSnmpDisplay(updated), isStale: true });
    if (isPollable(updated)) {
      dispatch(JobNames.SNMP_POLL_ONE, { equipmentId: updated.id, orgId })
        .catch((err) => console.error('[equipment-patch] snmp poll error:', err.message));
    }
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar equipo: ' + error.message });
  }
});

equipmentRouter.delete('/:id', requireRole('admin'), async (req, res) => {  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    await db.delete(equipment).where(and(eq(equipment.id, parseInt(req.params.id)), orgFilter(equipment, orgId)));
    res.json({ message: 'Equipo eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar equipo' });
  }
});
