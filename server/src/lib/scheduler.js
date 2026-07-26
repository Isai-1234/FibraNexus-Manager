import { runsWorker } from './config.js';

let lastSchedulerHour = -1;

export function startScheduler() {
  if (!runsWorker()) {
    console.log('Scheduler disabled (PROCESS_ROLE=%s)', process.env.PROCESS_ROLE || 'all');
    return;
  }

  console.log('Billing scheduler active');

  // Primera pasada SNMP ~15s después del arranque (fire-and-forget)
  setTimeout(() => triggerSnmpRound('initial'), 15000);

  // Resolución de IPs dinámicas (DHCP/PPPoE): primera pasada 20s post-arranque, luego cada 90s
  setTimeout(() => triggerIpResolveRound('initial'), 20000);
  setInterval(() => triggerIpResolveRound('scheduled'), 90 * 1000);

  setInterval(async () => {
    const hour = new Date().getHours();
    if (hour === lastSchedulerHour) return;

    try {
      const { db } = await import('../db/index.js');
      const { organizations } = await import('../db/schema.js');
      const { eq } = await import('drizzle-orm');
      const { mergeOrgSettings } = await import('./orgSettings.js');
      const { dispatch, JobNames } = await import('./jobs/queue.js');
      const orgs = await db.select({ id: organizations.id, settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.isActive, true));

      let anyRan = false;
      for (const org of orgs) {
        const settings = mergeOrgSettings(org.settings);
        if (settings.billingHour === hour && (settings.billingAutoEnabled || settings.autoSuspendEnabled || settings.autoMarkOverdue)) {
          await dispatch(JobNames.BILLING_ORG, { orgId: org.id });
          anyRan = true;
        }
      }
      if (anyRan) lastSchedulerHour = hour;
    } catch (err) {
      console.error('Billing scheduler error:', err.message);
    }
  }, 60 * 1000);

  setInterval(async () => {
    try {
      const { markOverdueInvoices } = await import('./billingScheduler.js');
      const { db } = await import('../db/index.js');
      const { organizations } = await import('../db/schema.js');
      const { eq } = await import('drizzle-orm');
      const orgs = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isActive, true));
      for (const org of orgs) await markOverdueInvoices(org.id);
    } catch (err) {
      console.error('Overdue mark error:', err.message);
    }
  }, 6 * 60 * 60 * 1000);

  // SNMP: antenas/CPE — cada 3 minutos (poll completo: system + wireless MIB)
  setInterval(() => triggerSnmpRound('scheduled'), 3 * 60 * 1000);

  // Presencia airMAX estilo UISP: solo tabla de estaciones del AP, cada 45s
  setTimeout(() => triggerApStationSync('initial'), 20000);
  setInterval(() => triggerApStationSync('scheduled'), 45 * 1000);

  // Heartbeat stale check: marcar offline routers con agentToken sin heartbeat reciente
  setTimeout(() => markStaleHeartbeatRouters(), 30_000);
  setInterval(() => markStaleHeartbeatRouters(), 3 * 60 * 1000);

  // Device detection: primera pasada 45s post-arranque, luego cada 5 min
  setTimeout(() => triggerDeviceScanRound('initial'), 45_000);
  setInterval(() => triggerDeviceScanRound('scheduled'), 5 * 60 * 1000);

  // CPE offline: si last_seen > 10 min sin ARP/SNMP, marcar offline
  setTimeout(() => markStaleCpes(), 90_000);
  setInterval(() => markStaleCpes(), 5 * 60 * 1000);

  // Retención de métricas por org (Fase 1 SaaS)
  setTimeout(() => purgeOldMetrics(), 120_000);
  setInterval(() => purgeOldMetrics(), 6 * 60 * 60 * 1000);

  // Alertas operativas (Fase 4) — refresco periódico sin Redis
  setTimeout(() => refreshAlertsRound('initial'), 75_000);
  setInterval(() => refreshAlertsRound('scheduled'), 5 * 60 * 1000);
}

async function purgeOldMetrics() {
  try {
    const { db } = await import('../db/index.js');
    const { organizations, equipment, deviceMetrics } = await import('../db/schema.js');
    const { eq, and, lt } = await import('drizzle-orm');
    const orgs = await db.select({
      id: organizations.id,
      metricsRetentionDays: organizations.metricsRetentionDays,
    }).from(organizations);
    for (const org of orgs) {
      const days = org.metricsRetentionDays || 7;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const eqs = await db.select({ id: equipment.id }).from(equipment)
        .where(eq(equipment.organizationId, org.id));
      for (const e of eqs) {
        await db.delete(deviceMetrics)
          .where(and(eq(deviceMetrics.equipmentId, e.id), lt(deviceMetrics.sampledAt, cutoff)));
      }
    }
  } catch (err) {
    console.error('[scheduler:metrics-retention] error: %s', err.message);
  }
}

async function refreshAlertsRound(label) {
  try {
    const { refreshAlertsAllOrgs } = await import('./orgAlerts.js');
    const results = await refreshAlertsAllOrgs();
    console.log('[scheduler:alerts:%s] orgs=%d', label, results.length);
  } catch (err) {
    console.error('[scheduler:alerts:%s] error: %s', label, err.message);
  }
}

async function triggerIpResolveRound(label) {
  try {
    const { db } = await import('../db/index.js');
    const { organizations } = await import('../db/schema.js');
    const { eq } = await import('drizzle-orm');
    const { dispatch, JobNames } = await import('./jobs/queue.js');
    const orgs = await db.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.isActive, true));
    for (const org of orgs) {
      dispatch(JobNames.IP_RESOLVE_ORG, { orgId: org.id })
        .catch((err) => console.error('[scheduler:ip-resolve] org=%d error: %s', org.id, err.message));
    }
  } catch (err) {
    console.error('[scheduler:ip-resolve:%s] error: %s', label, err.message);
  }
}

async function markStaleHeartbeatRouters() {
  try {
    const { db } = await import('../db/index.js');
    const { equipment } = await import('../db/schema.js');
    const { eq } = await import('drizzle-orm');
    const routers = await db.select().from(equipment).where(eq(equipment.type, 'router'));
    const staleMs = 3 * 60 * 1000; // sin heartbeat en 3 min → offline
    const now = Date.now();
    for (const r of routers) {
      const lh = r.credentials?.agentToken && r.credentials?.lastHeartbeat;
      if (!lh) continue; // sin agentToken → no es heartbeat router
      const age = now - new Date(r.credentials.lastHeartbeat).getTime();
      if (age > staleMs && r.status === 'online') {
        await db.update(equipment)
          .set({ status: 'offline', updatedAt: new Date() })
          .where(eq(equipment.id, r.id));
        console.log(`[scheduler:heartbeat-stale] router ${r.id} (${r.name}) marcado offline (sin heartbeat ${Math.round(age/60000)}min)`);
      }
    }
  } catch (err) {
    console.error('[scheduler:heartbeat-stale] error:', err.message);
  }
}

async function triggerDeviceScanRound(label) {
  try {
    const { db } = await import('../db/index.js');
    const { organizations } = await import('../db/schema.js');
    const { eq } = await import('drizzle-orm');
    const { dispatch, JobNames } = await import('./jobs/queue.js');
    const orgs = await db.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.isActive, true));
    for (const org of orgs) {
      dispatch(JobNames.DEVICE_SCAN_ORG, { orgId: org.id })
        .catch((err) => console.error('[scheduler:device-scan] org=%d error: %s', org.id, err.message));
    }
    console.log('[scheduler:device-scan:%s] dispatched for %d org(s)', label, orgs.length);
  } catch (err) {
    console.error('[scheduler:device-scan:%s] error: %s', label, err.message);
  }
}

async function markStaleCpes() {
  try {
    const { db } = await import('../db/index.js');
    const { equipment } = await import('../db/schema.js');
    const { and, eq, sql } = await import('drizzle-orm');
    const result = await db.update(equipment)
      .set({ status: 'offline', updatedAt: new Date() })
      .where(and(
        eq(equipment.status, 'online'),
        eq(equipment.type, 'cpe'),
        sql`${equipment.lastSeen} IS NOT NULL`,
        sql`${equipment.lastSeen} < NOW() - INTERVAL '10 minutes'`,
      ))
      .returning({ id: equipment.id });
    if (result.length) console.log('[scheduler:stale-cpes] marcados offline:', result.map(r => r.id).join(','));
  } catch (err) {
    console.error('[scheduler:stale-cpes] error:', err.message);
  }
}

async function triggerSnmpRound(label) {
  try {
    const { db } = await import('../db/index.js');
    const { organizations } = await import('../db/schema.js');
    const { eq } = await import('drizzle-orm');
    const { dispatch, JobNames } = await import('./jobs/queue.js');
    const orgs = await db.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.isActive, true));
    // Fire-and-forget por org: el poll puede tardar más que el intervalo y eso es OK
    for (const org of orgs) {
      dispatch(JobNames.SNMP_POLL_ORG, { orgId: org.id })
        .catch((err) => console.error('SNMP poll org %d error: %s', org.id, err.message));
      dispatch(JobNames.ROUTER_POLL_ORG, { orgId: org.id })
        .catch((err) => console.error('Router poll org %d error: %s', org.id, err.message));
    }
    console.log('[scheduler:%s] SNMP + router dispatched for %d org(s)', label, orgs.length);
  } catch (err) {
    console.error('[scheduler:%s] error: %s', label, err.message);
  }
}

async function triggerApStationSync(label) {
  try {
    const { db } = await import('../db/index.js');
    const { organizations } = await import('../db/schema.js');
    const { eq } = await import('drizzle-orm');
    const { dispatch, JobNames } = await import('./jobs/queue.js');
    const orgs = await db.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.isActive, true));
    for (const org of orgs) {
      dispatch(JobNames.AP_STATION_SYNC_ORG, { orgId: org.id })
        .catch((err) => console.error('AP station sync org %d error: %s', org.id, err.message));
    }
    console.log('[scheduler:%s] AP station sync dispatched for %d org(s)', label, orgs.length);
  } catch (err) {
    console.error('[scheduler:ap-station:%s] error: %s', label, err.message);
  }
}
