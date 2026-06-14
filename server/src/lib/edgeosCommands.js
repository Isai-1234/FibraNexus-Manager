/**
 * Constructores de comandos Vyatta CLI para EdgeOS.
 * Los scripts se entregan al EdgeRouter a través del canal heartbeat (pull model).
 */
import crypto from 'crypto';

/** Parsea IP/CIDR y retorna componentes de red */
export function parseCidr(ipCidr) {
  const [ip, maskStr] = ipCidr.trim().split('/');
  const maskBits = parseInt(maskStr || '24', 10);
  const parts = ip.split('.').map(Number);
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
    'configure',
    `delete traffic-policy shaper ${dlPolicy} class ${classId}`,
    `delete traffic-policy limiter ${ulPolicy} class ${classId}`,
    'commit', 'save', 'exit',
  ].join('\n');
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
