# ORDEN 007 — Reporte (runner autónomo)

```yaml
order_id: "007"
status: failed
by: runner.mjs
executed_at: 2026-09-01T03:38:52.400Z
```

## Bloques ejecutados

### Bloque 1 — OK
```

```

### Bloque 2 — FAIL
```
Command failed: ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -i "C:\Users\Isaí\.ssh\id_ed25519" root@134.209.43.175 "export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin; cat /root/app/.env | grep PROCESS_ROLE"
```

### Bloque 3 — OK
```
Use --update-env to update environment variables
[PM2] Applying action restartProcessId on app [fibranexus-api](ids: [ 2 ])
[PM2] [fibranexus-api](2) ✓
┌────┬──────────────────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┬──────────┬──────────┬──────────┬──────────┐
│ id │ name                 │ namespace   │ version │ mode    │ pid      │ uptime │ ↺    │ status    │ cpu      │ mem      │ user     │ watching │
├────┼──────────────────────┼─────────────┼─────────┼─────────┼──────────┼────────┼──────┼───────────┼──────────┼──────────┼──────────┼──────────┤
│ 2  │ fibranexus-api       │ default     │ 1.2.9   │ fork    │ 1192827  │ 0s     │ 4    │ online    │ 0%       │ 18.8mb   │ root     │ disabled │
│ 3  │ fibranexus-worker    │ default     │ 1.2.9   │ fork    │ 1192537  │ 2m     │ 2    │ online    │ 0%       │ 79.2mb   │ root     │ disabled │
│ 1  │ internetsur-api      │ default     │ N/A     │ fork    │ 1187836  │ 72m    │ 31   │ online    │ 0%       │ 55.0mb   │ root     │ disabled │
└────┴──────────────────────┴─────────────┴─────────┴─────────┴──────────┴────────┴──────┴───────────┴──────────┴──────────┴──────────┴──────────┘
host metrics | cpu: 1.5% | ram usage: 37.4% | lo: ⇓ 0.001mb/s ⇑ 0.001mb/s | disk: ⇓ 0.023mb/s ⇑ 0.009mb/s |
[TAILING] Tailing last 20 lines for [fibranexus-api] process (change the value with --lines option)
/root/.pm2/logs/fibranexus-api-error.log last 20 lines:
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.
2|fibranex | FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.

/root/.pm2/logs/fibranexus-api-out.log last 20 lines:
2|fibranex | }
2|fibranex | [migrate] skip 001_security_hardening
2|fibranex | [migrate] skip 002_saas_platform
2|fibranex | [migrate] skip 003_office_role
2|fibranex | [migrate] skip 004_crm_lifecycle
2|fibranex | [migrate] skip 005_billing_payments
2|fibranex | [migrate] skip 006_org_alerts
2|fibranex | [migrate] skip 007_expenses
2|fibranex | [migrate] skip 008_dte_pilot
2|fibranex | [migrate] skip 009_wisphub_import
2|fibranex | [migrate] skip 010_wisphub_plan_precio
2|fibranex | [migrate] skip 011_service_custom_price
2|fibranex | [migrate] skip 012_service_uisp_billing
2|fibranex | [migrate] skip 013_service_facturar_desde
2|fibranex | [migrate] skip 014_repair_utf8_mojibake
2|fibranex | [migrate] skip 015_repair_org_settings_json
2|fibranex | [migrate] skip 016_network_pools
2|fibranex | [migrate] versioned OK
2|fibranex | Billing scheduler active
2|fibranex | 🚀 FibraNexus Manager API on port 3000 (role=all)


```

### Bloque 4 — OK
```
[PM2] Saving current process list...
[PM2] Successfully saved in /root/.pm2/dump.pm2
[TAILING] Tailing last 20 lines for [fibranexus-worker] process (change the value with --lines option)
/root/.pm2/logs/fibranexus-worker-error.log last 20 lines:
/root/.pm2/logs/fibranexus-worker-out.log last 20 lines:
3|fibranex |   severity_local: 'NOTICE',
3|fibranex |   severity: 'NOTICE',
3|fibranex |   code: '42P07',
3|fibranex |   message: 'relation "password_reset_tokens" already exists, skipping',
3|fibranex |   file: 'parse_utilcmd.c',
3|fibranex |   line: '207',
3|fibranex |   routine: 'transformCreateStmt'
3|fibranex | }
3|fibranex | {
3|fibranex |   severity_local: 'NOTICE',
3|fibranex |   severity: 'NOTICE',
3|fibranex |   code: '42P07',
3|fibranex |   message: 'relation "idx_password_reset_user" already exists, skipping',
3|fibranex |   file: 'index.c',
3|fibranex |   line: '884',
3|fibranex |   routine: 'index_create'
3|fibranex | }
3|fibranex | Multi-tenant migration OK (indexes applied)
3|fibranex | [Worker] Migrations completed
3|fibranex | [Worker] BullMQ worker started, listening for jobs...


```

### Bloque 5 — FAIL
```
El sistema no puede encontrar la ruta especificada.
Command failed: ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -i "C:\Users\Isaí\.ssh\id_ed25519" root@134.209.43.175 "export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin; pm2 status; pm2 logs fibranexus-api --nostream --lines 15 | grep -E \"scheduler|health\"; pm2 logs fibranexus-worker --nostream --lines 15 | grep -E \"scheduler|Worker\""
El sistema no puede encontrar la ruta especificada.

```

## Nota

Runner ejecuta bloques ```bash``` vía SSH. Ediciones de código complejas requieren agente Cursor o PASO explícito con sed/scp.
