import { Router } from 'express';
import { db } from '../db/index.js';
import { clientServices, clients, plans, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';

export const servicesRouter = Router();

// GET - Listar servicios
servicesRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const services = await db.select({
      id: clientServices.id, status: clientServices.status,
      ipAddress: clientServices.ipAddress, installationDate: clientServices.installationDate,
      nextBillingDate: clientServices.nextBillingDate, createdAt: clientServices.createdAt,
      client: { id: clients.id, fullName: users.fullName, email: users.email },
      plan: { id: plans.id, name: plans.name, downloadSpeed: plans.downloadSpeed, uploadSpeed: plans.uploadSpeed, price: plans.price }
    })
    .from(clientServices)
    .leftJoin(clients, eq(clientServices.clientId, clients.id))
    .leftJoin(users, eq(clients.userId, users.id))
    .leftJoin(plans, eq(clientServices.planId, plans.id))
    .limit(50);
    res.json(services);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar servicios' });
  }
});

// POST - Asignar servicio a cliente
servicesRouter.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { clientId, planId, ipAddress, macAddress } = req.body;
    const installDate = new Date().toISOString().split('T')[0];
    const nextBilling = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().split('T')[0];
    
    const [service] = await db.insert(clientServices).values({
      clientId: parseInt(clientId), planId: parseInt(planId),
      ipAddress, macAddress, installationDate: installDate,
      nextBillingDate: nextBilling, status: 'active'
    }).returning();
    
    res.status(201).json(service);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear servicio: ' + error.message });
  }
});

// PUT /:id - Actualizar estado de servicio
servicesRouter.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.body;
    const [updated] = await db.update(clientServices)
      .set({ status, updatedAt: new Date() })
      .where(eq(clientServices.id, parseInt(req.params.id)))
      .returning();
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar servicio' });
  }
});

// PUT /:id/suspend - Suspender
servicesRouter.put('/:id/suspend', requireRole('admin', 'technician'), async (req, res) => {
  const [updated] = await db.update(clientServices)
    .set({ status: 'suspended', updatedAt: new Date() })
    .where(eq(clientServices.id, parseInt(req.params.id)))
    .returning();
  res.json({ message: 'Servicio suspendido', service: updated });
});

// PUT /:id/reactivate - Reactivar
servicesRouter.put('/:id/reactivate', requireRole('admin'), async (req, res) => {
  const [updated] = await db.update(clientServices)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(clientServices.id, parseInt(req.params.id)))
    .returning();
  res.json({ message: 'Servicio reactivado', service: updated });
});
