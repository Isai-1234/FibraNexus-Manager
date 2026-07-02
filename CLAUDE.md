# FibraNexus Manager

ISP/WISP management platform: billing, network provisioning (MikroTik / EdgeRouter), client portal.

## Package manager

Este repo usa **pnpm workspaces** desde la raíz del repositorio (`pnpm@10.12.1` vía `packageManager` + corepack).

- Instalar todo: `corepack enable && pnpm install` (desde la raíz)
- Instalar con lock congelado (CI): `pnpm install --frozen-lockfile`
- Correr script de un paquete: `pnpm --filter fibranexus-server <script>` o `pnpm --filter fibranexus-client <script>`
- **NO agregues dependencias ni cambies lockfiles** sin confirmarlo conmigo primero.
- **NO** uses `ignore-scripts=true` en `.npmrc`. pnpm 10 bloquea scripts de dependencias por defecto; si un build falla, agrega entradas a `pnpm.onlyBuiltDependencies` en el `package.json` raíz (solo lo que rompa el build).

**Scripts raíz (`package.json`):**

- `pnpm run dev:server` — API con watch
- `pnpm run dev:client` — Vite dev server
- `pnpm run build` — build client + server script
- `pnpm run build:client` — `vite build`
- `pnpm run build:server` — delega al build del server (client dist)
- `pnpm start` — API producción

**Scripts `server/package.json` (`fibranexus-server`):**

- `pnpm run dev` — API con watch (`node --watch src/index.js`)
- `pnpm start` — API producción
- `pnpm run worker` — worker de jobs
- `pnpm run build` — construye el client (`pnpm --filter fibranexus-client build`)
- `pnpm run db:push` — Drizzle push schema
- `pnpm run db:seed` — seed
- `pnpm run lab:detected` — chequeo lab detectados

**Scripts `client/package.json` (`fibranexus-client`):**

- `pnpm run dev` — Vite dev server
- `pnpm run build` — `vite build`
- `pnpm run preview` — preview del build

## Estructura

- Backend (Express + Drizzle) en `server/`
- Frontend (React + Vite + Tailwind) en `client/`
- Workspace pnpm en la raíz (`pnpm-workspace.yaml`)

| Paquete | Ruta | Nombre |
|---------|------|--------|
| Backend | `server/` | `fibranexus-server` |
| Frontend | `client/` | `fibranexus-client` |

## Testing

- No hay framework de tests definido en ningún `package.json` (sin scripts `test` ni `lint`).
- **NO** bootstrapees un framework de tests nuevo ni instales paquetes sin confirmarlo conmigo primero. Si una skill (p.ej. `/ship`) quiere crear tests, que se **DETENGA** y pregunte antes.

## Deploy

- **API:** Render (`render.yaml`), `rootDir` = raíz del repo, `corepack enable && pnpm install --frozen-lockfile && pnpm --filter fibranexus-server run build`
- **Frontend público:** Vercel (`app.fibranexus.cl`), build con pnpm desde la raíz (`vercel.json`)
- Variables en `.env` / paneles Render y Vercel

**Nota (futuro PR):** Render podría dejar de servir `client/dist` si Vercel es el único frontend; hoy el server aún sirve el dist como fallback.

## gstack

Skills de gstack (Garry Tan) para Cursor viven en `~/.cursor/skills/gstack` (instalación global, no en este repo). Los artefactos generados para Cursor aparecen como `~/.cursor/skills/gstack-*`.
