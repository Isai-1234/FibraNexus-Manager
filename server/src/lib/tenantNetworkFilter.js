import { db } from '../db/index.js';
import { clientServices, clients, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { orgFilter } from './tenant.js';

function normalizeIp(raw) {
  if (!raw) return null;
  const ip = String(raw).split('/')[0].trim();
  return /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : null;
}

function asList(raw) {
  if (!raw) return [];
  return Array.isArray(raw) ? raw.filter(Boolean) : [raw];
}

/**
 * Claves de abonados de ESTA org (nunca mezclar con otros ISP).
 * Usado para filtrar lo que se lee del MikroTik físico (colas/PPPoE).
 */
export async function loadOrgSubscriberKeys(orgId, { routerId = null } = {}) {
  const rows = await db.select({
    serviceId: clientServices.id,
    clientId: clients.id,
    clientName: users.fullName,
    ipAddress: clientServices.ipAddress,
    pppoeUsername: clientServices.pppoeUsername,
    queueName: clientServices.queueName,
    routerId: clientServices.routerId,
    status: clientServices.status,
  })
    .from(clientServices)
    .innerJoin(clients, eq(clientServices.clientId, clients.id))
    .leftJoin(users, eq(clients.userId, users.id))
    .where(orgFilter(clients, orgId));

  const ips = new Set();
  const usernames = new Set();
  const queueNames = new Set();
  const byIp = new Map();
  const byUser = new Map();
  const byQueue = new Map();

  for (const r of rows) {
    // Preferir servicios de este router; si no hay routerId en servicio, igual contar IP/user de la org
    if (routerId && r.routerId && Number(r.routerId) !== Number(routerId)) {
      // Otra caja de la misma org: no excluir del todo (IP puede moverse); se usan para match global org
    }
    const ip = normalizeIp(r.ipAddress);
    const user = r.pppoeUsername ? String(r.pppoeUsername).trim().toLowerCase() : null;
    const qn = r.queueName ? String(r.queueName).trim() : null;
    const meta = {
      serviceId: r.serviceId,
      clientId: r.clientId,
      clientName: r.clientName || null,
      status: r.status,
    };
    if (ip) {
      ips.add(ip);
      byIp.set(ip, meta);
    }
    if (user) {
      usernames.add(user);
      byUser.set(user, meta);
    }
    if (qn) {
      queueNames.add(qn);
      byQueue.set(qn, meta);
    }
  }

  return { ips, usernames, queueNames, byIp, byUser, byQueue, serviceCount: rows.length };
}

function matchQueue(q, keys) {
  const targetIp = normalizeIp(q?.target);
  if (targetIp && keys.ips.has(targetIp)) return keys.byIp.get(targetIp);
  const name = q?.name ? String(q.name).trim() : '';
  if (name && keys.queueNames.has(name)) return keys.byQueue.get(name);
  // Cola FibraNexus: "Nombre Cliente-123" → serviceId al final
  const m = name.match(/-(\d+)$/);
  if (m) {
    const sid = parseInt(m[1], 10);
    for (const meta of keys.byQueue.values()) {
      if (meta.serviceId === sid) return meta;
    }
    for (const meta of keys.byIp.values()) {
      if (meta.serviceId === sid) return meta;
    }
  }
  return null;
}

function matchSecret(s, keys) {
  const user = s?.name ? String(s.name).trim().toLowerCase() : '';
  if (user && keys.usernames.has(user)) return keys.byUser.get(user);
  return null;
}

function matchActive(a, keys) {
  const user = a?.name ? String(a.name).trim().toLowerCase() : '';
  if (user && keys.usernames.has(user)) return keys.byUser.get(user);
  const ip = normalizeIp(a?.address || a?.['caller-id']);
  if (ip && keys.ips.has(ip)) return keys.byIp.get(ip);
  return null;
}

/**
 * Filtra colas/secrets/sesiones del router a SOLO abonados de la org.
 * Lo ajeno (otro ISP en el mismo MikroTik de lab) no se expone con PII.
 */
export function filterRouterNetworkForOrg(raw, keys) {
  const queues = asList(raw.simpleQueues);
  const secrets = asList(raw.pppoeSecrets);
  const active = asList(raw.pppoeActive);

  const simpleQueues = [];
  let foreignQueues = 0;
  for (const q of queues) {
    const meta = matchQueue(q, keys);
    if (!meta) {
      foreignQueues += 1;
      continue;
    }
    simpleQueues.push({
      ...q,
      // Preferir nombre CRM de esta org (nunca mostrar nombre de otro ISP)
      name: meta.clientName || q.name,
      _org: meta,
    });
  }

  const pppoeSecrets = [];
  let foreignSecrets = 0;
  for (const s of secrets) {
    const meta = matchSecret(s, keys);
    if (!meta) {
      foreignSecrets += 1;
      continue;
    }
    pppoeSecrets.push({
      ...s,
      comment: meta.clientName ? `FibraNexus: ${meta.clientName}` : s.comment,
      _org: meta,
    });
  }

  const pppoeActive = [];
  let foreignActive = 0;
  for (const a of active) {
    if (!a?.name && !a?.address) continue;
    const meta = matchActive(a, keys);
    if (!meta) {
      foreignActive += 1;
      continue;
    }
    pppoeActive.push({ ...a, _org: meta });
  }

  return {
    simpleQueues,
    pppoeSecrets,
    pppoeActive,
    foreignOnRouter: {
      queues: foreignQueues,
      secrets: foreignSecrets,
      active: foreignActive,
      total: foreignQueues + foreignSecrets + foreignActive,
    },
  };
}
