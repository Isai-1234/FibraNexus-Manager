# ORDER.md — Órdenes de Claude PC a Cursor

## STATUS: done

## ORDEN 009

**from:** claude-pc  
**id:** 009  
**timestamp:** 2026-09-01T03:50:00Z  
**status:** done  
**phase:** C (device tracking end-to-end)

## TASK

**Objetivo:** Verificar device tracking completo: SNMP → BD actualizadas

**CONTEXTO:**
- FASE A-B: scheduler + worker + Redis ✅
- FASE C: verificar que SNMP actualiza equipment.last_seen correctamente

**PASO 1:** Verifica que scheduler está activo en worker:
```bash
pm2 logs fibranexus-worker --nostream --lines 20 | grep -E "scheduler|SNMP"
```

**PASO 2:** Verifica que jobs se encolaron:
```bash
redis-cli LLEN fibranexus-jobs || echo "Queue no existe"
redis-cli KEYS "bull:*" | head -10
```

**PASO 3:** Verifica que worker procesa (últimas 30 líneas):
```bash
pm2 logs fibranexus-worker --nostream --lines 30 | tail -15
```

**PASO 4:** Consulta BD — equipment actualizado (últimas 5):
```bash
sudo -u postgres psql -d fibranexus_prod -c \
  "SELECT id, name, status, last_seen FROM equipment ORDER BY last_seen DESC LIMIT 5;"
```

**PASO 5:** Verifica que no hay errores de SNMP en worker:
```bash
pm2 logs fibranexus-worker --nostream --lines 50 | grep -i "error\|failed\|exception" || echo "Sin errores"
```

**PASO 6:** Reporta en `coordination/REPORT.md`:
- ¿Scheduler está activo ([scheduler] en logs)?
- ¿Jobs en Redis?
- ¿Worker procesa (log lines)?
- ¿equipment.last_seen tiene valores recientes?
- ¿Hay errores de SNMP?

## ESPERADO

```
[scheduler] SNMP_POLL_ORG dispatched
[queue] enqueued snmp-poll-org#XXX
[Worker] snmp-poll-org#XXX processing
[Worker] snmp-poll-org#XXX completed
equipment.last_seen: 2026-09-01 03:50:XX (actual)
```

## PRÓXIMO PASO

Si SUCCESS → FASE C COMPLETA: device tracking operacional ✅
Si ERROR → diagnosticar qué sensor falla

---

**runner.mjs ejecutará esto automáticamente (solo bash).**


---
**completed_by:** runner.mjs
**completed_at:** 2026-09-01T03:52:35.710Z
