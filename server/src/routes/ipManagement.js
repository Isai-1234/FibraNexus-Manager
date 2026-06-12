import { Router } from 'express';
import { db } from '../db/index.js';
import { ipAddresses, clients, users } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId } from '../lib/tenant.js';

export const ipManagementRouter = Router();

ipManagementRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  const orgId = requireOrganizationId(req, res);
  if (!orgId) return;
  const ips = await db.select({
    id: ipAddresses.id, address: ipAddresses.address, subnet: ipAddresses.subnet,
    gateway: ipAddresses.gateway, vlan: ipAddresses.vlan, status: ipAddresses.status,
    assignedTo: { fullName: users.fullName },
  })
    .from(ipAddresses)
    .leftJoin(clients, eq(ipAddresses.assignedTo, clients.id))
    .leftJoin(users, eq(clients.userId, users.id))
    .where(orgFilter(ipAddresses, orgId))
    .limit(100);
  res.json(ips);
});

ipManagementRouter.post('/', requireRole('admin'), async (req, res) => {
  const orgId = requireOrganizationId(req, res);
  if (!orgId) return;
  const { address, subnet, gateway, vlan } = req.body;
  const [ip] = await db.insert(ipAddresses).values({
    organizationId: orgId,
    address, subnet, gateway, vlan: parseInt(vlan) || null,
  }).returning();
  res.status(201).json(ip);
});

ipManagementRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    await db.delete(ipAddresses).where(and(eq(ipAddresses.id, parseInt(req.params.id)), orgFilter(ipAddresses, orgId)));
    res.json({ message: 'IP eliminada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar IP' });
  }
});
