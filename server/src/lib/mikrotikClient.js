import https from 'https';
import { inferConnectionMethod } from './tenant.js';

function resolveHost(router) {
  const creds = router.credentials || {};
  const method = inferConnectionMethod(router);
  if (method === 'cloudflare_tunnel' && creds.tunnelHostname) {
    return creds.tunnelHostname;
  }
  return router.ipAddress;
}

function resolvePort(router) {
  const creds = router.credentials || {};
  const type = creds.routerType || '';
  if (creds.routerPort) return String(creds.routerPort);
  if (type === 'mikrotik_v6') return '8729';
  return '443';
}

export function getRouterCredentials(router) {
  const creds = router.credentials || {};
  const user = creds.routerUser;
  const pass = creds.routerPass;
  if (!user || !pass) {
    throw new Error('Router sin credenciales API. Edita el router y guarda usuario/contraseña.');
  }
  return { user, pass };
}

export function mikrotikRequest(router, method, path, body = null) {
  const host = resolveHost(router);
  if (!host) throw new Error('Router sin host configurado');

  const port = resolvePort(router);
  const { user, pass } = getRouterCredentials(router);
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const urlPath = path.startsWith('/rest') ? path : `/rest${path.startsWith('/') ? path : `/${path}`}`;
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      port,
      path: urlPath,
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      rejectUnauthorized: false,
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`MikroTik HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout conectando al router')); });
    if (payload) req.write(payload);
    req.end();
  });
}

export function formatMikrotikRate(mbps) {
  const n = Number(mbps) || 1;
  return n >= 1000 ? `${Math.round(n / 1000)}G` : `${n}M`;
}

export function buildQueueLimits(uploadMbps, downloadMbps) {
  return `${formatMikrotikRate(uploadMbps)}/${formatMikrotikRate(downloadMbps)}`;
}

export async function testRouterConnection(router) {
  const info = await mikrotikRequest(router, 'GET', '/system/resource');
  return info;
}

export async function listPppoeSecrets(router) {
  return mikrotikRequest(router, 'GET', '/ppp/secret');
}

export async function listSimpleQueues(router) {
  return mikrotikRequest(router, 'GET', '/queue/simple');
}

export async function listPppoeActive(router) {
  return mikrotikRequest(router, 'GET', '/ppp/active');
}

export async function createPppoeSecret(router, { username, password, profile = 'default', comment = '' }) {
  return mikrotikRequest(router, 'PUT', '/ppp/secret', {
    name: username,
    password,
    service: 'pppoe',
    profile,
    comment,
  });
}

export async function findPppoeSecret(router, username) {
  const secrets = await listPppoeSecrets(router);
  const list = Array.isArray(secrets) ? secrets : [secrets];
  return list.find((s) => s.name === username) || null;
}

/** Crea o actualiza secret PPPoE — no duplica si ya existe el usuario */
export async function upsertPppoeSecret(router, { username, password, profile = 'default', comment = '' }) {
  const found = await findPppoeSecret(router, username);
  if (found?.['.id']) {
    await mikrotikRequest(router, 'PATCH', `/ppp/secret/${found['.id']}`, {
      password,
      profile,
      comment,
      disabled: 'false',
    });
    return { action: 'updated', secret: found };
  }
  await createPppoeSecret(router, { username, password, profile, comment });
  return { action: 'created' };
}

export async function findSimpleQueueByName(router, name) {
  if (!name) return null;
  const queues = await listSimpleQueues(router);
  const list = Array.isArray(queues) ? queues : [queues];
  return list.find((q) => q.name === name) || null;
}

function normalizeQueueTarget(value) {
  return String(value || '').split('/')[0].trim();
}

export async function findSimpleQueueByTarget(router, target) {
  const ip = normalizeQueueTarget(target);
  if (!ip) return null;
  const queues = await listSimpleQueues(router);
  const list = Array.isArray(queues) ? queues : [queues];
  return list.find((q) => normalizeQueueTarget(q.target) === ip) || null;
}

/** Crea o actualiza cola — busca por nombre o IP destino para evitar duplicados */
export async function upsertSimpleQueue(router, { name, target, maxLimit, comment = '' }) {
  const byName = await findSimpleQueueByName(router, name);
  const byTarget = await findSimpleQueueByTarget(router, target);
  const existing = byName || byTarget;

  if (existing?.['.id']) {
    await mikrotikRequest(router, 'PATCH', `/queue/simple/${existing['.id']}`, {
      name,
      target,
      'max-limit': maxLimit,
      comment,
      disabled: 'false',
    });
    return { action: 'updated', queue: existing };
  }

  await createSimpleQueue(router, { name, target, maxLimit, comment });
  return { action: 'created' };
}

export async function setPppoeSecretDisabled(router, username, disabled) {
  const secrets = await listPppoeSecrets(router);
  const list = Array.isArray(secrets) ? secrets : [secrets];
  const found = list.find((s) => s.name === username);
  if (!found?.['.id']) return null;
  return mikrotikRequest(router, 'PATCH', `/ppp/secret/${found['.id']}`, {
    disabled: disabled ? 'true' : 'false',
  });
}

export async function createSimpleQueue(router, { name, target, maxLimit, comment = '' }) {
  return mikrotikRequest(router, 'PUT', '/queue/simple', {
    name,
    target,
    'max-limit': maxLimit,
    comment,
  });
}

export async function removeSimpleQueue(router, queueName) {
  const queues = await listSimpleQueues(router);
  const list = Array.isArray(queues) ? queues : [queues];
  const found = list.find((q) => q.name === queueName);
  if (!found?.['.id']) return null;
  return mikrotikRequest(router, 'DELETE', `/queue/simple/${found['.id']}`);
}

export async function disableSimpleQueue(router, queueName, disabled) {
  const queues = await listSimpleQueues(router);
  const list = Array.isArray(queues) ? queues : [queues];
  const found = list.find((q) => q.name === queueName);
  if (!found?.['.id']) return null;
  return mikrotikRequest(router, 'PATCH', `/queue/simple/${found['.id']}`, {
    disabled: disabled ? 'true' : 'false',
  });
}
