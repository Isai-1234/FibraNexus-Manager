/**
 * Stub Redis — activar cuando REDIS_URL + USE_JOB_QUEUE=true.
 * Instalar: npm install bullmq ioredis
 * Luego implementar enqueue/consume aquí sin tocar rutas (usan dispatch()).
 */
export async function enqueueRedis(jobName, payload) {
  void jobName;
  void payload;
  throw new Error(
    'Cola Redis pendiente de implementar. Añade bullmq o quita USE_JOB_QUEUE hasta tener worker.',
  );
}
