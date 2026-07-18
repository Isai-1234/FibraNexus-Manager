import { and, eq, sql, ne, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { clients, equipment, users } from '../db/schema.js';
import { orgFilter } from './tenant.js';

function limitError(message, code) {
  const err = new Error(message);
  err.status = 403;
  err.code = code;
  return err;
}

export async function assertWithinClientLimit(org) {
  if (!org?.maxClients) return;
  const [{ count }] = await db.select({ count: sql`count(*)::int` })
    .from(clients)
    .innerJoin(users, eq(clients.userId, users.id))
    .where(and(
      orgFilter(clients, org.id),
      eq(users.isActive, true),
      isNull(clients.deletedAt),
    ));
  if (Number(count) >= org.maxClients) {
    throw limitError(`Límite de abonados alcanzado (${org.maxClients})`, 'LIMIT_CLIENTS');
  }
}

export async function assertWithinStaffLimit(org) {
  const maxUsers = org?.maxUsers;
  if (!maxUsers) return;
  const [{ count }] = await db.select({ count: sql`count(*)::int` })
    .from(users)
    .where(and(
      eq(users.organizationId, org.id),
      inArray(users.role, ['admin', 'office', 'technician']),
      eq(users.isActive, true),
    ));
  if (Number(count) >= maxUsers) {
    throw limitError(`Límite de usuarios staff alcanzado (${maxUsers})`, 'LIMIT_USERS');
  }
}

export async function assertWithinRouterLimit(org) {
  if (!org?.maxRouters) return;
  const [{ count }] = await db.select({ count: sql`count(*)::int` })
    .from(equipment)
    .where(and(
      orgFilter(equipment, org.id),
      eq(equipment.type, 'router'),
    ));
  if (Number(count) >= org.maxRouters) {
    throw limitError(`Límite de routers alcanzado (${org.maxRouters})`, 'LIMIT_ROUTERS');
  }
}

export async function assertWithinEquipmentLimit(org) {
  const maxEquip = org?.maxEquipment
    || Math.max((org.maxRouters || 5) * 50, (org.maxClients || 100) * 2);
  const [{ count }] = await db.select({ count: sql`count(*)::int` })
    .from(equipment)
    .where(and(
      orgFilter(equipment, org.id),
      ne(equipment.type, 'router'),
    ));
  if (Number(count) >= maxEquip) {
    throw limitError(`Límite de equipos alcanzado (${maxEquip})`, 'LIMIT_EQUIPMENT');
  }
}

export async function getOrgUsage(orgId) {
  const [{ clientCount }] = await db.select({ clientCount: sql`count(*)::int` })
    .from(clients)
    .innerJoin(users, eq(clients.userId, users.id))
    .where(and(eq(clients.organizationId, orgId), eq(users.isActive, true), isNull(clients.deletedAt)));
  const [{ staffCount }] = await db.select({ staffCount: sql`count(*)::int` })
    .from(users)
    .where(and(eq(users.organizationId, orgId), inArray(users.role, ['admin', 'office', 'technician']), eq(users.isActive, true)));
  const [{ routerCount }] = await db.select({ routerCount: sql`count(*)::int` })
    .from(equipment)
    .where(and(eq(equipment.organizationId, orgId), eq(equipment.type, 'router')));
  const [{ equipmentCount }] = await db.select({ equipmentCount: sql`count(*)::int` })
    .from(equipment)
    .where(and(eq(equipment.organizationId, orgId), ne(equipment.type, 'router')));
  return {
    clientCount: Number(clientCount),
    staffCount: Number(staffCount),
    routerCount: Number(routerCount),
    equipmentCount: Number(equipmentCount),
  };
}
