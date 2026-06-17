import { db } from '../db/index.js';
import { detectedDevices, equipment, clients, users, clientServices } from '../db/schema.js';
import { and, eq, inArray, desc, isNull, isNotNull } from 'drizzle-orm';
import { orgFilter } from './tenant.js';

function normalizeMac(mac) {
  if (!mac) return null;
  const clean = String(mac).toLowerCase().replace(/[^0-9a-f]/g, '');
  if (clean.length !== 12) return null;
  return clean.replace(/(.{2})(?=.)/g, '$1:');
}

function macsEqual(a, b) {
  const na = normalizeMac(a);
  const nb = normalizeMac(b);
  return Boolean(na && nb && na === nb);
}

/** Quita MAC del servicio si ya no hay CPE vinculado al abonado con esa MAC. */
export async function clearOrphanServiceMac(clientId, macAddress, orgId, serviceIdHint = null) {
  const mac = normalizeMac(macAddress);
  if (!mac || !clientId) return;

  const cpeRows = await db.select({ macAddress: equipment.macAddress })
    .from(equipment)
    .where(and(
      orgFilter(equipment, orgId),
      eq(equipment.type, 'cpe'),
      eq(equipment.clientId, clientId),
    ));

  if (cpeRows.some((e) => macsEqual(e.macAddress, mac))) return;

  const filters = [eq(clientServices.clientId, clientId)];
  if (serviceIdHint) filters.push(eq(clientServices.id, serviceIdHint));

  const services = await db.select({ id: clientServices.id, macAddress: clientServices.macAddress })
    .from(clientServices)
    .innerJoin(clients, eq(clientServices.clientId, clients.id))
    .where(and(...filters, orgFilter(clients, orgId)));

  for (const svc of services) {
    if (macsEqual(svc.macAddress, mac)) {
      await db.update(clientServices)
        .set({ macAddress: null, updatedAt: new Date() })
        .where(eq(clientServices.id, svc.id));
    }
  }
}

/** Revert detected_devices when CPE is unlinked from abonado. */
export async function revertDetectedDeviceForEquipment(row, orgId) {
  if (!row) return;

  let serviceIdToClear = null;
  let clientIdToClear = row.clientId ?? null;
  const mac = normalizeMac(row.macAddress);

  if (row.detectedDeviceId) {
    const [dd] = await db.select({
      adoptedAsClientServiceId: detectedDevices.adoptedAsClientServiceId,
    }).from(detectedDevices).where(eq(detectedDevices.id, row.detectedDeviceId)).limit(1);
    serviceIdToClear = dd?.adoptedAsClientServiceId ?? null;

    await db.update(detectedDevices)
      .set({ status: 'detected', adoptedAsClientServiceId: null, updatedAt: new Date() })
      .where(and(
        eq(detectedDevices.id, row.detectedDeviceId),
        orgFilter(detectedDevices, orgId),
      ));
  } else if (mac) {
    const [dd] = await db.select({
      id: detectedDevices.id,
      adoptedAsClientServiceId: detectedDevices.adoptedAsClientServiceId,
    }).from(detectedDevices)
      .where(and(orgFilter(detectedDevices, orgId), eq(detectedDevices.macAddress, mac)))
      .limit(1);
    serviceIdToClear = dd?.adoptedAsClientServiceId ?? null;

    await db.update(detectedDevices)
      .set({ status: 'detected', adoptedAsClientServiceId: null, updatedAt: new Date() })
      .where(and(
        orgFilter(detectedDevices, orgId),
        eq(detectedDevices.macAddress, mac),
        eq(detectedDevices.status, 'adopted'),
      ));
  }

  if (serviceIdToClear && mac) {
    const [svc] = await db.select({ clientId: clientServices.clientId })
      .from(clientServices).where(eq(clientServices.id, serviceIdToClear)).limit(1);
    clientIdToClear = clientIdToClear ?? svc?.clientId ?? null;
    await clearOrphanServiceMac(clientIdToClear, mac, orgId, serviceIdToClear);
  } else if (clientIdToClear && mac) {
    await clearOrphanServiceMac(clientIdToClear, mac, orgId);
  }
}

/** Mark detected_devices adopted when CPE is linked to abonado (by detectedDeviceId or MAC). */
export async function markDetectedDeviceAdopted(row, orgId, clientServiceId = null) {
  if (!row?.macAddress && !row?.detectedDeviceId) return;

  const patch = {
    status: 'adopted',
    updatedAt: new Date(),
    ...(clientServiceId ? { adoptedAsClientServiceId: clientServiceId } : {}),
  };

  if (row.detectedDeviceId) {
    await db.update(detectedDevices).set(patch).where(and(
      eq(detectedDevices.id, row.detectedDeviceId),
      orgFilter(detectedDevices, orgId),
    ));
    return;
  }

  const mac = normalizeMac(row.macAddress);
  if (!mac) return;

  await db.update(detectedDevices).set(patch).where(and(
    orgFilter(detectedDevices, orgId),
    eq(detectedDevices.macAddress, mac),
    inArray(detectedDevices.status, ['detected', 'adopted']),
  ));
}

/**
 * Align detected_devices.status with equipment.clientId (source of truth for "vinculado").
 * Heals stale "adopted" rows after desvincular from client profile.
 */
export async function syncDetectedDeviceStates(orgId) {
  const [detectedRows, cpeRows] = await Promise.all([
    db.select({
      id: detectedDevices.id,
      macAddress: detectedDevices.macAddress,
      status: detectedDevices.status,
      adoptedAsClientServiceId: detectedDevices.adoptedAsClientServiceId,
    }).from(detectedDevices).where(orgFilter(detectedDevices, orgId)),
    db.select({
      id: equipment.id,
      macAddress: equipment.macAddress,
      clientId: equipment.clientId,
      detectedDeviceId: equipment.detectedDeviceId,
    }).from(equipment).where(and(
      orgFilter(equipment, orgId),
      eq(equipment.type, 'cpe'),
    )),
  ]);

  const cpeByMac = new Map();
  const cpeByDetectedId = new Map();
  for (const cpe of cpeRows) {
    const mac = normalizeMac(cpe.macAddress);
    if (mac) cpeByMac.set(mac, cpe);
    if (cpe.detectedDeviceId) cpeByDetectedId.set(cpe.detectedDeviceId, cpe);
  }

  let healed = 0;
  for (const dd of detectedRows) {
    if (dd.status === 'ignored') continue;

    const mac = normalizeMac(dd.macAddress);
    const cpe = cpeByDetectedId.get(dd.id) || (mac ? cpeByMac.get(mac) : null);
    const linked = Boolean(cpe?.clientId);

    if (linked && dd.status !== 'adopted') {
      const [svc] = await db.select({ id: clientServices.id })
        .from(clientServices)
        .where(and(
          eq(clientServices.clientId, cpe.clientId),
          eq(clientServices.macAddress, dd.macAddress),
        ))
        .orderBy(desc(clientServices.createdAt))
        .limit(1);
      const [svcFallback] = svc ? [svc] : await db.select({ id: clientServices.id })
        .from(clientServices)
        .where(eq(clientServices.clientId, cpe.clientId))
        .orderBy(desc(clientServices.createdAt))
        .limit(1);
      const serviceId = svc?.id ?? svcFallback?.id ?? dd.adoptedAsClientServiceId;
      await db.update(detectedDevices).set({
        status: 'adopted',
        adoptedAsClientServiceId: serviceId,
        updatedAt: new Date(),
      }).where(eq(detectedDevices.id, dd.id));
      healed++;
    } else if (linked && cpe.clientId) {
      let needsClientFix = false;
      if (dd.adoptedAsClientServiceId) {
        const [svc] = await db.select({ id: clientServices.id, clientId: clientServices.clientId })
          .from(clientServices)
          .where(eq(clientServices.id, dd.adoptedAsClientServiceId))
          .limit(1);
        if (!svc || svc.clientId !== cpe.clientId) needsClientFix = true;
      } else if (dd.status === 'adopted') {
        needsClientFix = true;
      }
      if (needsClientFix) {
        const [rightSvc] = await db.select({ id: clientServices.id })
          .from(clientServices)
          .where(and(eq(clientServices.clientId, cpe.clientId), eq(clientServices.macAddress, dd.macAddress)))
          .orderBy(desc(clientServices.createdAt))
          .limit(1);
        const [svcFallback] = rightSvc ? [rightSvc] : await db.select({ id: clientServices.id })
          .from(clientServices)
          .where(eq(clientServices.clientId, cpe.clientId))
          .orderBy(desc(clientServices.createdAt))
          .limit(1);
        await db.update(detectedDevices).set({
          status: 'adopted',
          adoptedAsClientServiceId: rightSvc?.id ?? svcFallback?.id ?? null,
          updatedAt: new Date(),
        }).where(eq(detectedDevices.id, dd.id));
        healed++;
      }
    } else if (!linked && dd.status === 'adopted') {
      if (dd.adoptedAsClientServiceId && mac) {
        const [svc] = await db.select({ clientId: clientServices.clientId })
          .from(clientServices).where(eq(clientServices.id, dd.adoptedAsClientServiceId)).limit(1);
        if (svc?.clientId) {
          await clearOrphanServiceMac(svc.clientId, dd.macAddress, orgId, dd.adoptedAsClientServiceId);
        }
      }
      await db.update(detectedDevices).set({
        status: 'detected',
        adoptedAsClientServiceId: null,
        updatedAt: new Date(),
      }).where(eq(detectedDevices.id, dd.id));
      healed++;
    }
  }

  if (healed) console.log('[detectedDeviceSync] org=%d healed=%d', orgId, healed);
  return healed;
}

/** Limpia registros fantasma (adoptados en DB sin CPE real en Equipos). */
export async function reconcileDetectedGhosts(orgId) {
  const stats = { servicesMacCleared: 0, equipmentPointersCleared: 0, ghostsReverted: 0 };

  const servicesWithMac = await db.select({
    id: clientServices.id,
    clientId: clientServices.clientId,
    macAddress: clientServices.macAddress,
  })
    .from(clientServices)
    .innerJoin(clients, eq(clientServices.clientId, clients.id))
    .where(and(orgFilter(clients, orgId)));

  for (const svc of servicesWithMac) {
    if (!svc.macAddress) continue;
    const cpeRows = await db.select({ macAddress: equipment.macAddress })
      .from(equipment)
      .where(and(
        orgFilter(equipment, orgId),
        eq(equipment.type, 'cpe'),
        eq(equipment.clientId, svc.clientId),
      ));
    const linked = cpeRows.some((e) => macsEqual(e.macAddress, svc.macAddress));
    if (!linked) {
      await db.update(clientServices)
        .set({ macAddress: null, updatedAt: new Date() })
        .where(eq(clientServices.id, svc.id));
      stats.servicesMacCleared++;
    }
  }

  const orphanEquip = await db.select({ id: equipment.id })
    .from(equipment)
    .where(and(
      orgFilter(equipment, orgId),
      eq(equipment.type, 'cpe'),
      isNull(equipment.clientId),
      isNotNull(equipment.detectedDeviceId),
    ));

  for (const eq of orphanEquip) {
    await db.update(equipment)
      .set({ detectedDeviceId: null, updatedAt: new Date() })
      .where(eq(equipment.id, eq.id));
    stats.equipmentPointersCleared++;
  }

  const staleAdopted = await db.select({
    id: detectedDevices.id,
    macAddress: detectedDevices.macAddress,
    adoptedAsClientServiceId: detectedDevices.adoptedAsClientServiceId,
    status: detectedDevices.status,
  }).from(detectedDevices).where(orgFilter(detectedDevices, orgId));

  const allCpe = await db.select({ clientId: equipment.clientId, macAddress: equipment.macAddress })
    .from(equipment)
    .where(and(orgFilter(equipment, orgId), eq(equipment.type, 'cpe')));

  for (const dd of staleAdopted) {
    if (dd.status === 'ignored') continue;
    const linkedCpe = allCpe.find((e) => macsEqual(e.macAddress, dd.macAddress) && e.clientId);
    const reallyLinked = Boolean(linkedCpe?.clientId);
    if (!reallyLinked && (dd.status === 'adopted' || dd.adoptedAsClientServiceId)) {
      if (dd.adoptedAsClientServiceId && dd.macAddress) {
        const [svc] = await db.select({ clientId: clientServices.clientId })
          .from(clientServices).where(eq(clientServices.id, dd.adoptedAsClientServiceId)).limit(1);
        if (svc?.clientId) {
          await clearOrphanServiceMac(svc.clientId, dd.macAddress, orgId, dd.adoptedAsClientServiceId);
        }
      }
      await db.update(detectedDevices).set({
        status: 'detected',
        adoptedAsClientServiceId: null,
        updatedAt: new Date(),
      }).where(eq(detectedDevices.id, dd.id));
      stats.ghostsReverted++;
    }
  }

  stats.ghostsReverted += await syncDetectedDeviceStates(orgId);
  if (stats.ghostsReverted || stats.servicesMacCleared || stats.equipmentPointersCleared) {
    console.log('[reconcileDetectedGhosts] org=%d stats=%j', orgId, stats);
  }
  return stats;
}

/** Resolve live abonado name for a detected row (equipment.clientId wins over stale service join). */
export async function enrichDetectedRowsWithLiveClient(rows, orgId) {
  if (!rows.length) return rows;

  const macs = [...new Set(rows.map((r) => normalizeMac(r.macAddress)).filter(Boolean))];
  if (!macs.length) return rows.map((r) => ({ ...r, effectiveStatus: r.status }));

  const linked = await db.select({
    macAddress: equipment.macAddress,
    clientId: equipment.clientId,
    clientName: users.fullName,
    equipmentId: equipment.id,
  })
    .from(equipment)
    .innerJoin(clients, eq(equipment.clientId, clients.id))
    .leftJoin(users, eq(clients.userId, users.id))
    .where(and(
      orgFilter(equipment, orgId),
      eq(equipment.type, 'cpe'),
    ));

  const byMac = new Map();
  for (const row of linked) {
    const mac = normalizeMac(row.macAddress);
    if (mac) byMac.set(mac, row);
  }

  return rows.map((r) => {
    const mac = normalizeMac(r.macAddress);
    const live = mac ? byMac.get(mac) : null;
    const effectivelyLinked = Boolean(live?.clientId);

    let effectiveStatus = r.status;
    if (r.status === 'ignored') {
      effectiveStatus = 'ignored';
    } else if (effectivelyLinked) {
      effectiveStatus = 'adopted';
    } else if (r.status === 'adopted') {
      effectiveStatus = 'detected';
    } else {
      effectiveStatus = r.status || 'detected';
    }

    // Nombre del abonado: solo desde equipo CPE vinculado (MAC). Ignorar join obsoleto del servicio.
    const adoptedClientId = effectivelyLinked ? live.clientId : null;
    const adoptedClientName = effectivelyLinked ? live.clientName : null;

    return {
      ...r,
      effectiveStatus,
      adoptedClientId,
      adoptedClientName,
      linkedEquipmentId: live?.equipmentId ?? null,
    };
  });
}
