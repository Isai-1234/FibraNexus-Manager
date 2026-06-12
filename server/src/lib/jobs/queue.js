import { shouldUseJobQueue } from '../config.js';
import { runTask } from './tasks.js';
import { enqueueRedis } from './redisQueue.js';

export const JobNames = {
  PROVISION_NETWORK: 'provision-network',
  SNMP_POLL_ONE: 'snmp-poll-one',
  SNMP_POLL_BATCH: 'snmp-poll-batch',
  SNMP_POLL_ORG: 'snmp-poll-org',
  BILLING_ORG: 'billing-org',
};

/**
 * Punto único para tareas pesadas.
 * Hoy: inline (sync). Mañana: Redis si USE_JOB_QUEUE=true.
 */
export async function dispatch(jobName, payload) {
  if (shouldUseJobQueue()) {
    return enqueueRedis(jobName, payload);
  }
  return runTask(jobName, payload);
}
