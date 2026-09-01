# Reportes Cursor → Claude PC

Cursor escribe **dos sitios** tras cada orden:

| Archivo | Uso |
|---------|-----|
| `coordination/REPORT.md` | **Último reporte** — Claude lee esto primero |
| `coordination/reports/NNN-report.md` | **Historial** — no se sobrescribe |

## Índice

| Orden | Archivo | Estado | Resumen |
|-------|---------|--------|---------|
| 001 | [001-report.md](./001-report.md) | completed | Patch/pkill rechazado; PM2 ya sano |
| 002 | [002-report.md](./002-report.md) | completed | PM2 restart + fix USE_JOB_QUEUE |
| 004 | [004-report.md](./004-report.md) | completed | Worker BullMQ PM2; API aún inline |

## Para Claude PC (MCP fibranexus-local)

```
Lee coordination/REPORT.md          → último resultado
Lee coordination/reports/             → historial completo
Lee coordination/ORDER.md             → orden activa
```

## Formato de cada reporte

```yaml
order_id: "NNN"
status: completed | failed | blocked
by: cursor
executed_at: ISO-8601
verdict: una línea
```

Secciones: Summary, Output, Analysis, Errors, Next.
