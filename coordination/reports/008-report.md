# ORDEN 008 — Reporte (runner autónomo)

```yaml
order_id: "008"
status: failed
by: runner.mjs
executed_at: 2026-09-01T03:42:53.868Z
```

## Bloques ejecutados

### Bloque 1 — FAIL
```
Command failed: ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -i "C:\Users\Isaí\.ssh\id_ed25519" root@134.209.43.175 "echo ZXhwb3J0IFBBVEg9L3Jvb3QvLm52bS92ZXJzaW9ucy9ub2RlL3YyMC4yMC4yL2JpbjovdXNyL2JpbjovYmluCmdyZXAgLXIgInNjaGVkdWxlclN0YXJ0XHxpbml0U2NoZWR1bGVyXHxTY2hlZHVsZXJNYW5hZ2VyIiAvcm9vdC9hcHAvc2VydmVyL3NyYy8gLS1pbmNsdWRlPSIqLmpzIg== | base64 -d | bash"
```

### Bloque 2 — OK
```
4|fibranex | [snmp-poll-org] org=1
4|fibranex | [snmp-poll-org] org=1: sin equipos

```

### Bloque 3 — OK
```
Use --update-env to update environment variables
[PM2] Applying action restartProcessId on app [fibranexus-worker](ids: [ 4 ])
[PM2] [fibranexus-worker](4) ✓
┌────┬──────────────────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┬──────────┬──────────┬──────────┬──────────┐
│ id │ name                 │ namespace   │ version │ mode    │ pid      │ uptime │ ↺    │ status    │ cpu      │ mem      │ user     │ watching │
├────┼──────────────────────┼─────────────┼─────────┼─────────┼──────────┼────────┼──────┼───────────┼──────────┼──────────┼──────────┼──────────┤
│ 2  │ fibranexus-api       │ default     │ 1.2.9   │ fork    │ 1193039  │ 2m     │ 5    │ online    │ 0%       │ 82.2mb   │ root     │ disabled │
│ 4  │ fibranexus-worker    │ default     │ 1.2.9   │ fork    │ 1193268  │ 0s     │ 1    │ online    │ 0%       │ 18.8mb   │ root     │ disabled │
│ 1  │ internetsur-api      │ default     │ N/A     │ fork    │ 1187836  │ 76m    │ 31   │ online    │ 0%       │ 55.0mb   │ root     │ disabled │
└────┴──────────────────────┴─────────────┴─────────┴─────────┴──────────┴────────┴──────┴───────────┴──────────┴──────────┴──────────┴──────────┘
host metrics | cpu: 0.8% | ram usage: 38.9% | lo: ⇓ 0.001mb/s ⇑ 0.001mb/s | disk: ⇓ 0mb/s ⇑ 0.009mb/s |
[TAILING] Tailing last 50 lines for [fibranexus-worker] process (change the value with --lines option)
/root/.pm2/logs/fibranexus-worker-error.log last 50 lines:
/root/.pm2/logs/fibranexus-worker-out.log last 50 lines:
4|fibranex | {
4|fibranex |   severity_local: 'NOTICE',
4|fibranex |   severity: 'NOTICE',
4|fibranex |   code: '42P07',
4|fibranex |   message: 'relation "idx_device_metrics_equip_time" already exists, skipping',
4|fibranex |   file: 'index.c',
4|fibranex |   line: '884',
4|fibranex |   routine: 'index_create'
4|fibranex | }
4|fibranex | {
4|fibranex |   severity_local: 'NOTICE',
4|fibranex |   severity: 'NOTICE',
4|fibranex |   code: '42P07',
4|fibranex |   message: 'relation "ticket_messages" already exists, skipping',
4|fibranex |   file: 'parse_utilcmd.c',
4|fibranex |   line: '207',
4|fibranex |   routine: 'transformCreateStmt'
4|fibranex | }
4|fibranex | {
4|fibranex |   severity_local: 'NOTICE',
4|fibranex |   severity: 'NOTICE',
4|fibranex |   code: '42P07',
4|fibranex |   message: 'relation "idx_ticket_messages_ticket_id" already exists, skipping',
4|fibranex |   file: 'index.c',
4|fibranex |   line: '884',
4|fibranex |   routine: 'index_create'
4|fibranex | }
4|fibranex | {
4|fibranex |   severity_local: 'NOTICE',
4|fibranex |   severity: 'NOTICE',
4|fibranex |   code: '42P07',
4|fibranex |   message: 'relation "password_reset_tokens" already exists, skipping',
4|fibranex |   file: 'parse_utilcmd.c',
4|fibranex |   line: '207',
4|fibranex |   routine: 'transformCreateStmt'
4|fibranex | }
4|fibranex | {
4|fibranex |   severity_local: 'NOTICE',
4|fibranex |   severity: 'NOTICE',
4|fibranex |   code: '42P07',
4|fibranex |   message: 'relation "idx_password_reset_user" already exists, skipping',
4|fibranex |   file: 'index.c',
4|fibranex |   line: '884',
4|fibranex |   routine: 'index_create'
4|fibranex | }
4|fibranex | Multi-tenant migration OK (indexes applied)
4|fibranex | [Worker] Migrations completed
4|fibranex | [Worker] BullMQ worker started, listening for jobs...
4|fibranex | [snmp-poll-org] org=1
4|fibranex | [snmp-poll-org] org=1: sin equipos


```

### Bloque 4 — FAIL
```
Command failed: ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -i "C:\Users\Isaí\.ssh\id_ed25519" root@134.209.43.175 "echo ZXhwb3J0IFBBVEg9L3Jvb3QvLm52bS92ZXJzaW9ucy9ub2RlL3YyMC4yMC4yL2JpbjovdXNyL2JpbjovYmluCnBtMiBsb2dzIGZpYnJhbmV4dXMtd29ya2VyIC0tbm9zdHJlYW0gLS1saW5lcyA1MCAgLS1ub3N0cmVhbXwgZ3JlcCAtRSAic2NoZWR1bGVyfGRpc3BhdGNofGVucXVldWV8U05NUCI= | base64 -d | bash"
```

### Bloque 5 — OK
```
[TAILING] Tailing last 30 lines for [fibranexus-api] process (change the value with --lines option)
/root/.pm2/logs/fibranexus-api-error.log last 30 lines:
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

/root/.pm2/logs/fibranexus-api-out.log last 30 lines:
2|fibranex | }
2|fibranex | Multi-tenant migration OK (indexes applied)
2|fibranex | {
2|fibranex |   severity_local: 'NOTICE',
2|fibranex |   severity: 'NOTICE',
2|fibranex |   code: '42P07',
2|fibranex |   message: 'relation "schema_migrations" already exists, skipping',
2|fibranex |   file: 'parse_utilcmd.c',
2|fibranex |   line: '207',
2|fibranex |   routine: 'transformCreateStmt'
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
2|fibranex | Scheduler disabled (PROCESS_ROLE=api)
2|fibranex | 🚀 FibraNexus Manager API on port 3000 (role=api)


```

## Nota

Runner ejecuta bloques ```bash``` vía SSH. Ediciones de código complejas requieren agente Cursor o PASO explícito con sed/scp.
