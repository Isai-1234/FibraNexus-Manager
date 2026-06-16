import { db } from '../db/index.js';
import { equipment, clients, clientServices, users, sites, detectedDevices } from '../db/schema.js';
import { and, eq, inArray, ne, desc } from 'drizzle-orm';
import { orgFilter } from './tenant.js';

const ACTIVE_SERVICE_STATUSES = ['active', 'suspended', 'pending'];

export async function getClientInOrg(clientId, orgId) {
  const [row] = await db.select({ id: clients.id, fullName: users.fullName })
    .from(clients)
    .leftJoin(users, eq(clients.userId, users.id))
    .where(and(eq(clients.id, clientId), orgFilter(clients, orgId)))
    .limit(1);
  return row || null;
}

export async function syncEquipmentToClientService(equipmentRow, clientId, orgId) {
  if (!clientId || !equipmentRow) return null;

  const [service] = await db.select({ id: clientServices.id })
    .from(clientServices)
    .innerJoin(clients, eq(clientServices.clientId, clients.id))
    .where(and(
      eq(clientServices.clientId, clientId),
      orgFilter(clients, orgId),
      inArray(clientServices.status, ACTIVE_SERVICE_STATUSES),
    ))
    .orderBy(desc(clientServices.createdAt))
    .limit(1);

  if (!service) return null;

  const patch = { updatedAt: new Date() };
  if (equipmentRow.ipAddress) patch.ipAddress = equipmentRow.ipAddress.split('/')[0];
  if (equipmentRow.macAddress) patch.macAddress = equipmentRow.macAddress;
  if (equipmentRow.siteId) patch.siteId = equipmentRow.siteId;

  const [updated] = await db.update(clientServices)
    .set(patch)
    .where(eq(clientServices.id, service.id))
    .returning();

  return updated;
}

export async function assignEquipmentToClient(equipmentId, clientId, orgId) {
  const [row] = await db.select().from(equipment)
    .where(and(eq(equipment.id, equipmentId), orgFilter(equipment, orgId)))
    .limit(1);
  if (!row) throw new Error('Equipo no encontrado');

  if (clientId) {
    const client = await getClientInOrg(clientId, orgId);
    if (!client) throw new Error('Abonado no encontrado');

    await db.update(equipment).set({ clientId: null, updatedAt: new Date() })
      .where(and(
        eq(equipment.clientId, clientId),
        ne(equipment.id, equipmentId),
        orgFilter(equipment, orgId),
      ));
  }

  // When unlinking, revert the originating detected_device so it can be re-adopted
  if (!clientId && row.detectedDeviceId) {
    await db.update(detectedDevices)
      .set({ status: 'detected', adoptedAsClientServiceId: null, updatedAt: new Date() })
      .where(eq(detectedDevices.id, row.detectedDeviceId));
  }

  const [updated] = await db.update(equipment).set({
    clientId: clientId || null,
    updatedAt: new Date(),
  }).where(eq(equipment.id, equipmentId)).returning();

  if (clientId) {
    await syncEquipmentToClientService(updated, clientId, orgId);
  }

  return updated;
}

export async function listClientEquipment(clientId, orgId) {
  const client = await getClientInOrg(clientId, orgId);
  if (!client) throw new Error('Abonado no encontrado');

  const rows = await db.select({
    id: equipment.id,
    name: equipment.name,
    type: equipment.type,
    brand: equipment.brand,
    model: equipment.model,
    ipAddress: equipment.ipAddress,
    macAddress: equipment.macAddress,
    snmpCommunity: equipment.snmpCommunity,
    status: equipment.status,
    siteId: equipment.siteId,
    clientId: equipment.clientId,
    notes: equipment.notes,
    lastSeen: equipment.lastSeen,
    credentials: equipment.credentials,
    createdAt: equipment.createdAt,
    siteName: sites.name,
    siteCity: sites.city,
  })
    .from(equipment)
    .leftJoin(sites, eq(equipment.siteId, sites.id))
    .where(and(eq(equipment.clientId, clientId), orgFilter(equipment, orgId)))
    .orderBy(equipment.createdAt);

  return rows;
}

export async function enrichEquipmentWithClients(items, orgId) {
  const clientIds = [...new Set(items.map((e) => e.clientId).filter(Boolean))];
  if (!clientIds.length) {
    return items.map((item) => ({ ...item, clientName: null }));
  }

  const rows = await db.select({
    id: clients.id,
    fullName: users.fullName,
  })
    .from(clients)
    .leftJoin(users, eq(clients.userId, users.id))
    .where(and(orgFilter(clients, orgId), inArray(clients.id, clientIds)));

  const nameById = new Map(rows.map((r) => [r.id, r.fullName]));

  return items.map((item) => ({
    ...item,
    clientName: item.clientId ? nameById.get(item.clientId) || null : null,
  }));
}
