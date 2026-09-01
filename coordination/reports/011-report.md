# ORDEN 011 — Worker BullMQ real

**status:** ok  
**by:** cursor  
**executed_at:** 2026-09-01T04:14:30Z

## Cambios

- `server/src/worker-bullmq.js` — delega a `runTask()` (tasks.js)
- `server/src/lib/jobs/redisQueue.js` — cola única `*` con BullMQ
- `server/src/lib/jobs/redisConnection.js` — conexión compartida
- `server/src/index.js` — quitado guard FATAL de USE_JOB_QUEUE
- `server/src/lib/config.js` — `shouldUseJobQueue()` acepta REDIS_HOST

## VPS

- `pnpm --filter fibranexus-server add bullmq ioredis`
- `pm2 restart fibranexus-worker fibranexus-api`

## Verificación

```
[Worker] snmp-poll-org#275 processing
[Worker] snmp-poll-org#275 done
[Worker] ap-station-sync-org#285 done
```

### last_seen (recientes)

| id | name | last_seen |
|----|------|-----------|
| 3 | Loco Cliente Lab | 2026-09-01 04:12:42 |
| 2 | Loco Sectorial Lab | 2026-09-01 04:12:42 |
| 1 | L009 Lab Camino A | 2026-09-01 04:12:31 |

### Sin last_seen (esperado)

Equipos 6,7,9 no tienen `snmp_community` — no son pollables por SNMP hasta configurarlo.

## Health

`jobQueue: redis`, `processRole: api`, DB connected.
