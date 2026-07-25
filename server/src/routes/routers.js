import { Router } from 'express';
import { db } from '../db/index.js';
import { equipment } from '../db/schema.js';
import { eq, and, ne } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId, inferConnectionMethod } from '../lib/tenant.js';
import crypto from 'crypto';
import { refreshStaleRouters } from '../lib/routerPoller.js';
import { decryptSecret } from '../lib/secrets.js';

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

function formatUptimeSec(sec) {
  const s = parseInt(sec) || 0;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function buildEdgeosHeartbeatScript(token, serverUrl) {
  const cmdResultUrl = serverUrl.replace('/agent/heartbeat', '/agent/cmd-result');
  return [
    '#!/bin/bash',
    `TOKEN="${token}"`,
    `SERVER="${serverUrl}"`,
    `CMD_RESULT="${cmdResultUrl}"`,
    'PIDFILE="/tmp/fibranexus.pid"',
    '',
    '# Evitar múltiples instancias',
    '[ -f "$PIDFILE" ] && kill $(cat "$PIDFILE") 2>/dev/null',
    'echo $$ > "$PIDFILE"',
    '',
    '# Limpiar archivos temporales al arrancar (evita problemas de permisos entre root/ubnt)',
    'sudo rm -f /tmp/fn_hb.json /tmp/fn_cmd.sh /tmp/fn_result.json /tmp/fn_agent.py /tmp/fn_snmp.py 2>/dev/null',
    '',
    'FNPY=$(command -v python3 || command -v python || command -v python2 || echo "")',
    "VER=$(cat /etc/version 2>/dev/null | head -1 | tr -d '\\n' || echo \"EdgeOS\")",
    '',
    '# Escribir agente Python una vez al iniciar (se reutiliza en cada ciclo)',
    '[ -z "$FNPY" ] || cat > /tmp/fn_agent.py << \'PYEOF\'',
    'import os, json, subprocess',
    'try:',
    '    with open("/tmp/fn_hb.json") as f: d = json.loads(f.read())',
    '    cmds = d.get("pendingCommands", [])',
    '    if not cmds: raise SystemExit(0)',
    '    cmd = cmds[0]',
    '    cmd_id, script = cmd.get("id",""), cmd.get("script","")',
    '    if not cmd_id or not script: raise SystemExit(0)',
    '    with open("/tmp/fn_cmd.sh","w") as f:',
    '        f.write("source /opt/vyatta/etc/functions/script-template\\n" + script)',
    '    p = subprocess.Popen(["/bin/vbash","/tmp/fn_cmd.sh"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)',
    '    stdout, stderr = p.communicate()',
    '    out = (stdout.decode("utf-8","ignore")+stderr.decode("utf-8","ignore"))[:300].strip()',
    '    token = os.environ.get("FN_TOKEN",""); url = os.environ.get("FN_CMD_URL","")',
    '    body = json.dumps({"agentToken":token,"cmdId":cmd_id,"success":p.returncode==0,"output":out})',
    '    with open("/tmp/fn_result.json","w") as rf: rf.write(body)',
    '    subprocess.call(["curl","-sf","--max-time","8","-X","POST",url,"-H","Content-Type: application/json","--data-binary","@/tmp/fn_result.json"])',
    'except SystemExit: pass',
    'except Exception: pass',
    'PYEOF',
    '',
    '',
    'while true; do',
    "  UPTIME=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo \"0\")",
    "  CPULINE1=$(grep '^cpu ' /proc/stat)",
    '  sleep 1',
    "  CPULINE2=$(grep '^cpu ' /proc/stat)",
    '  read -ra C1 <<< "$CPULINE1"',
    '  read -ra C2 <<< "$CPULINE2"',
    '  T1=0; for v in "${C1[@]:1}"; do T1=$((T1+v)); done',
    '  T2=0; for v in "${C2[@]:1}"; do T2=$((T2+v)); done',
    '  DT=$((T2-T1)); DI=$((C2[4]-C1[4]))',
    '  CPU=0; [ $DT -gt 0 ] && CPU=$(( 100*(DT-DI)/DT ))',
    '',
    '  # RAM usage (%)',
    '  MEM_AVAIL=$(awk \'/MemAvailable:/{print $2; exit}\' /proc/meminfo 2>/dev/null || echo 0)',
    '  MEM_TOTAL=$(awk \'/MemTotal:/{print $2; exit}\' /proc/meminfo 2>/dev/null || echo 1)',
    '  RAM_PCT=0; [ "$MEM_TOTAL" -gt 0 ] && RAM_PCT=$(( 100 * (MEM_TOTAL - MEM_AVAIL) / MEM_TOTAL ))',
    '',
    '  # Temperatura (°C) — sensor principal',
    '  TEMP_RAW=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0)',
    '  TEMP_C=$(( TEMP_RAW / 1000 ))',
    '',
    '  # Stats de interfaces desde /proc/net/dev (bytes acumulados)',
    '  IFACE_STATS=$(awk \'NR>2 && $1!~/lo:/ {gsub(/:/, "", $1); printf "%s,%s,%s;", $1, $2, $10}\' /proc/net/dev 2>/dev/null || echo "")',
    '',
    '  # Tabla ARP — entradas resueltas (flags != 0x00), formato "ip,mac;"',
    '  ARP_DATA=$(awk \'NR>1 && $3!="0x0" {print $1","$4}\' /proc/net/arp 2>/dev/null | tr \'\\n\' \';\' | head -c 1500 || echo "")',
    '',
    '  # DHCP leases activos — buscar archivo en rutas conocidas de EdgeOS',
    '  DHCP_DATA=""',
    '  for f in /var/run/dhcpd.leases /var/run/dhcpd/dhcpd.leases /var/lib/dhcp/dhcpd.leases /var/lib/dhclient/dhcpd.leases; do',
    '    [ -f "$f" ] && DHCP_DATA=$(awk \'/^lease /{ip=$2} /hardware ethernet /{mac=$3; gsub(/;/,"",mac)} /binding state active/{if(ip&&mac)printf "%s,%s;",ip,mac}\' "$f" 2>/dev/null | head -c 1500) && break',
    '  done',
    '',
    '  # SNMP poll de CPEs: uptime + métricas Ubiquiti airMAX (CCQ, señal, ruido)',
    '  SNMP_DATA=""',
    '  CPE_METRICS=""',
    '  if [ -f /tmp/fn_hb.json ] && command -v snmpget >/dev/null 2>&1; then',
    "    SNMP_TGTS=$(grep -o '\"snmpTargets\":\"[^\"]*\"' /tmp/fn_hb.json | cut -d'\"' -f4)",
    "    for T in $(echo \"$SNMP_TGTS\" | tr ';' ' '); do",
    "      IP=$(echo \"$T\" | cut -d',' -f1)",
    "      COMM=$(echo \"$T\" | cut -d',' -f2)",
    "      EID=$(echo \"$T\" | cut -d',' -f3)",
    '      [ -z "$IP" ] || [ -z "$EID" ] && continue',
    '      SNMP_UP=$(snmpget -v2c -c "$COMM" -t 2 -r 0 "$IP" 1.3.6.1.2.1.1.3.0 2>/dev/null) || SNMP_UP=$(snmpget -v1 -c "$COMM" -t 2 -r 0 "$IP" 1.3.6.1.2.1.1.3.0 2>/dev/null)',
    '      if [ -n "$SNMP_UP" ]; then',
    "        SEC=$(echo \"$SNMP_UP\" | sed -n 's/.*(\([0-9]*\)).*/\\1/p'); [ -z \"$SEC\" ] && SEC=0",
    '        SNMP_DATA="${SNMP_DATA}${EID},1,${SEC};"',
    '        # Métricas Ubiquiti airMAX: sig,noise,ccq,cinr,tx,rx — v2c primero, v1 fallback',
        '        _M=$(snmpget -v2c -c "$COMM" -t 2 -r 0 -Oqv "$IP" .1.3.6.1.4.1.41112.1.4.5.1.5.1 .1.3.6.1.4.1.41112.1.4.5.1.8.1 .1.3.6.1.4.1.41112.1.4.5.1.7.1 .1.3.6.1.4.1.41112.1.4.5.1.14.1 .1.3.6.1.4.1.41112.1.4.5.1.9.1 .1.3.6.1.4.1.41112.1.4.5.1.10.1 2>/dev/null) || _M=$(snmpget -v1 -c "$COMM" -t 2 -r 0 -Oqv "$IP" .1.3.6.1.4.1.41112.1.4.5.1.5.1 .1.3.6.1.4.1.41112.1.4.5.1.8.1 .1.3.6.1.4.1.41112.1.4.5.1.7.1 .1.3.6.1.4.1.41112.1.4.5.1.14.1 .1.3.6.1.4.1.41112.1.4.5.1.9.1 .1.3.6.1.4.1.41112.1.4.5.1.10.1 2>/dev/null)',
    "        _SIG=$(echo \"$_M\" | sed -n '1p' | grep -oE '^-?[0-9]+')",
    "        _NOISE=$(echo \"$_M\" | sed -n '2p' | grep -oE '^-?[0-9]+')",
    "        _CCQ=$(echo \"$_M\" | sed -n '3p' | grep -oE '^[0-9]+')",
    "        _CINR=$(echo \"$_M\" | sed -n '4p' | grep -oE '^-?[0-9]+')",
    "        _TXKBPS=$(echo \"$_M\" | sed -n '5p' | grep -oE '^[0-9]+')",
    "        _RXKBPS=$(echo \"$_M\" | sed -n '6p' | grep -oE '^[0-9]+')",
    '        [ -n "$_SIG" ] && [ "$_SIG" != "0" ] && CPE_METRICS="${CPE_METRICS}${EID},${_SIG},${_NOISE:-0},${_CCQ:-0},${_CINR:-0},${_TXKBPS:-0},${_RXKBPS:-0};"',
    '      else',
    '        SNMP_DATA="${SNMP_DATA}${EID},0,0;"',
    '      fi',
    '    done',
    '    SNMP_DATA="${SNMP_DATA%;}"',
    '    CPE_METRICS="${CPE_METRICS%;}"',
    '  fi',
    '',
    '  RESPONSE=$(curl -sf --max-time 8 -X POST "$SERVER" \\',
    '    -H "Content-Type: application/json" \\',
    '    -d "{\\"agentToken\\":\\"$TOKEN\\",\\"routerInfo\\":{\\"version\\":\\"$VER\\",\\"uptime\\":\\"${UPTIME}s\\",\\"cpuLoad\\":$CPU,\\"hostName\\":\\"$(hostname)\\",\\"ramUsage\\":$RAM_PCT,\\"tempC\\":$TEMP_C},\\"ifaceStats\\":\\"${IFACE_STATS}\\",\\"arpData\\":\\"${ARP_DATA}\\",\\"dhcpData\\":\\"${DHCP_DATA}\\",\\"snmpData\\":\\"${SNMP_DATA}\\",\\"cpeMetrics\\":\\"${CPE_METRICS}\\"}")',
    '',
    '  if [ -n "$RESPONSE" ]; then',
    '    echo "$RESPONSE" | sudo tee /tmp/fn_hb.json > /dev/null',
    '    sudo rm -f /tmp/fn_cmd.sh /tmp/fn_result.json 2>/dev/null',
    '    [ -z "$FNPY" ] || FN_TOKEN="$TOKEN" FN_CMD_URL="$CMD_RESULT" "$FNPY" /tmp/fn_agent.py',
    '  fi',
    '  sleep 27',
    'done',
  ].join('\n');
}

function buildEdgeosInstallScript(heartbeatScript) {
  return `# === FibraNexus — Instalar monitor en EdgeRouter (pegar en SSH, ejecutar una vez) ===
sudo mkdir -p /config/scripts/fibranexus /config/scripts/post-config.d

sudo tee /config/scripts/fibranexus/heartbeat.sh > /dev/null << 'FNHB'
${heartbeatScript}
FNHB

sudo chmod +x /config/scripts/fibranexus/heartbeat.sh

# Auto-arranque al boot via post-config.d (sin depender de task-scheduler)
sudo tee /config/scripts/post-config.d/fibranexus-start.sh > /dev/null << 'FNBOOT'
#!/bin/bash
/bin/bash /config/scripts/fibranexus/heartbeat.sh &
FNBOOT
sudo chmod +x /config/scripts/post-config.d/fibranexus-start.sh

# Iniciar daemon (mata instancia anterior si existe)
sudo kill \$(cat /tmp/fibranexus.pid 2>/dev/null) 2>/dev/null
sudo nohup /bin/bash /config/scripts/fibranexus/heartbeat.sh >/dev/null 2>&1 &
echo "FibraNexus iniciado — verifica el dashboard en ~30 segundos."`;
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
    const { sanitizeEquipmentRow } = await import('../lib/secrets.js');
    const routersWithStatus = refreshed.map(r => {
      const agent = connectedAgents.get(r.id.toString());
      const connectionMethod = inferConnectionMethod(r);
      const agentConnected = (agent != null && Date.now() - new Date(agent.lastSeen).getTime() < 120_000)
        || (r.credentials?.lastHeartbeat
          ? Date.now() - new Date(r.credentials.lastHeartbeat).getTime() < 120_000
          : r.status === 'online');
      const safe = sanitizeEquipmentRow(r);
      return {
        ...safe,
        status: agentConnected ? 'online' : r.status,
        connectionMethod,
        hasApiCredentials: !!(r.credentials?.routerUser && r.credentials?.routerPass),
        agentConnected,
        agentLastSeen: agent?.lastSeen || r.credentials?.lastHeartbeat || r.lastSeen || null,
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
    const { encryptCredentialsObject, encryptSecret, sanitizeEquipmentRow } = await import('../lib/secrets.js');
    const { assertWithinRouterLimit } = await import('../lib/orgLimits.js');
    await assertWithinRouterLimit(req.organization || { id: orgId, maxRouters: 5 });

    const credentials = encryptCredentialsObject({
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
    });
    const [router] = await db.insert(equipment).values({
      organizationId: orgId,
      name,
      type: 'router',
      brand: brand || (routerType?.startsWith('edgerouter') ? 'Ubiquiti' : routerType),
      model: model || 'Unknown',
      ipAddress: method === 'cloudflare_tunnel' ? (tunnelHostname || routerIp || null) : (routerIp || tunnelHostname || null),
      location,
      status: 'offline',
      snmpCommunity: snmpCommunity ? encryptSecret(snmpCommunity) : null,
      credentials,
    }).returning();

    const { writeAuditLog, clientIp } = await import('../lib/auditLog.js');
    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'router.create',
      entity: 'equipment',
      entityId: router.id,
      ipAddress: clientIp(req),
    });

    // agentToken solo en creación (one-shot)
    res.status(201).json({ ...sanitizeEquipmentRow(router), agentToken });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Error al registrar router' });
  }
});

export async function agentHeartbeatHandler(req, res) {
  try {
    const { agentToken, routerInfo, ifaceStats, arpData, dhcpData, snmpData, cpeMetrics } = req.body;
    if (!agentToken) return res.status(403).json({ error: 'Token de agente requerido' });
    const allRouters = await db.select().from(equipment).where(eq(equipment.type, 'router'));
    const router = allRouters.find(r => r.credentials && r.credentials.agentToken === agentToken);
    if (!router) return res.status(403).json({ error: 'Token de agente inválido' });

    const updates = { status: 'online', lastSeen: new Date() };
    if (routerInfo?.version) updates.firmware = String(routerInfo.version).slice(0, 50);

    // Parsear ifaceStats: "eth0,rxBytes,txBytes;eth2,rxBytes,txBytes;"
    let parsedIfaces = [];
    let bwSamples = router.credentials?.bandwidthSamples || [];
    if (ifaceStats) {
      const now = Date.now();
      parsedIfaces = String(ifaceStats).split(';').filter(Boolean).map(part => {
        const [iface, rx, tx] = part.split(',');
        return { iface, rx: Number(rx) || 0, tx: Number(tx) || 0 };
      });
      const prev = router.credentials?.lastIfaceStats || [];
      const sample = { ts: now, ifaces: parsedIfaces.map(cur => {
        const p = prev.find(x => x.iface === cur.iface);
        const dtSec = p ? Math.max(1, (now - (router.credentials?.lastIfaceTs || now - 28000)) / 1000) : 28;
        return { iface: cur.iface, rxBps: p ? Math.round((cur.rx - p.rx) / dtSec) : 0, txBps: p ? Math.round((cur.tx - p.tx) / dtSec) : 0 };
      }) };
      bwSamples = [...bwSamples.slice(-59), sample];
    }

    // Parsear tabla ARP y DHCP leases enviados por el agente ("ip,mac;ip,mac;...")
    function parseIpMacTable(str) {
      if (!str) return null;
      const entries = String(str).split(';').filter(Boolean).map(e => {
        const [ip, mac] = e.split(',');
        return ip && mac ? { ip: ip.trim(), mac: mac.trim() } : null;
      }).filter(Boolean);
      return entries.length ? entries : null;
    }

    // lastHeartbeat persiste en BD — sobrevive reinicios del servidor
    const creds = {
      ...router.credentials,
      lastRouterInfo: routerInfo || null,
      lastHeartbeat: new Date().toISOString(),
      lastIfaceStats: parsedIfaces.length ? parsedIfaces : (router.credentials?.lastIfaceStats || []),
      lastIfaceTs: parsedIfaces.length ? Date.now() : (router.credentials?.lastIfaceTs || null),
      bandwidthSamples: bwSamples,
      heartbeatArp: parseIpMacTable(arpData) ?? router.credentials?.heartbeatArp ?? null,
      heartbeatDhcp: parseIpMacTable(dhcpData) ?? router.credentials?.heartbeatDhcp ?? null,
    };
    if (creds.connectionMethod === 'agent' && String(creds.routerType || '').startsWith('mikrotik') && routerInfo?.version) {
      creds.connectionMethod = 'cloudflare_tunnel';
    } else if (!creds.connectionMethod) {
      creds.connectionMethod = inferConnectionMethod({ ...router, credentials: creds });
    }
    await db.update(equipment).set({ ...updates, credentials: creds }).where(eq(equipment.id, router.id));
    connectedAgents.set(router.id.toString(), { routerId: router.id, lastSeen: new Date(), routerInfo });

    // Retornar comandos listos (pendientes o con retry vencido)
    const now = Date.now();
    const allPendingCmds = creds.pendingCmds || [];
    const pending = allPendingCmds.filter(c =>
      c.status === 'pending' && (!c.nextRetryAt || new Date(c.nextRetryAt).getTime() <= now),
    );
    const toSend = pending.slice(0, 3).map(c => ({ id: c.id, script: c.script }));

    console.log(`[heartbeat] router=${router.id} (${router.name}) siteId=${router.siteId} cola_total=${allPendingCmds.length} listos=${pending.length} enviando=${toSend.length}`);
    if (toSend.length > 0) {
      const fullCmds = allPendingCmds.filter(c => toSend.some(s => s.id === c.id));
      fullCmds.forEach(c => console.log(`[heartbeat] → dispatch id=${c.id} type=${c.type} retries=${c.retries || 0}/${c.maxRetries || 3} meta=${JSON.stringify(c.meta || {})}`));
    }

    // Procesar resultados SNMP enviados por el agente: "id,online,uptimeSec;..."
    if (snmpData) {
      const entries = String(snmpData).split(';').filter(Boolean);
      for (const entry of entries) {
        const [idStr, onlineStr, uptimeStr] = entry.split(',');
        const equipId = parseInt(idStr);
        if (!equipId) continue;
        const online = onlineStr === '1';
        const lastSnmpPatch = {
          polledAt: new Date().toISOString(),
          pollMethod: 'edgerouter-heartbeat',
          online,
          uptime: online ? formatUptimeSec(uptimeStr) : null,
        };
        const [cpe] = await db.select().from(equipment).where(eq(equipment.id, equipId)).limit(1);
        if (!cpe) continue;
        await db.update(equipment).set({
          status: online ? 'online' : 'offline',
          ...(online ? { lastSeen: new Date() } : {}),
          credentials: { ...(cpe.credentials || {}), lastSnmp: lastSnmpPatch },
          updatedAt: new Date(),
        }).where(eq(equipment.id, equipId));
        console.log(`[heartbeat-snmp] router=${router.id} equipo=${equipId} online=${online} uptime=${uptimeStr}s`);
      }
    }

    // ARP-based status: CPEs cuya MAC está en la tabla ARP del EdgeRouter → online
    // Funciona sin SNMP — el ARP es suficiente para confirmar presencia en LAN
    if (router.siteId && Array.isArray(creds.heartbeatArp) && creds.heartbeatArp.length > 0) {
      const normMac = (m) => String(m || '').toLowerCase().replace(/[^0-9a-f]/g, '');
      const siteCpes = await db.select().from(equipment).where(
        and(eq(equipment.siteId, router.siteId), ne(equipment.type, 'router')),
      );
      for (const cpe of siteCpes) {
        if (!cpe.macAddress) continue;
        const cpeMac = normMac(cpe.macAddress);
        const arpEntry = creds.heartbeatArp.find(a => normMac(a.mac) === cpeMac);
        if (!arpEntry) continue;
        const prevSnmp = cpe.credentials?.lastSnmp || {};
        const lastSnmpPatch = {
          ...prevSnmp,
          polledAt: new Date().toISOString(),
          pollMethod: 'edgerouter-arp',
          online: true,
        };
        await db.update(equipment).set({
          status: 'online',
          lastSeen: new Date(),
          credentials: { ...(cpe.credentials || {}), lastSnmp: lastSnmpPatch },
          updatedAt: new Date(),
        }).where(eq(equipment.id, cpe.id));
        console.log(`[heartbeat-arp] router=${router.id} equipo=${cpe.id} (${cpe.name}) online via ARP mac=${cpe.macAddress}`);
      }
    }

    // Procesar métricas Ubiquiti airMAX enviadas por el agente EdgeRouter
    console.log(`[heartbeat-cpe] router=${router.id} cpeMetrics="${cpeMetrics ?? '(no enviado)'}"`);
    if (cpeMetrics) {
      const { deviceMetrics } = await import('../db/schema.js');
      const metricEntries = String(cpeMetrics).split(';').filter(Boolean);
      for (const entry of metricEntries) {
        const [eidStr, sig, noise, ccq, cinr, txKbps, rxKbps] = entry.split(',').map(Number);
        if (!eidStr || sig === 0) continue;
        const [cpe] = await db.select({ id: equipment.id, credentials: equipment.credentials })
          .from(equipment).where(eq(equipment.id, eidStr)).limit(1);
        if (!cpe) continue;
        await db.insert(deviceMetrics).values({
          equipmentId: cpe.id, signal: sig, noise, cinr, txCcq: ccq, txRate: txKbps, rxRate: rxKbps, source: 'heartbeat',
        });
        await db.update(equipment).set({
          credentials: { ...(cpe.credentials || {}), lastMetrics: { signal: sig, noise, cinr, txCcq: ccq, txRate: txKbps, rxRate: rxKbps, ts: new Date().toISOString() } },
          updatedAt: new Date(),
        }).where(eq(equipment.id, cpe.id));
        console.log(`[heartbeat-metrics] router=${router.id} cpe=${cpe.id} sig=${sig}dBm ccq=${ccq}% cinr=${cinr}dB`);
      }
    }

    // Construir snmpTargets: todos los CPEs de la org con IP + snmpCommunity
    // No filtramos por site — el router sabe por red qué IPs alcanza
    let snmpTargets = '';
    {
      const cpes = await db.select({
        id: equipment.id,
        ipAddress: equipment.ipAddress,
        snmpCommunity: equipment.snmpCommunity,
      }).from(equipment).where(
        and(eq(equipment.organizationId, router.organizationId), ne(equipment.type, 'router')),
      );
      const pollable = cpes.filter(c => c.ipAddress?.trim() && c.snmpCommunity?.trim());
      snmpTargets = pollable
        .map((c) => {
          try {
            const community = decryptSecret(c.snmpCommunity)?.trim();
            return community ? `${c.ipAddress.trim().split('/')[0]},${community},${c.id}` : null;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .join(';');
      console.log(`[heartbeat-snmp-targets] router=${router.id} org=${router.organizationId} cpes_total=${cpes.length} pollable=${pollable.length}`);
    }

    res.json({ status: 'ok', routerId: router.id, routerName: router.name, pendingCommands: toSend, snmpTargets });
  } catch (error) {
    res.status(500).json({ error: 'Error en heartbeat: ' + error.message });
  }
}

// EdgeRouter reporta resultado de un comando ejecutado (sin auth JWT, identificado por agentToken)
export async function agentCmdResultHandler(req, res) {
  try {
    const { agentToken, cmdId, success, output } = req.body;
    if (!agentToken || !cmdId) return res.status(400).json({ error: 'agentToken y cmdId requeridos' });

    const allRouters = await db.select().from(equipment).where(eq(equipment.type, 'router'));
    const router = allRouters.find(r => r.credentials?.agentToken === agentToken);
    if (!router) return res.status(403).json({ error: 'Token inválido' });

    console.log(`[cmd-result] router=${router.id} (${router.name}) cmdId=${cmdId} success=${success} output="${String(output || '').slice(0, 300)}"`);

    const creds = router.credentials || {};
    const allPending = creds.pendingCmds || [];
    const done = allPending.find(c => c.id === cmdId);

    if (!done) {
      console.warn(`[cmd-result] cmdId=${cmdId} desconocido o ya procesado — ignorando`);
      return res.json({ ok: true, ignored: true });
    }

    let newPending;
    let historyEntry = null;

    if (success) {
      // Éxito → sacar de pendientes, mover a historial
      newPending = allPending.filter(c => c.id !== cmdId);
      historyEntry = { ...done, status: 'done', output: String(output || '').slice(0, 300), executedAt: new Date().toISOString() };
    } else {
      // Fallo → reintentar con backoff exponencial
      const retries = (done.retries || 0) + 1;
      const maxRetries = done.maxRetries ?? 3;
      if (retries >= maxRetries) {
        // Agotados los reintentos → historial con status 'error'
        newPending = allPending.filter(c => c.id !== cmdId);
        historyEntry = { ...done, status: 'error', retries, output: String(output || '').slice(0, 300), executedAt: new Date().toISOString() };
        console.warn(`[cmd-result] cmd ${cmdId} type=${done.type} falló ${retries}/${maxRetries} veces — descartado`);
      } else {
        // Programar reintento: 60s * 2^(retries-1) → 60s, 120s, 240s
        const delayMs = 60_000 * Math.pow(2, retries - 1);
        const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
        newPending = allPending.map(c => c.id === cmdId
          ? { ...c, retries, maxRetries, nextRetryAt, lastError: String(output || '').slice(0, 150) }
          : c,
        );
        console.log(`[cmd-result] cmd ${cmdId} type=${done.type} fallo ${retries}/${maxRetries} — reintento en ${delayMs / 1000}s`);
      }
    }

    const history = [...(creds.cmdHistory || []).slice(-49), ...(historyEntry ? [historyEntry] : [])];

    await db.update(equipment).set({
      credentials: { ...creds, pendingCmds: newPending, cmdHistory: history },
      updatedAt: new Date(),
    }).where(eq(equipment.id, router.id));

    // Actualizar estado de queue / suspensión en clientServices si aplica
    if (done?.meta?.serviceId) {
      const { clientServices } = await import('../db/schema.js');
      const [svc] = await db.select().from(clientServices).where(eq(clientServices.id, done.meta.serviceId)).limit(1);
      if (svc?.networkMeta?.edgeosQueue?.cmdId === cmdId) {
        const queueUpdate = done.type === 'queue_remove'
          ? null
          : { ...svc.networkMeta.edgeosQueue, status: success ? 'active' : 'error', appliedAt: new Date().toISOString() };
        await db.update(clientServices).set({
          networkMeta: { ...svc.networkMeta, edgeosQueue: queueUpdate },
          updatedAt: new Date(),
        }).where(eq(clientServices.id, done.meta.serviceId));
      } else if (svc?.networkMeta?.suspendState?.cmdId === cmdId) {
        if (done.type === 'reactivate_client' && success) {
          const meta = { ...svc.networkMeta };
          delete meta.suspendState;
          await db.update(clientServices).set({ networkMeta: meta, updatedAt: new Date() }).where(eq(clientServices.id, done.meta.serviceId));
        } else {
          const suspendState = {
            ...svc.networkMeta.suspendState,
            status: success ? (done.type === 'reactivate_client' ? 'removing' : 'active') : 'error',
          };
          if (success && done.type === 'suspend_client') suspendState.appliedAt = new Date().toISOString();
          await db.update(clientServices).set({
            networkMeta: { ...svc.networkMeta, suspendState },
            updatedAt: new Date(),
          }).where(eq(clientServices.id, done.meta.serviceId));
        }
      }
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// GET /api/routers/agent/heartbeat-script?token=AGENT_TOKEN
// Permite que el EdgeRouter descargue su propio heartbeat.sh via curl sin necesidad de paste
routersRouter.get('/agent/heartbeat-script', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send('token requerido');
    const allRouters = await db.select().from(equipment).where(eq(equipment.type, 'router'));
    const router = allRouters.find(r => r.credentials?.agentToken === token);
    if (!router) return res.status(403).send('token invalido');
    const serverUrl = `${serverBaseUrl()}/api/routers/agent/heartbeat`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(buildEdgeosHeartbeatScript(token, serverUrl));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

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
    const { connectionMethod, tunnelHostname, location, name, routerUser, routerPass, routerPort, parentRouterId, tunnelToken } = req.body;
    const { encryptSecret, encryptCredentialsObject, sanitizeEquipmentRow } = await import('../lib/secrets.js');
    const creds = { ...router.credentials };
    if (connectionMethod) creds.connectionMethod = connectionMethod;
    if (tunnelHostname) creds.tunnelHostname = tunnelHostname;
    if (routerUser !== undefined) creds.routerUser = routerUser || null;
    // Solo actualizar password si el cliente envía un valor no vacío (no precargar)
    if (routerPass !== undefined && routerPass !== null && String(routerPass).length > 0) {
      creds.routerPass = encryptSecret(routerPass);
    }
    if (tunnelToken !== undefined && tunnelToken !== null && String(tunnelToken).length > 0) {
      creds.tunnelToken = encryptSecret(tunnelToken);
    }
    if (routerPort) creds.routerPort = routerPort;
    if (parentRouterId !== undefined) {
      if (parentRouterId) creds.parentRouterId = parseInt(parentRouterId, 10);
      else delete creds.parentRouterId;
    }
    if (router.credentials?.agentToken) creds.agentToken = router.credentials.agentToken;
    if (router.credentials?.lastHeartbeat) creds.lastHeartbeat = router.credentials.lastHeartbeat;
    if (router.credentials?.lastRouterInfo) creds.lastRouterInfo = router.credentials.lastRouterInfo;
    const updates = { credentials: encryptCredentialsObject(creds), updatedAt: new Date() };
    if (location !== undefined) updates.location = location;
    if (name !== undefined) updates.name = name;
    if (tunnelHostname !== undefined) updates.ipAddress = tunnelHostname || router.ipAddress;
    const [updated] = await db.update(equipment).set(updates).where(eq(equipment.id, routerId)).returning();
    res.json(sanitizeEquipmentRow(updated));
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
        'Conéctate al EdgeRouter por SSH: ssh ubnt@IP_DEL_EDGEROUTER',
        'Pega el script de instalación completo en la terminal SSH y presiona Enter',
        'El router enviará heartbeat cada 28s — aparecerá como "Conectado" en ~30 segundos',
        'Para verificar estado: sudo kill -0 $(cat /tmp/fibranexus.pid 2>/dev/null) && echo "daemon activo"',
        'Persiste tras reinicios via /config/scripts/post-config.d/fibranexus-start.sh',
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

// Rotación / creación de agentToken. El token en claro solo se devuelve al crear o con force=true.
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
    const { writeAuditLog, clientIp } = await import('../lib/auditLog.js');
    const { redactToken } = await import('../lib/secrets.js');

    if (!existingToken) {
      const newToken = crypto.randomUUID();
      const rotatedAt = new Date().toISOString();
      const updatedCreds = {
        ...(router.credentials || {}),
        agentToken: newToken,
        agentTokenRotatedAt: rotatedAt,
        agentTokenRotatedBy: req.user.id,
      };
      await db.update(equipment)
        .set({ credentials: updatedCreds, updatedAt: new Date() })
        .where(eq(equipment.id, router.id));
      await writeAuditLog({
        organizationId: orgId,
        userId: req.user.id,
        action: 'router.agent_token_create',
        entity: 'equipment',
        entityId: routerId,
        details: { tokenPreview: redactToken(newToken) },
        ipAddress: clientIp(req),
      });
      return res.json({ agentToken: newToken, created: true, rotatedAt });
    }

    if (!force) {
      return res.json({
        hasAgentToken: true,
        created: false,
        agentTokenRotatedAt: router.credentials?.agentTokenRotatedAt || null,
        message: 'Token existente. Envía force=true para rotar (invalidará el agente actual).',
      });
    }

    const newToken = crypto.randomUUID();
    const rotatedAt = new Date().toISOString();
    const updatedCreds = {
      ...(router.credentials || {}),
      agentToken: newToken,
      agentTokenRotatedAt: rotatedAt,
      agentTokenRotatedBy: req.user.id,
    };
    await db.update(equipment)
      .set({ credentials: updatedCreds, updatedAt: new Date() })
      .where(eq(equipment.id, router.id));
    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'router.agent_token_rotate',
      entity: 'equipment',
      entityId: routerId,
      details: { tokenPreview: redactToken(newToken), force: true },
      ipAddress: clientIp(req),
    });
    res.json({ agentToken: newToken, created: true, rotatedAt });
  } catch (error) {
    res.status(500).json({ error: 'Error generando token' });
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
    let token = router.credentials?.agentToken;
    if (!token) {
      token = crypto.randomUUID();
      const updatedCreds = { ...(router.credentials || {}), agentToken: token };
      await db.update(equipment).set({ credentials: updatedCreds, updatedAt: new Date() })
        .where(eq(equipment.id, router.id));
    }

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
