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

/**
 * Low-level HTTPS request para EdgeOS.
 * - rejectUnauthorized=false: acepta cert auto-firmado
 * - settled flag: evita double-reject cuando timeout dispara req.destroy()
 *   que a su vez emite 'error' en el socket
 * - res.on('error'): silencia errores del response stream post-destroy
 */
function edgeosHttpsRequest({ host, port, path, method, headers = {}, body, timeout = 10000 }) {
  const payload = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => { if (!settled) { settled = true; fn(val); } };

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
      // Silenciar errores en el response stream (ej: cuando req.destroy() se llama mid-response)
      res.on('error', () => {});
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => done(resolve, { statusCode: res.statusCode, headers: res.headers, body: data }));
    });

    req.on('error', (err) => done(reject, err));
    req.on('timeout', () => {
      req.destroy();
      done(reject, new Error(`Timeout (${timeout / 1000}s) conectando al EdgeRouter ${host}`));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Login EdgeOS.
 *
 * La API EdgeOS (/api/edge/login) acepta JSON.
 * La respuesta incluye Set-Cookie: PHPSESSID y, en el body JSON,
 * el campo "X-CSRF-TOKEN" necesario para todas las peticiones posteriores.
 *
 * Si el JSON falla (firmware muy antiguo), reintenta con form-urlencoded.
 *
 * Devuelve { cookie, csrfToken }.
 */
export async function edgeosLogin({ host, port, user, pass }) {
  // Intento 1: JSON (comportamiento estándar EdgeOS ≥ v1.9)
  let res = await edgeosHttpsRequest({
    host,
    port,
    path: '/api/edge/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { username: user, password: pass },
  });

  // Intento 2: form-urlencoded (fallback para firmware más antiguo)
  if (res.statusCode === 400 || res.statusCode === 415 || res.statusCode === 405) {
    console.log(`[EdgeOS] login JSON → HTTP ${res.statusCode}, reintentando con form-urlencoded`);
    res = await edgeosHttpsRequest({
      host,
      port,
      path: '/api/edge/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`,
    });
  }

  console.log(`[EdgeOS] login ${host} → HTTP ${res.statusCode} cookie=${!!res.headers['set-cookie']} body=${res.body.slice(0, 120)}`);

  if (res.statusCode !== 200) {
    throw new Error(`EdgeOS login falló HTTP ${res.statusCode} — verifica usuario/contraseña y hostname del túnel`);
  }

  const cookie = parseCookies(res.headers['set-cookie']);
  if (!cookie) {
    throw new Error(`EdgeOS no devolvió cookie de sesión (HTTP 200 pero sin Set-Cookie). Body: ${res.body.slice(0, 200)}`);
  }

  // CSRF token viene en el body JSON del login
  let csrfToken = null;
  try {
    const json = JSON.parse(res.body);
    csrfToken = json['X-CSRF-TOKEN'] || json['csrf_token'] || json['csrfToken'] || null;
    if (json.success !== undefined && json.success !== '1' && json.success !== true && Number(json.success) !== 1) {
      throw new Error(`EdgeOS login rechazado: ${res.body.slice(0, 200)}`);
    }
  } catch (err) {
    if (err.message.startsWith('EdgeOS login rechazado')) throw err;
    // body no-JSON: continuar con cookie obtenida
  }

  console.log(`[EdgeOS] login OK ${host} csrf=${csrfToken ? 'present' : 'absent'}`);
  return { cookie, csrfToken };
}

/** GET de datos EdgeOS. Incluye CSRF token en header si está disponible. */
export async function edgeosDataGet({ host, port, cookie, csrfToken, dataPath }) {
  const res = await edgeosHttpsRequest({
    host,
    port,
    path: `/api/edge/data.json?data=${encodeURIComponent(dataPath)}`,
    method: 'GET',
    headers: {
      Cookie: cookie,
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
  });

  console.log(`[EdgeOS] data.json?data=${dataPath} → HTTP ${res.statusCode}`);

  if (res.statusCode === 403) {
    throw new Error('EdgeOS rechazó data.json (403) — X-CSRF-Token inválido o sesión expirada');
  }
  if (res.statusCode !== 200) {
    throw new Error(`EdgeOS data.json HTTP ${res.statusCode}: ${res.body.slice(0, 200)}`);
  }
  try {
    return JSON.parse(res.body);
  } catch {
    throw new Error(`EdgeOS devolvió respuesta no-JSON en data.json: ${res.body.slice(0, 100)}`);
  }
}

/** POST batch EdgeOS. Incluye CSRF token. */
export async function edgeosBatch({ host, port, cookie, csrfToken, payload }) {
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
    body: payload,
  });

  if (res.statusCode !== 200) {
    throw new Error(`EdgeOS batch.json HTTP ${res.statusCode}: ${res.body.slice(0, 200)}`);
  }
  try {
    return JSON.parse(res.body);
  } catch {
    return { raw: res.body };
  }
}

function normalizeStatus(data) {
  // EdgeOS devuelve status en distintos paths según versión del firmware
  const status = data?.status || data?.data?.status || data?.data || data || {};
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
  if (!host) throw new Error('Router sin host configurado (tunnelHostname o ipAddress)');
  const port = resolvePort(router);
  const { user, pass } = getRouterCredentials(router);

  const { cookie, csrfToken } = await edgeosLogin({ host, port, user, pass });
  const data = await edgeosDataGet({ host, port, cookie, csrfToken, dataPath: 'status' });
  const info = normalizeStatus(data);

  const creds = router.credentials || {};
  return { ...info, lanSubnet: creds.lanSubnet || null, lanInterface: creds.lanInterface || null };
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
  await edgeosBatch({
    host, port, cookie, csrfToken,
    payload: {
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
    },
  });
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
  await edgeosBatch({
    host, port, cookie, csrfToken,
    payload: {
      DELETE: {
        service: {
          'dhcp-server': {
            'shared-network-name': {
              [sharedNetwork]: {
                subnet: { [subnet]: { 'static-mapping': mappingName } },
              },
            },
          },
        },
      },
    },
  });
  return { action: 'removed', mappingName };
}
