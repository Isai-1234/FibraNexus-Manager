import { shouldUseJobQueue } from '../config.js';
import { runTask } from './tasks.js';
import { enqueueRedis } from './redisQueue.js';

export const JobNames = {
  PROVISION_NETWORK: 'provision-network',
  SNMP_POLL_ONE: 'snmp-poll-one',
  SNMP_POLL_BATCH: 'snmp-poll-batch',
  SNMP_POLL_ORG: 'snmp-poll-org',
  IP_RESOLVE_ORG: 'ip-resolve-org',
  BILLING_ORG: 'billing-org',
  ROUTER_POLL_ORG: 'router-poll-org',
  SUSPEND_SERVICE: 'suspend-service',
  REACTIVATE_SERVICE: 'reactivate-service',
  SYNC_QUEUE_METADATA: 'sync-queue-metadata',
};

/**
 * Punto único para tareas pesadas.
 * Hoy: inline (sync). Mañana: Redis si USE_JOB_QUEUE=true.
 */
export async function dispatch(jobName, payload) {
  if (shouldUseJobQueue()) {
    try {
      return await enqueueRedis(jobName, payload);
    } catch (err) {
      console.warn('Redis enqueue failed, falling back to inline execution: %s', err.message);
      return runTask(jobName, payload);
    }
  }
  return runTask(jobName, payload);
}
