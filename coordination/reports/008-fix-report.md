# ORDEN 008 — fix

```yaml
order_id: "008"
status: completed
by: cursor
```

## ¿Funciona la lectura automática?

| Quién | ¿Lee ORDER.md cada 5s? |
|-------|-------------------------|
| **Yo (chat Cursor)** | **NO** — solo cuando escribes aquí |
| **`runner.mjs`** | **SÍ** — log: ORDEN 008 a las 03:42 |

## Por qué 008 falló en runner

- `SchedulerManager.js` **no existe** en el repo
- Edits en bloques `javascript` **no los ejecuta** el runner (solo `bash`)
- Bloque 1 grep falló (exit code)

## Fix aplicado

- `worker-bullmq.js` → `startScheduler()` en worker
- Logs:
```
[scheduler:init] Scheduler initialized OK
[scheduler:initial] SNMP + router dispatched for 3 org(s)
[queue] enqueued ap-station-sync-org#49
```

FASE C operacional.
