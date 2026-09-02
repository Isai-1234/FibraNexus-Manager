/** Identidad de antenas/CPE: MAC canónica, IP de gestión puede cambiar por DHCP. */

export function compactMac(mac) {
  const clean = String(mac || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  return clean.length === 12 ? clean : null;
}

/** MAC en formato aa:bb:cc:dd:ee:ff para persistir en DB. */
export function normalizeMac(mac) {
  const compact = compactMac(mac);
  if (!compact) return null;
  return compact.replace(/(.{2})(?=.)/g, '$1:');
}

export function macsEqual(a, b) {
  const na = compactMac(a);
  const nb = compactMac(b);
  return Boolean(na && nb && na === nb);
}

export function deviceMgmtIp(row) {
  const ip = row?.ipAddress ?? row?.host ?? null;
  return String(ip || '').trim().split('/')[0] || null;
}

export function formatMacFromCompact(compact) {
  return normalizeMac(compact);
}

/**
 * Empareja filas de inventario CPE: MAC primero, IP después.
 * @returns {{ row: object|null, matchedBy: 'mac'|'ip'|null, conflict?: string }}
 */
export function matchEquipmentRow(rows, { macAddress, ipAddress, clientId } = {}) {
  const ip = deviceMgmtIp({ ipAddress });
  const macCompact = compactMac(macAddress);

  if (macCompact) {
    const byMac = rows.find((r) => macsEqual(r.macAddress, macAddress));
    if (byMac) return { row: byMac, matchedBy: 'mac' };
  }

  if (ip) {
    const ipMatches = rows.filter((r) => deviceMgmtIp(r) === ip);
    if (ipMatches.length === 1) {
      const row = ipMatches[0];
      if (macCompact && row.macAddress && !macsEqual(row.macAddress, macAddress)) {
        return { row: null, matchedBy: null, conflict: 'ip_mac_mismatch' };
      }
      return { row, matchedBy: 'ip' };
    }
    if (ipMatches.length > 1 && clientId != null) {
      const scoped = ipMatches.find((r) => r.clientId === clientId);
      if (scoped) {
        if (macCompact && scoped.macAddress && !macsEqual(scoped.macAddress, macAddress)) {
          return { row: null, matchedBy: null, conflict: 'ip_mac_mismatch' };
        }
        return { row: scoped, matchedBy: 'ip' };
      }
    }
  }

  return { row: null, matchedBy: null };
}

/** Vista AP (ubntStaTable): MAC primero, IP remota después. */
export function findApStationForDevice(device, stationByMac, stationByRemoteIp) {
  const mac = compactMac(device?.macAddress);
  if (mac && stationByMac.has(mac)) return stationByMac.get(mac);
  const ip = deviceMgmtIp(device);
  if (ip && stationByRemoteIp.has(ip)) return stationByRemoteIp.get(ip);
  return null;
}

/** Parche de identidad al adoptar o al enriquecer desde red. */
export function mergeEquipmentIdentity(existing, incoming) {
  const patch = {};
  const inMac = normalizeMac(incoming.macAddress);
  const inIp = deviceMgmtIp(incoming);

  if (inMac && (!existing.macAddress || macsEqual(existing.macAddress, inMac))) {
    patch.macAddress = inMac;
  } else if (inMac && existing.macAddress && !macsEqual(existing.macAddress, inMac)) {
    return { patch: null, conflict: 'mac_mismatch' };
  }

  if (inIp) patch.ipAddress = inIp;

  return { patch, conflict: null };
}
