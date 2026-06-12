import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { config, runsApi, runsWorker, shouldUseJobQueue } from './config.js';

export async function getHealthPayload() {
  const checks = {
    database: 'unknown',
    latencyMs: null,
  };

  let status = 'ok';

  if (config.databaseUrl) {
    const t0 = Date.now();
    try {
      await db.execute(sql`SELECT 1`);
      checks.database = 'connected';
      checks.latencyMs = Date.now() - t0;
    } catch (err) {
      status = 'degraded';
      checks.database = 'error';
      checks.error = err.message;
    }
  } else {
    status = 'degraded';
    checks.database = 'not_configured';
  }

  return {
    status,
    name: 'FibraNexus Manager',
    version: '1.2.0',
    commit: config.commit,
    features: ['ola1-billing', 'network-manager', 'auto-suspend', 'dhcp-pppoe-snmp', 'scale-ready', 'pppoe-server', 'next-free-ip', 'snmp-auto-status'],
    runtime: {
      processRole: config.processRole,
      runsApi: runsApi(),
      runsWorker: runsWorker(),
      jobQueue: shouldUseJobQueue() ? 'redis' : 'inline',
      node: process.version,
      uptimeSec: Math.floor(process.uptime()),
      heapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    },
    checks,
    timestamp: new Date().toISOString(),
  };
}
