import { Router } from 'express';
import { db } from '../db/index.js';
import { equipment } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { connectedAgents } from './routers.js';

export const equipmentRouter = Router();

function inferConnectionMethod(item) {
  const creds = item.credentials || {};
  if (creds.connectionMethod) return creds.connectionMethod;
  if (creds.tunnelHostname || (item.ipAddress && String(item.ipAddress).includes('fibranexus.cl'))) {
    return 'cloudflare_tunnel';
  }
  return creds.agentToken ? 'agent' : 'direct';
}

equipmentRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const allEquipment = await db.select().from(equipment).limit(50);
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
    const { name, type, brand, model, ipAddress, location } = req.body;
    const [eq] = await db.insert(equipment).values({
      name, type, brand, model, ipAddress, location, status: 'offline'
    }).returning();
    res.status(201).json(eq);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear equipo' });
  }
});

// DELETE /:id
equipmentRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await db.delete(equipment).where(eq(equipment.id, parseInt(req.params.id)));
    res.json({ message: 'Equipo eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar equipo' });
  }
});
