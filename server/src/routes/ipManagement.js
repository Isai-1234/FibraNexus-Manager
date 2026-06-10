import { Router } from 'express';
import { db } from '../db/index.js';
import { ipAddresses, clients, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';

export const ipManagementRouter = Router();

ipManagementRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  const ips = await db.select({
    id: ipAddresses.id, address: ipAddresses.address, subnet: ipAddresses.subnet,
    gateway: ipAddresses.gateway, vlan: ipAddresses.vlan, status: ipAddresses.status,
    assignedTo: { fullName: users.fullName }
  })
  .from(ipAddresses)
  .leftJoin(clients, eq(ipAddresses.assignedTo, clients.id))
  .leftJoin(users, eq(clients.userId, users.id))
  .limit(100);
  res.json(ips);
});

ipManagementRouter.post('/', requireRole('admin'), async (req, res) => {
  const { address, subnet, gateway, vlan } = req.body;
  const [ip] = await db.insert(ipAddresses).values({ address, subnet, gateway, vlan: parseInt(vlan) || null }).returning();
  res.status(201).json(ip);
});
