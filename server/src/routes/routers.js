import { Router } from 'express';
import { db } from '../db/index.js';
import { equipment } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import crypto from 'crypto';

export const routersRouter = Router();
export const connectedAgents = new Map();

function serverBaseUrl() {
  return process.env.PUBLIC_URL || process.env.FRONTEND_URL || process.env.RENDER_EXTERNAL_URL || 'https://app.fibranexus.cl';
}

function buildHeartbeatScript(token, routerId) {
  const serverUrl = `${serverBaseUrl()}/api/routers/agent/heartbeat`;
  return `:local token "${token}"
:local serverUrl "${serverUrl}"
:local routerId "${routerId}"
:local ver [/system resource get version]
:local up [/system resource get uptime]
:local cpu [/system resource get cpu-load]
:local payload ("{\\"agentToken\\":\\"" . $token . "\\",\\"routerInfo\\":{\\"id\\":\\"" . $routerId . "\\",\\"version\\":\\"" . $ver . "\\",\\"uptime\\":\\"" . $up . "\\",\\"cpuLoad\\":\\"" . $cpu . "\\"}}")
/tool fetch url=$serverUrl http-method=post http-header-field="Content-Type: application/json" http-data=$payload output=none`;
}

function buildTunnelSetupScript(tunnelToken, routerIp) {
  const localIp = routerIp || '192.168.88.1';
  return `# FibraNexus — Cloudflare Tunnel en router (avanzado: L009 ARM32, CHR, x86)
# Requiere: /system device-mode update container=yes + reinicio
# ARM32: imagen stroebs/cloudflared (oficial no soporta ARM32)

:if ([/interface find name=veth-cf] = "") do={
  /interface veth add name=veth-cf address=172.30.0.2/24 gateway=172.30.0.1
}
:if ([/interface bridge find name=containers] = "") do={
  /interface bridge add name=containers
  /ip address add address=172.30.0.1/24 interface=containers
  /interface bridge port add bridge=containers interface=veth-cf
}
:if ([/ip firewall nat find comment="fibranexus-containers"] = "") do={
  /ip firewall nat add chain=srcnat src-address=172.30.0.0/24 action=masquerade comment=fibranexus-containers
}
:if ([/container find name=fibranexus-cf] = "") do={
  /container config set registry-url=https://registry-1.docker.io tmpdir=disk1/pull
  /container mounts add name=cf-tmp src=disk1/pull dst=/tmp
  /container add name=fibranexus-cf remote-image=stroebs/cloudflared:latest interface=veth-cf root-dir=disk1/containers/cloudflared mounts=cf-tmp start-on-boot=yes auto-restart=yes
  /container set fibranexus-cf default-entrypoint="cloudflared --no-autoupdate" cmd="tunnel --no-autoupdate run --token ${tunnelToken}"
}
/container start fibranexus-cf`;
}

function buildBootScript() {
  return `:delay 45s
:foreach c in=[/container find] do={ :if ([/container get $c running]=false) do={ /container start $c } }
/system script run fibranexus-agent`;
}

function buildPersistenceScript() {
  const boot = buildBootScript();
  return `# FibraNexus — scheduler + arranque tras reboot
/system scheduler remove [find name=fibranexus-heartbeat]
/system scheduler add name=fibranexus-heartbeat interval=30s on-event=fibranexus-agent

/system script remove [find name=fibranexus-boot]
/system script add name=fibranexus-boot policy=read,write,test source={
${boot}
}
/system scheduler remove [find name=fibranexus-boot]
/system scheduler add name=fibranexus-boot start-time=startup on-event=fibranexus-boot interval=00:00:00

:put "FibraNexus: scheduler y boot OK"`;
}

function inferConnectionMethod(router) {
  const creds = router.credentials || {};
  const saved = routerInfoFromRouter(router);
  if (creds.tunnelToken || creds.tunnelHostname || (router.ipAddress && String(router.ipAddress).includes('fibranexus.cl'))) {
    return 'cloudflare_tunnel';
  }
  if (creds.connectionMethod === 'agent' && String(creds.routerType || '').startsWith('mikrotik') && saved?.version) {
    return 'cloudflare_tunnel';
  }
  if (creds.connectionMethod) return creds.connectionMethod;
  return 'direct';
}

function routerInfoFromRouter(router) {
  const agent = connectedAgents.get(String(router.id));
  return agent?.routerInfo || router.credentials?.lastRouterInfo || null;
}

function resolveHost(router) {
  return router.ipAddress || router.credentials?.tunnelHostname || null;
}

function buildFullSetupScript({ token, routerId, tunnelToken, routerIp, connectionMethod }) {
  const heartbeat = buildHeartbeatScript(token, routerId);
  const lines = [
    '# FibraNexus — instalación automática (pegar en Terminal, ejecutar una vez)',
    '',
    '/system script remove [find name=fibranexus-agent]',
    '/system script add name=fibranexus-agent policy=read,write,test source={',
    heartbeat,
    '}',
    '',
    '/system scheduler remove [find name=fibranexus-heartbeat]',
    '/system scheduler add name=fibranexus-heartbeat interval=30s on-event=fibranexus-agent',
  ];

  if (connectionMethod === 'cloudflare_tunnel' && tunnelToken) {
    lines.push('', buildTunnelSetupScript(tunnelToken, routerIp));
  }

  const boot = buildBootScript();
  lines.push(
    '',
    '/system script remove [find name=fibranexus-boot]',
    '/system script add name=fibranexus-boot policy=read,write,test source={',
    boot,
    '}',
    '/system scheduler remove [find name=fibranexus-boot]',
    '/system scheduler add name=fibranexus-boot start-time=startup on-event=fibranexus-boot interval=00:00:00',
    '',
    '/system script run fibranexus-agent',
    ':put "FibraNexus: instalación completada"',
  );

  return lines.join('\n');
}

routersRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const routers = await db.select().from(equipment).where(eq(equipment.type, 'router')).limit(50);
    const routersWithStatus = routers.map(r => {
      const agent = connectedAgents.get(r.id.toString());
      const connectionMethod = inferConnectionMethod(r);
      return {
        ...r,
        connectionMethod,
        credentials: { ...r.credentials, connectionMethod },
        agentConnected: connectedAgents.has(r.id.toString()) || r.status === 'online',
        agentLastSeen: agent?.lastSeen || r.lastSeen || null,
        routerInfo: agent?.routerInfo || r.credentials?.lastRouterInfo || null,
      };
    });
    res.json(routersWithStatus);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar routers' });
  }
});

routersRouter.post('/', requireRole('admin'), async (req, res) => {
  try {
    const {
      name, brand, model, location, routerType, snmpCommunity,
      connectionMethod, routerIp, routerPort, routerUser, routerPass,
      tunnelHostname, tunnelToken,
    } = req.body;
    if (!name || !routerType) return res.status(400).json({ error: 'Nombre y tipo requeridos' });
    const agentToken = crypto.randomUUID();
    const credentials = {
      agentToken,
      routerType,
      connectionMethod: connectionMethod || 'direct',
      routerPort: routerPort || '443',
      tunnelHostname: tunnelHostname || null,
      tunnelToken: tunnelToken || null,
      routerUser: routerUser || null,
      encryptedAt: new Date().toISOString(),
    };
    const [router] = await db.insert(equipment).values({
      name,
      type: 'router',
      brand: brand || routerType,
      model: model || 'Unknown',
      ipAddress: tunnelHostname || routerIp || null,
      location,
      status: 'offline',
      snmpCommunity,
      credentials,
    }).returning();
    res.status(201).json({ ...router, agentToken });
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar router: ' + error.message });
  }
});

export async function agentHeartbeatHandler(req, res) {
  try {
    const { agentToken, routerInfo } = req.body;
    if (!agentToken) return res.status(403).json({ error: 'Token de agente requerido' });
    const allRouters = await db.select().from(equipment).where(eq(equipment.type, 'router'));
    const router = allRouters.find(r => r.credentials && r.credentials.agentToken === agentToken);
    if (!router) return res.status(403).json({ error: 'Token de agente inválido' });

    const updates = { status: 'online', lastSeen: new Date() };
    if (routerInfo?.version) updates.firmware = String(routerInfo.version).slice(0, 50);

    const creds = { ...router.credentials, lastRouterInfo: routerInfo || null };
    if (creds.connectionMethod === 'agent' && String(creds.routerType || '').startsWith('mikrotik') && routerInfo?.version) {
      creds.connectionMethod = 'cloudflare_tunnel';
    } else if (!creds.connectionMethod) {
      creds.connectionMethod = inferConnectionMethod({ ...router, credentials: creds });
    }
    await db.update(equipment).set({ ...updates, credentials: creds }).where(eq(equipment.id, router.id));
    connectedAgents.set(router.id.toString(), { routerId: router.id, lastSeen: new Date(), routerInfo });
    res.json({ status: 'ok', routerId: router.id, routerName: router.name });
  } catch (error) {
    res.status(500).json({ error: 'Error en heartbeat: ' + error.message });
  }
}

routersRouter.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    const routerId = parseInt(req.params.id);
    const routers = await db.select().from(equipment).where(eq(equipment.id, routerId));
    if (!routers.length) return res.status(404).json({ error: 'Router no encontrado' });
    const router = routers[0];
    const { connectionMethod, tunnelHostname, location, name } = req.body;
    const creds = { ...router.credentials };
    if (connectionMethod) creds.connectionMethod = connectionMethod;
    if (tunnelHostname) creds.tunnelHostname = tunnelHostname;
    const updates = { credentials: creds };
    if (location !== undefined) updates.location = location;
    if (name !== undefined) updates.name = name;
    if (tunnelHostname !== undefined) updates.ipAddress = tunnelHostname || router.ipAddress;
    const [updated] = await db.update(equipment).set(updates).where(eq(equipment.id, routerId)).returning();
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar router: ' + error.message });
  }
});

routersRouter.get('/:id/stats', requireRole('admin', 'technician'), async (req, res) => {  try {
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

routersRouter.post('/test-connection', requireRole('admin'), async (req, res) => {
  try {
    const { routerType, routerIp, routerPort, routerUser, routerPass, connectionMethod, tunnelHostname } = req.body;
    if (!routerUser || !routerPass) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }
    const host = connectionMethod === 'cloudflare_tunnel' ? tunnelHostname : routerIp;
    if (!host) return res.status(400).json({ error: 'Host o túnel requerido' });
    const port = routerPort || (routerType === 'mikrotik_v6' ? '8728' : '443');
    const url = `https://${host}:${port}/rest/system/resource`;
    const auth = Buffer.from(`${routerUser}:${routerPass}`).toString('base64');
    const https = await import('https');
    const result = await new Promise((resolve, reject) => {
      const req = https.default.request(url, {
        method: 'GET',
        headers: { Authorization: `Basic ${auth}` },
        rejectUnauthorized: false,
        timeout: 10000,
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

routersRouter.get('/:id/mikrotik-script', requireRole('admin'), async (req, res) => {
  try {
    const routerId = parseInt(req.params.id);
    const routers = await db.select().from(equipment).where(eq(equipment.id, routerId));
    if (!routers.length) return res.status(404).json({ error: 'Router no encontrado' });
    const router = routers[0];
    const token = router.credentials?.agentToken;
    if (!token) return res.status(400).json({ error: 'Router sin token de agente' });

    const connectionMethod = inferConnectionMethod(router);
    const tunnelToken = router.credentials?.tunnelToken;
    const routerIp = router.ipAddress?.includes('fibranexus.cl') ? null : router.ipAddress;

    const heartbeatScript = buildHeartbeatScript(token, routerId);
    const fullSetupScript = buildFullSetupScript({
      token,
      routerId,
      tunnelToken,
      routerIp,
      connectionMethod,
    });
    const persistenceScript = buildPersistenceScript();

    const isTunnel = connectionMethod === 'cloudflare_tunnel';
    res.json({      script: heartbeatScript,
      fullSetupScript,
      persistenceScript,
      connectionMethod,
      installInstructions: isTunnel ? [
        '1. En Cloudflare Zero Trust → Networks → Tunnels → crea un túnel',
        '2. Publica HTTP → http://IP_LOCAL:80 (ej: http://192.168.3.253:80)',
        '3. Copia el token del túnel y regístralo al agregar el router en FibraNexus',
        '4. En el MikroTik: activa container mode (/system device-mode update container=yes + reinicio)',
        '5. Abre Terminal en Winbox y pega el script completo (fullSetupScript)',
        '6. Espera 1 minuto — el dashboard mostrará "Conectado"',
      ] : [
        '1. Abre Winbox → Terminal',
        '2. Pega el script completo (fullSetupScript)',
        '3. El heartbeat correrá cada 30 segundos automáticamente',
      ],
    });
  } catch (error) {
    res.status(500).json({ error: 'Error generando script: ' + error.message });
  }
});
