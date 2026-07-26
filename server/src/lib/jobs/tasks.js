import { provisionServiceNetwork } from '../networkProvision.js';
import { pollDeviceSnmp, pollEquipmentList } from '../snmpPoller.js';
import { runBillingJobsForOrg } from '../billingScheduler.js';
import { db } from '../../db/index.js';
import { equipment } from '../../db/schema.js';
import { and, eq, ne } from 'drizzle-orm';
import { orgFilter } from '../tenant.js';

/** Registro de tareas — misma función desde API inline o worker Redis. */
export const jobTasks = {
  'provision-network': async ({ serviceId, orgId, routerId, provisionMode, pppProfile }) =>
    provisionServiceNetwork(serviceId, orgId, routerId, provisionMode || 'both', { pppProfile }),

  'snmp-poll-one': async ({ equipmentId, orgId }) => {
    const [eqRow] = await db.select().from(equipment)
      .where(and(eq(equipment.id, equipmentId), orgFilter(equipment, orgId)))
      .limit(1);
    if (!eqRow) throw new Error('Equipo no encontrado');
    // Puente SNMP: sitio → parentId → primer router MikroTik de la org (CPE en LAN privada).
    let siteRouter = null;
    if (eqRow.siteId) {
      const [r] = await db.select().from(equipment)
        .where(and(eq(equipment.siteId, eqRow.siteId), eq(equipment.type, 'router'), orgFilter(equipment, orgId)))
        .limit(1);
      siteRouter = r || null;
    }
    if (!siteRouter && eqRow.parentId) {
      const [r] = await db.select().from(equipment)
        .where(and(eq(equipment.id, eqRow.parentId), eq(equipment.type, 'router'), orgFilter(equipment, orgId)))
        .limit(1);
      siteRouter = r || null;
    }
    if (!siteRouter) {
      const [r] = await db.select().from(equipment)
        .where(and(eq(equipment.type, 'router'), orgFilter(equipment, orgId)))
        .limit(1);
      siteRouter = r || null;
    }
    let result;
    try {
      result = await pollDeviceSnmp(eqRow, siteRouter);
    } catch (err) {
      result = { online: false, error: err.message, polledAt: new Date().toISOString() };
    }

    // Fallback airMAX: si el CPE no responde, leer señal desde el AP del mismo sitio.
    if ((!result.online || !result.wireless) && eqRow.siteId && eqRow.macAddress && siteRouter) {
      const sitePeers = await db.select().from(equipment)
        .where(and(
          eq(equipment.siteId, eqRow.siteId),
          ne(equipment.type, 'router'),
          orgFilter(equipment, orgId),
        ));
      const { enrichFromApStations } = await import('../snmpPoller.js');
      const enriched = await enrichFromApStations(
        [{ id: eqRow.id, name: eqRow.name, ...result }],
        sitePeers,
        siteRouter,
      );
      const mine = enriched.find((r) => r.id === eqRow.id);
      if (mine?.online && mine.wireless) {
        result = mine;
      } else if (mine?.apConfirmedDown) {
        result = { ...result, online: false, apConfirmedDown: true, error: mine.error || result.error };
      }
    }

    const { persistPollResult } = await import('../equipmentStatus.js');
    await persistPollResult(eqRow, result);
    return result;
  },

  'snmp-poll-batch': async ({ items, routerBySiteId }) =>
    pollEquipmentList(items, new Map(Object.entries(routerBySiteId || {}))),

  'snmp-poll-org': async ({ orgId }) => {
    const { pollAllSnmpForOrg } = await import('../equipmentStatus.js');
    return pollAllSnmpForOrg(orgId);
  },

  'ap-station-sync-org': async ({ orgId }) => {
    const { syncApStationPresenceForOrg } = await import('../equipmentStatus.js');
    return syncApStationPresenceForOrg(orgId);
  },

  'billing-org': async ({ orgId }) => runBillingJobsForOrg(orgId),

  'router-poll-org': async ({ orgId }) => {
    const { pollAllRoutersForOrg } = await import('../routerPoller.js');
    return pollAllRoutersForOrg(orgId);
  },

  'suspend-service': async ({ serviceId, orgId }) => {
    const { suspendServiceNetwork } = await import('../networkProvision.js');
    return suspendServiceNetwork(serviceId, orgId);
  },

  'reactivate-service': async ({ serviceId, orgId }) => {
    const { reactivateServiceNetwork } = await import('../networkProvision.js');
    return reactivateServiceNetwork(serviceId, orgId);
  },

  'sync-queue-metadata': async ({ serviceId, orgId }) => {
    const { syncServiceQueueMetadata } = await import('../networkProvision.js');
    return syncServiceQueueMetadata(serviceId, orgId);
  },

  'ip-resolve-org': async ({ orgId }) => {
    const { syncOrgLeases } = await import('../ipResolver.js');
    return syncOrgLeases(orgId);
  },

  'device-scan-org': async ({ orgId }) => {
    const { scanDevicesForOrg } = await import('../deviceScanner.js');
    return scanDevicesForOrg(orgId);
  },
};

export async function runTask(jobName, payload) {
  const fn = jobTasks[jobName];
  if (!fn) throw new Error(`Job desconocido: ${jobName}`);
  return fn(payload);
}
