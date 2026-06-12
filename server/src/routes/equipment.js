import { Router } from 'express';
import { db } from '../db/index.js';
import { equipment } from '../db/schema.js';
import { and, eq, ne } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { connectedAgents } from './routers.js';
import { orgFilter, requireOrganizationId, inferConnectionMethod } from '../lib/tenant.js';

export const equipmentRouter = Router();

equipmentRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const allEquipment = await db.select().from(equipment)
      .where(and(orgFilter(equipment, orgId), ne(equipment.type, 'router')))
      .limit(50);
    const enriched = allEquipment.map(item => {
      if (item.type !== 'router') return item;
      const agent = connectedAgents.get(item.id.toString());
      const routerInfo = agent?.routerInfo || item.credentials?.lastRouterInfo || null;
      return {
        ...item,
        connectionMethod: inferConnectionMethod(item),
        routerInfo,
        agentLastSeen: agent?.lastSeen || item.lastSeen || null,
      };
    });
    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar equipos' });
  }
});

equipmentRouter.post('/', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const { name, type, brand, model, ipAddress, location } = req.body;
    const [eq] = await db.insert(equipment).values({
      organizationId: orgId,
      name, type, brand, model, ipAddress, location, status: 'offline',
    }).returning();
    res.status(201).json(eq);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear equipo' });
  }
});

equipmentRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    await db.delete(equipment).where(and(eq(equipment.id, parseInt(req.params.id)), orgFilter(equipment, orgId)));
    res.json({ message: 'Equipo eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar equipo' });
  }
});
