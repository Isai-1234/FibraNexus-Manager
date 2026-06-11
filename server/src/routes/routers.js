import { Router } from 'express';
import { db } from '../db/index.js';
import { equipment } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import crypto from 'crypto';

export const routersRouter = Router();
export const connectedAgents = new Map();

routersRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const routers = await db.select().from(equipment).where(eq(equipment.type, 'router')).limit(50);
    const routersWithStatus = routers.map(r => ({
      ...r,
      agentConnected: connectedAgents.has(r.id.toString()),
      agentLastSeen: connectedAgents.get(r.id.toString())?.lastSeen || null,
    }));
    res.json(routersWithStatus);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar routers' });
  }
});

routersRouter.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { name, brand, model, ipAddress, location, routerType, snmpCommunity } = req.body;
    if (!name || !routerType) return res.status(400).json({ error: 'Nombre y tipo requeridos' });
    const agentToken = crypto.randomUUID();
    const credentials = { agentToken, routerType, encryptedAt: new Date().toISOString() };
    const [router] = await db.insert(equipment).values({
      name, type: 'router', brand: brand || routerType, model: model || 'Unknown',
      ipAddress, location, status: 'offline', snmpCommunity, credentials,
    }).returning();
    res.status(201).json({ ...router, agentToken });
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar router: ' + error.message });
  }
});

routersRouter.post('/agent/heartbeat', async (req, res) => {
  try {
    const { agentToken, routerInfo } = req.body;
    if (!agentToken) return res.status(401).json({ error: 'Token requerido' });
    const allRouters = await db.select().from(equipment).where(eq(equipment.type, 'router'));
    const router = allRouters.find(r => r.credentials && r.credentials.agentToken === agentToken);
    if (!router) return res.status(401).json({ error: 'Token inválido' });
    await db.update(equipment).set({ status: 'online', lastSeen: new Date() }).where(eq(equipment.id, router.id));
    connectedAgents.set(router.id.toString(), { routerId: router.id, lastSeen: new Date(), routerInfo });
    res.json({ status: 'ok', routerId: router.id, routerName: router.name });
  } catch (error) {
    res.status(500).json({ error: 'Error en heartbeat: ' + error.message });
  }
});

routersRouter.get('/:id/stats', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const agent = connectedAgents.get(req.params.id);
    if (!agent) return res.status(503).json({ error: 'Agente no conectado' });
    res.json({ connected: true, lastSeen: agent.lastSeen, routerInfo: agent.routerInfo || {} });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener stats' });
  }
});

routersRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const routerId = parseInt(req.params.id);
    connectedAgents.delete(routerId.toString());
    await db.delete(equipment).where(eq(equipment.id, routerId));
    res.json({ message: 'Router eliminado y token revocado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar router' });
  }
});
