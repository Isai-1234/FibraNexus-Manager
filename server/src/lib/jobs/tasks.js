import { provisionServiceNetwork } from '../networkProvision.js';
import { pollDeviceSnmp, pollEquipmentList } from '../snmpPoller.js';
import { runBillingJobsForOrg } from '../billingScheduler.js';
import { db } from '../../db/index.js';
import { equipment } from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
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
    let siteRouter = null;
    if (eqRow.siteId) {
      const [r] = await db.select().from(equipment)
        .where(and(eq(equipment.siteId, eqRow.siteId), eq(equipment.type, 'router'), orgFilter(equipment, orgId)))
        .limit(1);
      siteRouter = r || null;
    }
    return pollDeviceSnmp(eqRow, siteRouter);
  },

  'snmp-poll-batch': async ({ items, routerBySiteId }) =>
    pollEquipmentList(items, new Map(Object.entries(routerBySiteId || {}))),

  'snmp-poll-org': async ({ orgId }) => {
    const { pollAllSnmpForOrg } = await import('../equipmentStatus.js');
    return pollAllSnmpForOrg(orgId);
  },

  'billing-org': async ({ orgId }) => runBillingJobsForOrg(orgId),

  'router-poll-org': async ({ orgId }) => {
    const { pollAllRoutersForOrg } = await import('../routerPoller.js');
    return pollAllRoutersForOrg(orgId);
  },
};

export async function runTask(jobName, payload) {
  const fn = jobTasks[jobName];
  if (!fn) throw new Error(`Job desconocido: ${jobName}`);
  return fn(payload);
}
