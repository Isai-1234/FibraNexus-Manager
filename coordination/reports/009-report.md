# ORDEN 009 — Reporte (runner autónomo)

```yaml
order_id: "009"
status: failed
by: runner.mjs
executed_at: 2026-09-01T03:52:35.709Z
```

## Bloques ejecutados

### Bloque 1 — FAIL
```
"SNMP\""" no se reconoce como un comando interno o externo,
programa o archivo por lotes ejecutable.
Command failed: ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -i "C:\Users\Isaí\.ssh\id_ed25519" root@134.209.43.175 "export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin; pm2 logs fibranexus-worker --nostream --lines 20 | grep -E \"scheduler|SNMP\""
"SNMP\""" no se reconoce como un comando interno o externo,
programa o archivo por lotes ejecutable.

```

### Bloque 2 — OK
```
0
bull:*:67
bull:*:22
bull:*:1
bull:*:38
bull:*:32
bull:*:49
bull:*:18
bull:*:10
bull:*:85
bull:*:13

```

### Bloque 3 — OK
```
5|fibranex | [queue] enqueued router-poll-org#82
5|fibranex | [queue] enqueued snmp-poll-org#83
5|fibranex | [queue] enqueued router-poll-org#84
5|fibranex | [scheduler:scheduled] AP station sync dispatched for 3 org(s)
5|fibranex | [queue] enqueued ap-station-sync-org#85
5|fibranex | [queue] enqueued ap-station-sync-org#86
5|fibranex | [queue] enqueued ap-station-sync-org#87
5|fibranex | [queue] enqueued ip-resolve-org#88
5|fibranex | [queue] enqueued ip-resolve-org#89
5|fibranex | [queue] enqueued ip-resolve-org#90
5|fibranex | [scheduler:scheduled] AP station sync dispatched for 3 org(s)
5|fibranex | [queue] enqueued ap-station-sync-org#91
5|fibranex | [queue] enqueued ap-station-sync-org#92
5|fibranex | [queue] enqueued ap-station-sync-org#93


```

### Bloque 4 — FAIL
```
psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: FATAL:  Peer authentication failed for user "SELECT id, name, status, last_seen FROM equipment ORDER BY last"
Command failed: ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -i "C:\Users\Isaí\.ssh\id_ed25519" root@134.209.43.175 "export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin; sudo -u postgres psql -d fibranexus_prod -c \;   \"SELECT id, name, status, last_seen FROM equipment ORDER BY last_seen DESC LIMIT 5;\""
psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: FATAL:  Peer authentication failed for user "SELECT id, name, status, last_seen FROM equipment ORDER BY last"

```

### Bloque 5 — FAIL
```
"failed\" no se reconoce como un comando interno o externo,
programa o archivo por lotes ejecutable.
Command failed: ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -i "C:\Users\Isaí\.ssh\id_ed25519" root@134.209.43.175 "export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin; pm2 logs fibranexus-worker --nostream --lines 50 | grep -i \"error\|failed\|exception\" || echo \"Sin errores\""
"failed\" no se reconoce como un comando interno o externo,
programa o archivo por lotes ejecutable.

```

## Nota

Runner ejecuta bloques ```bash``` vía SSH. Ediciones de código complejas requieren agente Cursor o PASO explícito con sed/scp.
