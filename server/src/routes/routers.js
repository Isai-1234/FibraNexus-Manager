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

// POST - test connection to router directly
routersRouter.post('/test-connection', requireRole('admin'), async (req, res) => {
  try {
    const { routerType, routerIp, routerPort, routerUser, routerPass } = req.body;
    if (!routerIp || !routerUser || !routerPass) {
      return res.status(400).json({ error: 'IP, usuario y contraseña son requeridos' });
    }
    const port = routerPort || (routerType === 'mikrotik_v6' ? '8728' : '443');
    const url = `https://${routerIp}:${port}/rest/system/resource`;
    const auth = Buffer.from(`${routerUser}:${routerPass}`).toString('base64');
    const https = await import('https');
    const result = await new Promise((resolve, reject) => {
      const req = https.default.request(url, {
        method: 'GET',
        headers: { 'Authorization': `Basic ${auth}` },
        rejectUnauthorized: false,
        timeout: 5000,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) resolve(JSON.parse(data));
          else reject(new Error(`HTTP ${res.statusCode}`));
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout - router no responde')); });
      req.end();
    });
    res.json({ success: true, routerInfo: result });
  } catch (error) {
    res.status(503).json({ error: 'No se pudo conectar: ' + error.message });
  }
});

// GET - generar RouterScript para Mikrotik
routersRouter.get('/:id/mikrotik-script', requireRole('admin'), async (req, res) => {
  try {
    const routerId = parseInt(req.params.id);
    const routers = await db.select().from(equipment).where(eq(equipment.id, routerId));
    if (!routers.length) return res.status(404).json({ error: 'Router no encontrado' });
    const router = routers[0];
    const token = router.credentials?.agentToken;
    if (!token) return res.status(400).json({ error: 'Router sin token de agente' });
    const serverUrl = process.env.RENDER_EXTERNAL_URL || 'https://fibranexus-manager.onrender.com';
    const script = `:local token "${token}"
:local serverUrl "${serverUrl}/api/routers/agent/heartbeat"
:local routerId "${routerId}"

/tool fetch url=$serverUrl \\
  http-method=post \\
  http-header-field="Content-Type: application/json" \\
  http-data=("{\\\"agentToken\\\":\\\"" . $token . "\\\",\\\"routerInfo\\\":{\\\"id\\\":\\\"" . $routerId . "\\\",\\\"version\\\":[/system resource get version],\\\"uptime\\\":[/system resource get uptime],\\\"cpuLoad\\\":[/system resource get cpu-load]}}") \\
  output=none`;
    res.json({
      script,
      installInstructions: [
        '1. Abre Winbox y conéctate a tu router',
        '2. Ve a System → Scripts → haz clic en "+"',
        '3. Nombre: fibranexus-agent',
        '4. Pega el script en el campo "Source"',
        '5. Ve a System → Scheduler → haz clic en "+"',
        '6. Nombre: fibranexus-heartbeat',
        '7. Interval: 00:00:30 (cada 30 segundos)',
        '8. On Event: fibranexus-agent',
        '9. Haz clic en OK — listo',
      ]
    });
  } catch (error) {
    res.status(500).json({ error: 'Error generando script: ' + error.message });
  }
});
