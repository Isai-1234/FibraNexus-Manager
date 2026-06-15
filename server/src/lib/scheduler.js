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

  // SNMP: antenas/CPE — cada 3 minutos, fire-and-forget para no bloquear el event loop
  setInterval(() => triggerSnmpRound('scheduled'), 3 * 60 * 1000);

  // Heartbeat stale check: marcar offline routers con agentToken sin heartbeat reciente
  setTimeout(() => markStaleHeartbeatRouters(), 30_000);
  setInterval(() => markStaleHeartbeatRouters(), 3 * 60 * 1000);

  // Device detection: primera pasada 45s post-arranque, luego cada 5 min
  setTimeout(() => triggerDeviceScanRound('initial'), 45_000);
  setInterval(() => triggerDeviceScanRound('scheduled'), 5 * 60 * 1000);
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
