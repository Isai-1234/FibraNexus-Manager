# Bridge — Claude Desktop ↔ Cursor (cualquier proyecto)

Daemon Node.js que:
1. Lee `order.json` (Claude escribe, ~10 líneas)
2. Ejecuta comandos VPS vía SSH
3. Escribe `status.json` (**compacto**, ~5 líneas — pocos tokens)
4. Si hace falta código → `agent.json` para Cursor

## Instalación en un proyecto nuevo

### 1. Copia la carpeta `coordination/`

Copia estos archivos a la raíz de tu repo (ej. `mi-proyecto/coordination/`):

```
coordination/
├── bridge.mjs          ← el programa (portable, sin npm install)
├── bridge.config.json  ← config de ESTE proyecto
├── order.json          ← Claude escribe órdenes
├── status.json         ← Claude lee resultado (pocos tokens)
├── agent.json          ← Cursor lee si needs_cursor
├── start-bridge.bat    ← Windows: doble-click
└── reports/            ← logs completos (Claude NO necesita leer)
```

### 2. Edita `bridge.config.json`

```json
{
  "pollIntervalSec": 5,
  "projectName": "Mi-Proyecto",
  "ssh": {
    "host": "usuario@tu-servidor.com",
    "keyPath": "~/.ssh/id_ed25519",
    "nvmBin": "/root/.nvm/versions/node/v20.20.2/bin"
  }
}
```

Sin VPS: deja `vps_commands: []` y usa solo `needs_cursor: true`.

### 3. Arranca el bridge

```bash
# Desde la raíz del repo
node coordination/bridge.mjs
```

Windows: doble-click `coordination/start-bridge.bat`

Otro proyecto, otra config:
```bash
node coordination/bridge.mjs /ruta/a/otro-proyecto/coordination/bridge.config.json
```

Variable de entorno:
```bash
set COORD_DIR=C:\ruta\mi-proyecto\coordination
node C:\ruta\plantilla\coordination\bridge.mjs
```

### 4. Claude Desktop (MCP filesystem)

Apunta `fibranexus-local` (o similar) a la **raíz del repo**.

Dile a Claude:

> Lee `coordination/status.json` cada 15s.  
> Si `status` es `idle` o `ok`, escribe nueva orden en `coordination/order.json` con `"status": "pending"`.  
> **No leas** `reports/` salvo error — solo `status.json`.

### 5. Cursor (solo si `needs_cursor: true`)

Regla en `.cursor/rules/`: lee `coordination/agent.json` cuando `status: pending`.

O di **go** en el chat cuando `status.json` diga `needs_cursor`.

---

## Formato `order.json` (Claude escribe)

```json
{
  "id": "011",
  "status": "pending",
  "from": "claude-pc",
  "task": "Reiniciar API y verificar health",
  "vps_commands": [
    "pm2 restart mi-api",
    "sleep 5",
    "curl -s http://127.0.0.1:3000/api/health"
  ],
  "needs_cursor": false,
  "cursor_task": ""
}
```

### Con cambio de código

```json
{
  "id": "012",
  "status": "pending",
  "task": "Refactor auth middleware",
  "vps_commands": [],
  "needs_cursor": true,
  "cursor_task": "Edita server/src/middleware/auth.js según spec en docs/auth.md"
}
```

## Formato `status.json` (Claude lee — ~50 tokens)

```json
{
  "id": "011",
  "status": "ok",
  "summary": "API online, health ok",
  "completed_at": "2026-09-01T04:00:00Z",
  "report": "reports/011-report.md",
  "errors": []
}
```

Estados: `ok` | `failed` | `needs_cursor` | `idle`

---

## Flujo

```
Claude → order.json (pending)
Bridge → SSH ejecuta vps_commands[] (5s poll)
Bridge → status.json (compacto) + reports/NNN-report.md (detalle)
Claude → lee status.json → siguiente order.json

Si needs_cursor:
Bridge → agent.json (pending)
Cursor → ejecuta código → actualiza agent.json done
```

---

## Requisitos

- **Node.js 18+** (ya lo tienes con Cursor)
- **SSH** al VPS (`ssh` en PATH de Windows)
- **Claude MCP** filesystem apuntando al repo
- Bridge corriendo en background (una terminal o `.bat`)

---

## FibraNexus (este proyecto)

```bash
node coordination/bridge.mjs
```

Config: `coordination/bridge.config.json` → VPS `134.209.43.175`

Legacy `runner.mjs` / `watch.mjs` → reemplazados por `bridge.mjs`.

---

## Troubleshooting

| Problema | Solución |
|----------|----------|
| Claude no ve cambios | MCP debe apuntar a raíz del repo correcto |
| Bridge no ejecuta | `bridge.log` en coordination/ |
| SSH falla | Verifica `keyPath` y `host` en config |
| Cursor no actúa | `needs_cursor: true` + chat abierto + `agent.json` |
