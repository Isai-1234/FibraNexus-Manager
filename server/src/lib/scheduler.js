import { runsWorker } from './config.js';

let lastSchedulerHour = -1;

export function startScheduler() {
  if (!runsWorker()) {
    console.log('Scheduler disabled (PROCESS_ROLE=%s)', process.env.PROCESS_ROLE || 'all');
    return;
  }

  console.log('Billing scheduler active');

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
}
