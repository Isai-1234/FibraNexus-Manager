import { Router } from 'express';
import { db } from '../db/index.js';
import { equipment } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId, inferConnectionMethod } from '../lib/tenant.js';
import crypto from 'crypto';
import { refreshStaleRouters } from '../lib/routerPoller.js';

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

function buildEdgeosHeartbeatScript(token, serverUrl) {
  return `#!/bin/bash
TOKEN="${token}"
SERVER="${serverUrl}"
VER=$(cat /etc/version 2>/dev/null | head -1 | tr -d '\\n' || echo "EdgeOS")
UPTIME=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo "0")
CPULINE1=$(grep '^cpu ' /proc/stat)
sleep 1
CPULINE2=$(grep '^cpu ' /proc/stat)
read -ra C1 <<< "$CPULINE1"
read -ra C2 <<< "$CPULINE2"
T1=0; for v in "\${C1[@]:1}"; do T1=$((T1+v)); done
T2=0; for v in "\${C2[@]:1}"; do T2=$((T2+v)); done
DT=$((T2-T1)); DI=$((C2[4]-C1[4]))
CPU=0; [ $DT -gt 0 ] && CPU=$(( 100*(DT-DI)/DT ))
curl -sf --max-time 8 -X POST "$SERVER" \\
  -H "Content-Type: application/json" \\
  -d "{\\"agentToken\\":\\"$TOKEN\\",\\"routerInfo\\":{\\"version\\":\\"$VER\\",\\"uptime\\":\\"\${UPTIME}s\\",\\"cpuLoad\\":$CPU,\\"hostName\\":\\"$(hostname)\\"}}" >/dev/null 2>&1`;
}

function buildEdgeosInstallScript(heartbeatScript) {
  return `# === FibraNexus — Instalar monitor en EdgeRouter (pegar en SSH, ejecutar una vez) ===
sudo mkdir -p /config/scripts/fibranexus

sudo tee /config/scripts/fibranexus/heartbeat.sh > /dev/null << 'FNHB'
${heartbeatScript}
FNHB

sudo chmod +x /config/scripts/fibranexus/heartbeat.sh

# Registrar en Vyatta task-scheduler (persiste tras reinicios)
WRAPPER=/opt/vyatta/sbin/vyatta-cfg-cmd-wrapper
$WRAPPER begin
$WRAPPER set system task-scheduler task fibranexus executable path /config/scripts/fibranexus/heartbeat.sh
$WRAPPER set system task-scheduler task fibranexus interval 30s
$WRAPPER commit && $WRAPPER save
$WRAPPER end

echo "Ejecutando primer heartbeat..."
sudo /config/scripts/fibranexus/heartbeat.sh
echo "Listo — verifica el dashboard en ~30 segundos."`;
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
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const routers = await db.select().from(equipment).where(
      and(eq(equipment.type, 'router'), orgFilter(equipment, orgId)),
    ).limit(50);
    const refreshed = await refreshStaleRouters(routers, orgId);
    const routersWithStatus = refreshed.map(r => {
      const agent = connectedAgents.get(r.id.toString());
      const connectionMethod = inferConnectionMethod(r);
      return {
        ...r,
        connectionMethod,
        hasApiCredentials: !!(r.credentials?.routerUser && r.credentials?.routerPass),
        credentials: { ...r.credentials, connectionMethod },
        agentConnected: connectedAgents.has(r.id.toString()) || r.status === 'online'
          || (r.credentials?.lastHeartbeat && Date.now() - new Date(r.credentials.lastHeartbeat).getTime() < 120_000),
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
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const {
      name, brand, model, location, routerType, snmpCommunity,
      connectionMethod, routerIp, routerPort, routerUser, routerPass,
      tunnelHostname, tunnelToken, lanSubnet, lanInterface, dhcpSharedNetwork,
      parentRouterId,
    } = req.body;
    if (!name || !routerType) return res.status(400).json({ error: 'Nombre y tipo requeridos' });

    const isEdge = String(routerType).startsWith('edgerouter');
    const method = connectionMethod || (isEdge ? 'cloudflare_tunnel' : 'direct');
    if (method === 'cloudflare_tunnel' && !tunnelHostname && !isEdge) {
      return res.status(400).json({ error: 'Hostname del túnel requerido' });
    }
    if (method === 'cloudflare_tunnel' && isEdge && !tunnelHostname) {
      return res.status(400).json({ error: 'Hostname Cloudflare para el EdgeRouter requerido (ej: nodo2-isp.fibranexus.cl)' });
    }
    if (isEdge && method === 'cloudflare_tunnel' && !routerIp) {
      return res.status(400).json({ error: 'IP local del EdgeRouter requerida (ej: 172.16.11.254)' });
    }
    const agentToken = crypto.randomUUID();
    const credentials = {
      agentToken,
      routerType,
      connectionMethod: method,
      routerPort: routerPort || '443',
      tunnelHostname: tunnelHostname || null,
      tunnelToken: tunnelToken || null,
      parentRouterId: parentRouterId ? parseInt(parentRouterId, 10) : null,
      routerUser: routerUser || null,
      routerPass: routerPass || null,
      routerLocalIp: routerIp || null,
      lanSubnet: lanSubnet || null,
      lanInterface: lanInterface || null,
      dhcpSharedNetwork: dhcpSharedNetwork || null,
      encryptedAt: new Date().toISOString(),
    };
    const [router] = await db.insert(equipment).values({
      organizationId: orgId,
      name,
      type: 'router',
      brand: brand || (routerType?.startsWith('edgerouter') ? 'Ubiquiti' : routerType),
      model: model || 'Unknown',
      ipAddress: method === 'cloudflare_tunnel' ? (tunnelHostname || routerIp || null) : (routerIp || tunnelHostname || null),
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

    // lastHeartbeat persiste en BD — sobrevive reinicios del servidor
    const creds = { ...router.credentials, lastRouterInfo: routerInfo || null, lastHeartbeat: new Date().toISOString() };
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
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const routerId = parseInt(req.params.id);
    const routers = await db.select().from(equipment).where(
      and(eq(equipment.id, routerId), orgFilter(equipment, orgId)),
    );
    if (!routers.length) return res.status(404).json({ error: 'Router no encontrado' });
    const router = routers[0];
    const { connectionMethod, tunnelHostname, location, name, routerUser, routerPass, routerPort } = req.body;
    const creds = { ...router.credentials };
    if (connectionMethod) creds.connectionMethod = connectionMethod;
    if (tunnelHostname) creds.tunnelHostname = tunnelHostname;
    if (routerUser !== undefined) creds.routerUser = routerUser || null;
    if (routerPass !== undefined) creds.routerPass = routerPass || null;
    if (routerPort) creds.routerPort = routerPort;
    // Blindaje: campos operacionales inmutables vía este endpoint
    if (router.credentials?.agentToken) creds.agentToken = router.credentials.agentToken;
    if (router.credentials?.lastHeartbeat) creds.lastHeartbeat = router.credentials.lastHeartbeat;
    if (router.credentials?.lastRouterInfo) creds.lastRouterInfo = router.credentials.lastRouterInfo;
    const updates = { credentials: creds, updatedAt: new Date() };
    if (location !== undefined) updates.location = location;
    if (name !== undefined) updates.name = name;
    if (tunnelHostname !== undefined) updates.ipAddress = tunnelHostname || router.ipAddress;
    const [updated] = await db.update(equipment).set(updates).where(eq(equipment.id, routerId)).returning();
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar router: ' + error.message });
  }
});

routersRouter.post('/:id/test-connection', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const routerId = parseInt(req.params.id);
    const [router] = await db.select().from(equipment).where(
      and(eq(equipment.id, routerId), eq(equipment.type, 'router'), orgFilter(equipment, orgId)),
    ).limit(1);
    if (!router) return res.status(404).json({ error: 'Router no encontrado' });

    const { testRouterConnection } = await import('../lib/routerClient.js');
    const info = await testRouterConnection(router);
    res.json({ success: true, routerInfo: info });
  } catch (error) {
    res.status(503).json({ error: error.message });
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
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const routerId = parseInt(req.params.id);
    connectedAgents.delete(routerId.toString());
    await db.delete(equipment).where(and(eq(equipment.id, routerId), orgFilter(equipment, orgId)));
    res.json({ message: 'Router eliminado y token revocado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar router' });
  }
});

routersRouter.get('/:id/edgeos-script', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const routerId = parseInt(req.params.id);
    const [router] = await db.select().from(equipment).where(
      and(eq(equipment.id, routerId), orgFilter(equipment, orgId)),
    ).limit(1);
    if (!router) return res.status(404).json({ error: 'Router no encontrado' });

    // Si el router fue creado antes de que se generara agentToken, lo creamos ahora y lo persistimos
    let token = router.credentials?.agentToken;
    if (!token) {
      token = crypto.randomUUID();
      const updatedCreds = { ...(router.credentials || {}), agentToken: token };
      await db.update(equipment).set({ credentials: updatedCreds, updatedAt: new Date() })
        .where(eq(equipment.id, router.id));
    }

    const serverUrl = `${serverBaseUrl()}/api/routers/agent/heartbeat`;
    const heartbeatScript = buildEdgeosHeartbeatScript(token, serverUrl);
    const installScript = buildEdgeosInstallScript(heartbeatScript);

    res.json({
      heartbeatScript,
      installScript,
      installInstructions: [
        'Conéctate al EdgeRouter por SSH: ssh admin@IP_DEL_EDGEROUTER',
        'Pega el script de instalación completo en la terminal SSH y presiona Enter',
        'El router enviará heartbeat cada 30s — aparecerá como "Conectado" en ~30 segundos',
        'Para verificar manualmente: sudo /config/scripts/fibranexus/heartbeat.sh',
        'El scheduler Vyatta garantiza la persistencia tras reinicios',
      ],
    });
  } catch (error) {
    res.status(500).json({ error: 'Error generando script: ' + error.message });
  }
});

routersRouter.post('/test-connection', requireRole('admin'), async (req, res) => {
  try {
    const { routerUser, routerPass } = req.body;
    if (!routerUser || !routerPass) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }
    const { testRouterConnectionRaw } = await import('../lib/routerClient.js');
    const result = await testRouterConnectionRaw(req.body);
    res.json(result);
  } catch (error) {
    res.status(503).json({ error: 'No se pudo conectar: ' + error.message });
  }
});

// Endpoint idempotente: devuelve el token existente si lo hay.
// Solo genera uno nuevo si: (a) el router no tiene token, o (b) force=true enviado explícitamente.
// force=true requiere confirmación del usuario en el frontend antes de llamarse.
routersRouter.post('/:id/token', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const routerId = parseInt(req.params.id);
    const [router] = await db.select().from(equipment).where(
      and(eq(equipment.id, routerId), orgFilter(equipment, orgId)),
    ).limit(1);
    if (!router) return res.status(404).json({ error: 'Router no encontrado' });

    const existingToken = router.credentials?.agentToken;
    const force = req.body?.force === true;

    // Sin token existente → generar uno (primera vez)
    if (!existingToken) {
      const newToken = crypto.randomUUID();
      const updatedCreds = { ...(router.credentials || {}), agentToken: newToken };
      await db.update(equipment)
        .set({ credentials: updatedCreds, updatedAt: new Date() })
        .where(eq(equipment.id, router.id));
      console.log(`[token] router ${routerId} token generado (nuevo)`);
      return res.json({ agentToken: newToken, created: true });
    }

    // Token existente + sin force → devolver el mismo, NUNCA sobreescribir
    if (!force) {
      return res.json({ agentToken: existingToken, created: false });
    }

    // Token existente + force=true (usuario confirmó explícitamente en UI) → regenerar
    const newToken = crypto.randomUUID();
    const updatedCreds = { ...(router.credentials || {}), agentToken: newToken };
    await db.update(equipment)
      .set({ credentials: updatedCreds, updatedAt: new Date() })
      .where(eq(equipment.id, router.id));
    console.log(`[token] router ${routerId} token REGENERADO por solicitud explícita`);
    res.json({ agentToken: newToken, created: true });
  } catch (error) {
    res.status(500).json({ error: 'Error generando token: ' + error.message });
  }
});

routersRouter.get('/:id/mikrotik-script', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const routerId = parseInt(req.params.id);
    const routers = await db.select().from(equipment).where(
      and(eq(equipment.id, routerId), orgFilter(equipment, orgId)),
    );
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
    res.json({
      script: heartbeatScript,
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
