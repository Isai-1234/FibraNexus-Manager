# ORDEN 007 — fix (Cursor)

```yaml
order_id: "007"
status: completed
by: cursor
executed_at: 2026-09-01T03:40:00Z
```

## Timer SÍ funcionó

`runner.log` muestra:
- 03:32 → ORDEN 006 (colgó 2min, luego completó)
- 03:38 → ORDEN 007 (21s, **failed** parcial)

## Por qué pareció que no

1. **006 se colgó** 2 min en `pm2 logs` sin `--nostream`
2. **007 falló** — Windows rompía `grep | pipes` en SSH
3. **PASO 1** era comentarios, no `sed` ejecutable
4. Marcaba `done` aunque fallara

## Fix runner (ahora)

- SSH vía **base64 + bash** (pipes OK en Windows)
- `pm2 logs --nostream` auto
- `sed` auto para cambios PROCESS_ROLE
- STATUS `failed` si algún bloque falla

## ORDEN 007 aplicada

```
API:  PROCESS_ROLE=api  → Scheduler disabled ✅
health: processRole api, jobQueue redis
Worker: fibranexus-worker online (BullMQ)
```

⚠️ `worker-bullmq.js` **no arranca scheduler** — solo consume cola. Scheduler sigue off hasta ORDEN que lo mueva al worker o proceso aparte.
