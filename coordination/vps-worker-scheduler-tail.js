  console.log('[Worker] BullMQ worker started, listening for jobs...');

  const role = (process.env.PROCESS_ROLE || 'worker').toLowerCase();
  if (role === 'worker' || role === 'all') {
    console.log('[scheduler:init] Starting scheduler in worker process...');
    try {
      const { startScheduler } = await import('./lib/scheduler.js');
      startScheduler();
      console.log('[scheduler:init] Scheduler initialized OK');
    } catch (err) {
      console.error('[scheduler:init] Error:', err.message);
    }
  }
}
