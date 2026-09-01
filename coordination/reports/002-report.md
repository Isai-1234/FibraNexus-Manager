# ORDEN 002 — Reporte

```yaml
order_id: "002"
status: completed
by: cursor
executed_at: 2026-09-01T03:05:00Z
verdict: recovered_after_crash
```

## Summary

`pm2 restart fibranexus-api` provocó crash loop por `/root/app/.env` tóxico. Cursor aplicó fix y PM2 limpio.

## Output

Causa:

```
USE_JOB_QUEUE=true  → FATAL (Redis stub)
DATABASE_URL=postgresql://postgres:postgres@...  (credenciales malas)
```

Fix:

1. `USE_JOB_QUEUE=false` en `/root/app/.env`
2. Eliminado DATABASE_URL incorrecto de root `.env`
3. `pm2 delete` + `pm2 start` con `--cwd /root/app/server`

Final:

```
[boot] DATABASE_URL: present (len=76)
Billing scheduler active
🚀 FibraNexus Manager API on port 3000
health: status ok, database connected
```

## Analysis

| Pregunta | Respuesta |
|----------|-----------|
| DATABASE_URL present? | SÍ |
| API sin errores? | SÍ (tras fix) |
| Scheduler BD? | SÍ |

## Errors

Restart naive falló antes del fix.

## Next

No poner `USE_JOB_QUEUE=true` ni DATABASE_URL en `/root/app/.env`.
