# Coordinación Claude PC ↔ Cursor (archivos)

Canal de órdenes sin MCP directo entre clientes. Ambos leen/escriben en `coordination/`.

## Archivos

| Archivo | Quién escribe | Quién lee |
|---------|---------------|-----------|
| `ORDER.md` | Claude PC | Cursor |
| `REPORT.md` | Cursor | Claude PC (último reporte) |
| `reports/NNN-report.md` | Cursor | Claude PC (historial) |

## Flujo

```
Claude PC → ORDER.md (pending)
     ↓
Cursor   → ejecuta
     ↓
Cursor   → REPORT.md + reports/NNN-report.md
     ↓
Claude PC → lee REPORT.md (o reports/ para historial)
```

## Formato ORDER.md

```yaml
status: pending          # pending | in_progress | done | cancelled
id: "001"                # incrementar cada orden
from: claude-pc
created: 2026-09-01T00:00:00Z
priority: normal         # low | normal | high
```

Sección **Task**: qué hacer (texto libre).

Sección **VPS** (opcional): comandos exactos o objetivo en `/root/app`.

Sección **Acceptance**: cómo saber que quedó listo.

## Formato REPORT.md

```yaml
order_id: "001"
status: completed        # completed | failed | blocked
by: cursor
executed_at: 2026-09-01T00:00:00Z
duration_sec: 0
```

Secciones: **Summary**, **Output**, **Errors** (si hay), **Next** (opcional).

## Reglas

1. Una orden activa a la vez (`ORDER.status` ≠ `pending` → Cursor no toma otra).
2. Claude PC no edita `REPORT.md`; Cursor no edita la Task de una orden cerrada.
3. IDs correlacionados: `REPORT.order_id` = `ORDER.id`.
4. VPS: `root@134.209.43.175`, PATH NVM:
   `export PATH=/root/.nvm/versions/node/v20.20.2/bin:$PATH`
5. No commitear secretos en ORDER/REPORT.

## Automatización (sin copy-paste)

### Cursor — `runner.mjs` (ejecuta órdenes)

```bash
node coordination/runner.mjs 5
# o doble-click: coordination/start-runner.bat
```

- Poll cada **5s** → lee `ORDER.md` → ejecuta bloques `bash` vía SSH → escribe `REPORT.md` + `reports/NNN-report.md` + `INBOX.md`
- **No requiere chat Cursor abierto**
- Limitación: solo bloques bash; edits de código necesitan agente o scp en la orden

### Claude PC — leer respuestas

Poll cada 10–15s (MCP `fibranexus-local`):

1. `coordination/INBOX.md` — cambió → hay reporte nuevo
2. `coordination/REPORT.md` — último resultado
3. `coordination/ORDER.md` — `status: done` → Cursor/runner terminó

### Conversación Claude ↔ Cursor

```
Claude → ORDER.md (pending)
Runner → ejecuta → REPORT.md + INBOX.md + ORDER done
Claude → lee INBOX/REPORT → escribe siguiente ORDER
```

`watch.mjs` queda opcional (solo despertaba agente; reemplazado por runner).

## Watcher + timer (legacy)

```bash
node coordination/watch.mjs 5
```

- `fs.watch` + **poll cada 20s** (ajustable: `node coordination/watch.mjs 30`)
- Si `ORDER.md` tiene `status: pending` → emite `AGENT_LOOP_WAKE_COORDINATION`
- `.lock` evita doble ejecución; `state.json` evita spam de notificaciones
- **Requiere chat Cursor abierto** para que el agente reaccione al wake

## Primera orden

Claude PC: reemplaza `ORDER.md` con `status: pending` y tu tarea.
Cursor: responde en `REPORT.md` y marca `ORDER.status: done`.
