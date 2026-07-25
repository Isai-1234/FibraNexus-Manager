import { mikrotikRequest } from './mikrotikClient.js';

const SUSPENDED_LIST = 'FN-SUSPENDED';
const GARDEN_LIST = 'FN-WALLED-GARDEN';

function suspendTag(serviceId) {
  return `fn-suspend-s${serviceId}`;
}

async function listAddressEntries(router, listName) {
  const rows = await mikrotikRequest(router, 'GET', '/ip/firewall/address-list');
  const list = Array.isArray(rows) ? rows : [rows];
  return list.filter((r) => r.list === listName);
}

async function listFilterRules(router) {
  const rows = await mikrotikRequest(router, 'GET', '/ip/firewall/filter');
  return Array.isArray(rows) ? rows : [rows];
}

async function listNatRules(router) {
  const rows = await mikrotikRequest(router, 'GET', '/ip/firewall/nat');
  return Array.isArray(rows) ? rows : [rows];
}

async function listProxyAccess(router) {
  try {
    const rows = await mikrotikRequest(router, 'GET', '/ip/proxy/access');
    return Array.isArray(rows) ? rows : [rows];
  } catch {
    return [];
  }
}

async function ensureAddressListEntry(router, list, address, comment) {
  const entries = await listAddressEntries(router, list);
  const normalized = String(address).split('/')[0];
  const found = entries.find((e) => String(e.address).split('/')[0] === normalized && e.comment === comment);
  if (found?.['.id']) return found;
  return mikrotikRequest(router, 'PUT', '/ip/firewall/address-list', {
    list,
    address: normalized.includes('/') ? normalized : `${normalized}/32`,
    comment,
  });
}

async function removeAddressListByComment(router, list, commentPrefix) {
  const entries = await listAddressEntries(router, list);
  for (const entry of entries) {
    if (entry.comment?.startsWith(commentPrefix)) {
      await mikrotikRequest(router, 'DELETE', `/ip/firewall/address-list/${entry['.id']}`);
    }
  }
}

async function upsertFilterRule(router, spec) {
  const rules = await listFilterRules(router);
  const found = rules.find((r) => r.comment === spec.comment);
  if (found?.['.id']) {
    await mikrotikRequest(router, 'PATCH', `/ip/firewall/filter/${found['.id']}`, spec);
    return { action: 'updated', rule: found };
  }
  await mikrotikRequest(router, 'PUT', '/ip/firewall/filter', spec);
  return { action: 'created' };
}

async function removeFilterRulesByComment(router, commentPrefix) {
  const rules = await listFilterRules(router);
  for (const rule of rules) {
    if (rule.comment?.startsWith(commentPrefix)) {
      await mikrotikRequest(router, 'DELETE', `/ip/firewall/filter/${rule['.id']}`);
    }
  }
}

async function upsertNatRule(router, spec) {
  const rules = await listNatRules(router);
  const found = rules.find((r) => r.comment === spec.comment);
  if (found?.['.id']) {
    await mikrotikRequest(router, 'PATCH', `/ip/firewall/nat/${found['.id']}`, spec);
    return { action: 'updated' };
  }
  await mikrotikRequest(router, 'PUT', '/ip/firewall/nat', spec);
  return { action: 'created' };
}

async function removeNatRulesByComment(router, commentPrefix) {
  const rules = await listNatRules(router);
  for (const rule of rules) {
    if (rule.comment?.startsWith(commentPrefix)) {
      await mikrotikRequest(router, 'DELETE', `/ip/firewall/nat/${rule['.id']}`);
    }
  }
}

async function removeProxyAccessByComment(router, commentPrefix) {
  const rules = await listProxyAccess(router);
  for (const rule of rules) {
    if (rule.comment?.startsWith(commentPrefix)) {
      await mikrotikRequest(router, 'DELETE', `/ip/proxy/access/${rule['.id']}`);
    }
  }
}

function pickPortalRedirectIp(portalIps = []) {
  const candidates = [...new Set(portalIps.map((ip) => String(ip || '').split('/')[0].trim()).filter(Boolean))];
  return candidates.find((ip) => ip !== '8.8.8.8' && ip !== '8.8.4.4' && !ip.startsWith('127.')) || null;
}

function portalHostname(portalUrl) {
  try {
    return new URL(portalUrl).hostname;
  } catch {
    return null;
  }
}

/**
 * Walled garden por IP del abonado — no deshabilita PPPoE ni colas.
 * - Solo DNS + destinos FN-WALLED-GARDEN (portal del ISP).
 * - HTTP (80) de suspendidos → proxy local con redirect-to = URL del ISP (no SaaS genérico).
 * - Sin accept TCP/443 global (YouTube/Google HTTPS no redirigen; solo fallan).
 */
export async function applyMikrotikSubscriberSuspend(router, {
  serviceId,
  clientIp,
  portalIps = [],
  portalUrl = 'https://app.fibranexus.cl/suspended',
}) {
  const tag = suspendTag(serviceId);
  await ensureAddressListEntry(router, SUSPENDED_LIST, clientIp, tag);

  // DNS públicos frecuentes (Android Private DNS / DoH) + portal
  const gardenIps = [...new Set([
    ...portalIps,
    '8.8.8.8', '8.8.4.4',
    '1.1.1.1', '1.0.0.1',
    '9.9.9.9',
  ])];
  for (const ip of gardenIps) {
    await ensureAddressListEntry(router, GARDEN_LIST, ip, `${tag}-garden-${ip}`);
  }

  await removeFilterRulesByComment(router, `${tag}-https`);

  let httpRedirect = null;
  const redirIp = pickPortalRedirectIp(portalIps);

  // dst-nat HTTP → portal (captive). El proxy MikroTik no expone redirect-to fiable por REST.
  if (redirIp) {
    httpRedirect = await upsertNatRule(router, {
      chain: 'dstnat',
      'src-address-list': SUSPENDED_LIST,
      protocol: 'tcp',
      'dst-port': '80',
      action: 'dst-nat',
      'to-addresses': redirIp,
      'to-ports': '80',
      comment: `${tag}-http-redir`,
    });
    httpRedirect = { mode: 'dst-nat', to: redirIp, portalUrl, ...httpRedirect };
  }

  // Limpia intentos previos de proxy access de este servicio
  try {
    await removeProxyAccessByComment(router, tag);
  } catch { /* ignore */ }

  const rules = [
    { chain: 'forward', 'src-address-list': SUSPENDED_LIST, 'dst-address-list': GARDEN_LIST, action: 'accept', comment: `${tag}-garden` },
    { chain: 'forward', 'src-address-list': SUSPENDED_LIST, protocol: 'udp', 'dst-port': '53', action: 'accept', comment: `${tag}-dns-udp` },
    { chain: 'forward', 'src-address-list': SUSPENDED_LIST, protocol: 'tcp', 'dst-port': '53', action: 'accept', comment: `${tag}-dns-tcp` },
    // Android Private DNS (DoT)
    { chain: 'forward', 'src-address-list': SUSPENDED_LIST, protocol: 'tcp', 'dst-port': '853', action: 'accept', comment: `${tag}-dns-dot` },
    { chain: 'forward', 'src-address-list': SUSPENDED_LIST, action: 'drop', comment: `${tag}-drop` },
  ];

  const results = [];
  for (const rule of rules) {
    results.push(await upsertFilterRule(router, rule));
  }
  return {
    success: true,
    clientIp,
    rules: results.length,
    gardenIps,
    portalUrl,
    httpRedirect,
  };
}

export async function removeMikrotikSubscriberSuspend(router, { serviceId }) {
  const tag = suspendTag(serviceId);
  await removeAddressListByComment(router, SUSPENDED_LIST, tag);
  await removeAddressListByComment(router, GARDEN_LIST, `${tag}-garden`);
  await removeFilterRulesByComment(router, tag);
  await removeNatRulesByComment(router, tag);
  await removeProxyAccessByComment(router, tag);
  return { success: true };
}
