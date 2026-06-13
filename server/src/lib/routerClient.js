import { testRouterConnection as testMikrotikConnection } from './mikrotikClient.js';
import {
  isEdgeRouterType,
  testEdgeRouterConnection,
  testEdgeRouterConnectionRaw,
} from './edgeosClient.js';

export { isEdgeRouterType };

export function getRouterType(router) {
  return router?.credentials?.routerType || '';
}

export async function testRouterConnection(router) {
  const type = getRouterType(router);
  if (isEdgeRouterType(type)) {
    return testEdgeRouterConnection(router);
  }
  return testMikrotikConnection(router);
}

export async function testRouterConnectionRaw(params) {
  const { routerType, routerIp, routerPort, routerUser, routerPass, connectionMethod, tunnelHostname } = params;
  const host = connectionMethod === 'cloudflare_tunnel' ? tunnelHostname : routerIp;
  if (!host) throw new Error('Host requerido');
  const port = routerPort || (routerType === 'mikrotik_v6' ? '8728' : '443');

  if (isEdgeRouterType(routerType)) {
    const info = await testEdgeRouterConnectionRaw({
      host,
      port,
      user: routerUser,
      pass: routerPass,
    });
    return { success: true, routerInfo: info };
  }

  const https = await import('https');
  const url = `https://${host}:${port}/rest/system/resource`;
  const auth = Buffer.from(`${routerUser}:${routerPass}`).toString('base64');
  const result = await new Promise((resolve, reject) => {
    const req = https.default.request(url, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` },
      rejectUnauthorized: false,
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(data));
        else reject(new Error(`HTTP ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout - router no responde')); });
    req.end();
  });
  return { success: true, routerInfo: result };
}
