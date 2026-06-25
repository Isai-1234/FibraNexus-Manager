/**
 * Constructores de comandos Vyatta CLI para EdgeOS.
 * Los scripts se entregan al EdgeRouter a través del canal heartbeat (pull model).
 */
import crypto from 'crypto';

/** Parsea IP/CIDR y retorna componentes de red */
export function parseCidr(ipCidr) {
  const [ip, maskStr] = ipCidr.trim().split('/');
  if (!ip || maskStr === undefined) throw new Error(`Formato inválido "${ipCidr}" — usa IP/máscara (ej: 192.168.100.1/24)`);
  const maskBits = parseInt(maskStr || '24', 10);
  if (isNaN(maskBits) || maskBits < 0 || maskBits > 32) throw new Error(`Máscara inválida "/${maskStr}" — debe ser /0 a /32`);
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`IP inválida "${ip}" — cada octeto debe ser 0–255`);
  }
  const ipNum = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const mask = maskBits === 32 ? 0xffffffff : (~((0xffffffff >>> maskBits) | 0)) >>> 0;
  const netNum = (ipNum & mask) >>> 0;
  const bcastNum = (netNum | (~mask >>> 0)) >>> 0;
  const toIp = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  return {
    ip,
    subnet: `${toIp(netNum)}/${maskBits}`,
    networkAddress: toIp(netNum),
    broadcastAddress: toIp(bcastNum),
    gateway: ip,
    poolStart: toIp(netNum + 10),
    poolEnd: toIp(bcastNum - 1),
    maskBits,
  };
}

/** Vyatta config para crear una interfaz + DHCP opcional */
export function buildNetworkScript({ iface, ipCidr, description = '', dhcp = true, poolStart, poolEnd, dnsServers = ['8.8.8.8', '8.8.4.4'] }) {
  const net = parseCidr(ipCidr);
  const sharedName = `FN-${iface.replace(/\//g, '-').toUpperCase()}`;
  const ps = poolStart || net.poolStart;
  const pe = poolEnd || net.poolEnd;
  const lines = [
    'source /opt/vyatta/etc/functions/script-template',
    'configure',
    `set interfaces ethernet ${iface} address ${ipCidr}`,
  ];
  if (description) lines.push(`set interfaces ethernet ${iface} description '${description.replace(/'/g, '')}'`);
  if (dhcp) {
    lines.push(
      `set service dhcp-server shared-network-name ${sharedName} authoritative enable`,
      `set service dhcp-server shared-network-name ${sharedName} subnet ${net.subnet} default-router ${net.gateway}`,
      `set service dhcp-server shared-network-name ${sharedName} subnet ${net.subnet} lease 86400`,
      `set service dhcp-server shared-network-name ${sharedName} subnet ${net.subnet} start ${ps} stop ${pe}`,
    );
    for (const dns of dnsServers) {
      lines.push(`set service dhcp-server shared-network-name ${sharedName} subnet ${net.subnet} dns-server ${dns}`);
    }
  }
  lines.push('commit', 'save', 'exit');
  return lines.join('\n');
}

/** Vyatta config para eliminar una interfaz y su DHCP */
export function buildDeleteNetworkScript({ iface }) {
  const sharedName = `FN-${iface.replace(/\//g, '-').toUpperCase()}`;
  return [
    'source /opt/vyatta/etc/functions/script-template',
    'configure',
    `delete interfaces ethernet ${iface} address`,
    `delete service dhcp-server shared-network-name ${sharedName}`,
    'commit', 'save', 'exit',
  ].join('\n');
}

/**
 * Vyatta config para agregar Simple Queue por IP (equivalente MikroTik).
 * Usa traffic-policy shaper (download, egreso) + limiter (upload, ingreso).
 * ClassId derivado del serviceId para ser único y reproducible.
 */
export function buildAddQueueScript({ iface, serviceId, clientIp, downloadMbps, uploadMbps, clientName = '' }) {
  const classId = (Math.abs(serviceId) % 4090) + 2; // rango válido EdgeOS: 2-4091
  const dlPolicy = `FN-DL-${iface}`;
  const ulPolicy = `FN-UL-${iface}`;
  const matchId = `fn-s${serviceId}`;
  const desc = `FN-S${serviceId} ${clientName}`.slice(0, 64).replace(/'/g, '');
  return [
    'source /opt/vyatta/etc/functions/script-template',
    'configure',
    // --- Download shaper (router → cliente) ---
    `set traffic-policy shaper ${dlPolicy} bandwidth 1000mbit`,
    `set traffic-policy shaper ${dlPolicy} default bandwidth 100%`,
    `set traffic-policy shaper ${dlPolicy} class ${classId} bandwidth ${downloadMbps}mbit`,
    `set traffic-policy shaper ${dlPolicy} class ${classId} ceiling ${downloadMbps}mbit`,
    `set traffic-policy shaper ${dlPolicy} class ${classId} description '${desc}'`,
    `set traffic-policy shaper ${dlPolicy} class ${classId} match ${matchId} ip destination address ${clientIp}/32`,
    // --- Upload limiter (cliente → router) ---
    `set traffic-policy limiter ${ulPolicy} default bandwidth 1000mbit`,
    `set traffic-policy limiter ${ulPolicy} class ${classId} bandwidth ${uploadMbps}mbit`,
    `set traffic-policy limiter ${ulPolicy} class ${classId} ceiling ${uploadMbps}mbit`,
    `set traffic-policy limiter ${ulPolicy} class ${classId} description '${desc}'`,
    `set traffic-policy limiter ${ulPolicy} class ${classId} match ${matchId} ip source address ${clientIp}/32`,
    // Aplicar políticas a la interfaz (idempotente)
    `set interfaces ethernet ${iface} traffic-policy out ${dlPolicy}`,
    `set interfaces ethernet ${iface} traffic-policy in ${ulPolicy}`,
    'commit', 'save', 'exit',
  ].join('\n');
}

/** Vyatta config para eliminar la queue de un abonado */
export function buildRemoveQueueScript({ iface, serviceId }) {
  const classId = (Math.abs(serviceId) % 4090) + 2;
  const dlPolicy = `FN-DL-${iface}`;
  const ulPolicy = `FN-UL-${iface}`;
  return [
    'source /opt/vyatta/etc/functions/script-template',
    'configure',
    `delete traffic-policy shaper ${dlPolicy} class ${classId}`,
    `delete traffic-policy limiter ${ulPolicy} class ${classId}`,
    'commit', 'save', 'exit',
  ].join('\n');
}

/** Número base de reglas FORWARD por servicio (evita colisiones entre abonados) */
export function suspendRuleBase(serviceId) {
  return 5000 + (Math.abs(serviceId) % 3500) * 10;
}

/**
 * Walled garden en EdgeRouter: bloquea tráfico del abonado salvo DNS y portal de pago.
 * No toca el router del nodo ni las colas de ancho de banda.
 */
export function buildSuspendClientScript({ serviceId, clientIp, portalHostIps = [] }) {
  const base = suspendRuleBase(serviceId);
  const lines = [
    'source /opt/vyatta/etc/functions/script-template',
    'configure',
    `set firewall name FORWARD rule ${base} action accept`,
    `set firewall name FORWARD rule ${base} source address ${clientIp}/32`,
    `set firewall name FORWARD rule ${base} protocol udp`,
    `set firewall name FORWARD rule ${base} destination port 53`,
    `set firewall name FORWARD rule ${base + 1} action accept`,
    `set firewall name FORWARD rule ${base + 1} source address ${clientIp}/32`,
    `set firewall name FORWARD rule ${base + 1} protocol tcp`,
    `set firewall name FORWARD rule ${base + 1} destination port 53`,
  ];
  let idx = 2;
  for (const ip of portalHostIps.slice(0, 6)) {
    lines.push(
      `set firewall name FORWARD rule ${base + idx} action accept`,
      `set firewall name FORWARD rule ${base + idx} source address ${clientIp}/32`,
      `set firewall name FORWARD rule ${base + idx} destination address ${ip}/32`,
    );
    idx += 1;
  }
  lines.push(
    `set firewall name FORWARD rule ${base + idx} action accept`,
    `set firewall name FORWARD rule ${base + idx} source address ${clientIp}/32`,
    `set firewall name FORWARD rule ${base + idx} protocol tcp`,
    `set firewall name FORWARD rule ${base + idx} destination port 443`,
    `set firewall name FORWARD rule ${base + idx + 1} action drop`,
    `set firewall name FORWARD rule ${base + idx + 1} source address ${clientIp}/32`,
    'commit', 'save', 'exit',
  );
  return lines.join('\n');
}

/** Quita reglas de suspensión del abonado en EdgeRouter */
export function buildReactivateClientScript({ serviceId }) {
  const base = suspendRuleBase(serviceId);
  const lines = [
    'source /opt/vyatta/etc/functions/script-template',
    'configure',
  ];
  for (let r = base; r <= base + 9; r += 1) {
    lines.push(`delete firewall name FORWARD rule ${r}`);
  }
  lines.push('commit', 'save', 'exit');
  return lines.join('\n');
}

/** Empaqueta un script como pendingCmd para almacenar en credentials JSONB */
export function makePendingCmd(type, script, meta = {}, { maxRetries = 3 } = {}) {
  return {
    id: crypto.randomUUID(),
    type,
    script,
    meta,
    createdAt: new Date().toISOString(),
    status: 'pending',
    retries: 0,
    maxRetries,
    nextRetryAt: null,
  };
}
