import https from 'https';
import { inferConnectionMethod } from './tenant.js';

export const EDGEROUTER_TYPES = ['edgerouter_v4', 'edgerouter'];

export function isEdgeRouterType(routerType) {
  return EDGEROUTER_TYPES.includes(String(routerType || ''));
}

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
  return String(creds.routerPort || '443');
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

function parseCookies(setCookieHeader) {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader : (setCookieHeader ? [setCookieHeader] : []);
  return raw.map(c => c.split(';')[0]).join('; ');
}

/** Low-level HTTPS request para EdgeOS. rejectUnauthorized=false para cert auto-firmado. */
function edgeosHttpsRequest({ host, port, path, method, headers = {}, body, timeout = 15000 }) {
  const payload = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      port,
      path,
      method,
      headers: {
        ...headers,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      rejectUnauthorized: false,
      timeout,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout conectando al EdgeRouter')); });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Login EdgeOS.
 * EdgeOS espera form-urlencoded, NO JSON.
 * Devuelve { cookie, csrfToken } para usar en peticiones posteriores.
 */
export async function edgeosLogin({ host, port, user, pass }) {
  const body = `username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;

  const res = await edgeosHttpsRequest({
    host,
    port,
    path: '/api/edge/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  console.log(`[EdgeOS] login ${host}:${port} → HTTP ${res.statusCode} cookies=${!!res.headers['set-cookie']}`);

  if (res.statusCode !== 200) {
    throw new Error(`EdgeOS login HTTP ${res.statusCode}: ${res.body.slice(0, 300)}`);
  }

  const cookie = parseCookies(res.headers['set-cookie']);
  if (!cookie) throw new Error(`EdgeOS no devolvió cookie de sesión. Body: ${res.body.slice(0, 300)}`);

  // El body del login contiene el X-CSRF-TOKEN necesario para requests siguientes
  let csrfToken = null;
  try {
    const json = JSON.parse(res.body);
    csrfToken = json['X-CSRF-TOKEN'] || json['csrf_token'] || null;
    if (json.success !== '1' && json.success !== true && Number(json.success) !== 1) {
      console.warn(`[EdgeOS] login body indica fallo: ${res.body.slice(0, 200)}`);
    }
  } catch { /* body no-JSON — continuar con cookie obtenida */ }

  console.log(`[EdgeOS] login OK host=${host} csrf=${csrfToken ? 'present' : 'absent'}`);
  return { cookie, csrfToken };
}

/** GET de datos EdgeOS. Incluye CSRF token si está disponible. */
export async function edgeosDataGet({ host, port, cookie, csrfToken, dataPath }) {
  const query = encodeURIComponent(dataPath);
  const res = await edgeosHttpsRequest({
    host,
    port,
    path: `/api/edge/data.json?data=${query}`,
    method: 'GET',
    headers: {
      Cookie: cookie,
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
  });

  console.log(`[EdgeOS] data.json?data=${dataPath} → HTTP ${res.statusCode}`);

  if (res.statusCode === 403) {
    throw new Error('EdgeOS rechazó la petición (403) — posible falta de X-CSRF-Token o sesión expirada');
  }
  if (res.statusCode !== 200) {
    throw new Error(`EdgeOS data HTTP ${res.statusCode}: ${res.body.slice(0, 300)}`);
  }
  try {
    return JSON.parse(res.body);
  } catch {
    throw new Error(`EdgeOS devolvió respuesta no-JSON (${res.body.slice(0, 100)})`);
  }
}

/** POST batch EdgeOS. Incluye CSRF token. */
export async function edgeosBatch({ host, port, cookie, csrfToken, payload }) {
  const body = JSON.stringify(payload);
  const res = await edgeosHttpsRequest({
    host,
    port,
    path: '/api/edge/batch.json',
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    body,
  });

  if (res.statusCode !== 200) {
    throw new Error(`EdgeOS batch HTTP ${res.statusCode}: ${res.body.slice(0, 300)}`);
  }
  try {
    return JSON.parse(res.body);
  } catch {
    return { raw: res.body };
  }
}

function normalizeStatus(data) {
  const status = data?.status || data?.data?.status || data?.data || {};
  const uptimeSec = Number(status.uptime || status['system-uptime'] || 0);
  const uptime = uptimeSec > 0 ? formatUptime(uptimeSec) : (status.uptime || '—');
  return {
    version: status.version || status['firmware-version'] || status.build || 'EdgeOS',
    uptime,
    cpuLoad: status.cpu != null ? Number(status.cpu) : null,
    hostName: status['host-name'] || status.hostname || null,
    platform: status.platform || null,
  };
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export async function testEdgeRouterConnection(router) {
  const host = resolveHost(router);
  if (!host) throw new Error('Router sin host configurado');
  const port = resolvePort(router);
  const { user, pass } = getRouterCredentials(router);

  const { cookie, csrfToken } = await edgeosLogin({ host, port, user, pass });
  const data = await edgeosDataGet({ host, port, cookie, csrfToken, dataPath: 'status' });
  const info = normalizeStatus(data);

  const creds = router.credentials || {};
  return {
    ...info,
    lanSubnet: creds.lanSubnet || null,
    lanInterface: creds.lanInterface || null,
  };
}

export async function testEdgeRouterConnectionRaw({ host, port = '443', user, pass }) {
  const { cookie, csrfToken } = await edgeosLogin({ host, port, user, pass });
  const data = await edgeosDataGet({ host, port, cookie, csrfToken, dataPath: 'status' });
  return normalizeStatus(data);
}

/** Reserva DHCP estática en la LAN del nodo */
export async function upsertDhcpStaticMapping(router, { name, mac, ip, description = '' }) {
  const host = resolveHost(router);
  const port = resolvePort(router);
  const { user, pass } = getRouterCredentials(router);
  const creds = router.credentials || {};
  const subnet = creds.lanSubnet || '192.168.2.0/24';
  const sharedNetwork = creds.dhcpSharedNetwork || 'LAN';
  const mappingName = String(name || `fn-${ip.replace(/\./g, '-')}`).replace(/[^a-zA-Z0-9_-]/g, '_');

  const { cookie, csrfToken } = await edgeosLogin({ host, port, user, pass });
  const payload = {
    SET: {
      service: {
        'dhcp-server': {
          'shared-network-name': {
            [sharedNetwork]: {
              subnet: {
                [subnet]: {
                  'static-mapping': {
                    [mappingName]: {
                      'mac-address': mac,
                      'ip-address': ip,
                      ...(description ? { description } : {}),
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  await edgeosBatch({ host, port, cookie, csrfToken, payload });
  return { action: 'upserted', mappingName, ip, mac };
}

export async function removeDhcpStaticMapping(router, mappingName) {
  const host = resolveHost(router);
  const port = resolvePort(router);
  const { user, pass } = getRouterCredentials(router);
  const creds = router.credentials || {};
  const subnet = creds.lanSubnet || '192.168.2.0/24';
  const sharedNetwork = creds.dhcpSharedNetwork || 'LAN';

  const { cookie, csrfToken } = await edgeosLogin({ host, port, user, pass });
  const payload = {
    DELETE: {
      service: {
        'dhcp-server': {
          'shared-network-name': {
            [sharedNetwork]: {
              subnet: {
                [subnet]: {
                  'static-mapping': mappingName,
                },
              },
            },
          },
        },
      },
    },
  };
  await edgeosBatch({ host, port, cookie, csrfToken, payload });
  return { action: 'removed', mappingName };
}
