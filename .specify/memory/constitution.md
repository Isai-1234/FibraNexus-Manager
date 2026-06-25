# FibraNexus Manager Constitution

## Core Principles

### I. ISP-First Domain Model
FibraNexus gestiona ISPs reales: abonados, nodos, routers, CPE/antenas, facturación y red. Toda feature debe mapear a entidades del dominio (sitio, equipo, abonado, servicio) y no inventar conceptos paralelos.

### II. Spec Before Code (SDD)
Cambios de producto significativos pasan por Spec Kit: `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`. El código implementa la spec, no al revés.

### III. Minimal, Focused Diffs
Preferir el cambio más pequeño que resuelva el problema. No mezclar refactors masivos del server con UX del client en el mismo commit. Reutilizar patrones existentes (`DeviceIpLink`, `NetworkManager`, rutas `/sites`).

### IV. Deploy Awareness
Producción vive en Render (`app.fibranexus.cl`). Cambios en `client/` requieren build + push a `main` para verse en la nube. Verificar con `/api/health` (`version` en `server/package.json`).

### V. Multi-Tenant Safety
Todo acceso a datos filtra por `organizationId`. Nunca exponer credenciales de routers en logs. IPs de antenas abren interfaz web del equipo; perfiles de abonado son otra navegación.

## Stack & Architecture

| Capa | Tecnología |
|------|------------|
| Frontend | React + Vite + TypeScript + Tailwind |
| Backend | Node.js + Express + Drizzle ORM |
| DB | PostgreSQL (Supabase) |
| Deploy | Render (build incluye `client/dist`) |
| Lab ISP | Internetsur — MikroTik + EdgeRouter + CPE Ubiquiti |

Estructura clave:
- `client/src/pages/admin/` — Dashboard, NetworkManager, RouterManager, ClientDetail
- `client/src/components/` — NetworkTopologyMap, DeviceIpLink
- `server/src/routes/` — sites, routers, network, clients

## UX Principles (Red ISP)

1. **Jerarquía visible**: nodo raíz arriba, dependientes abajo (estilo n8n).
2. **Drill-down**: clic en nodo → ver routers y CPEs internos con conexiones claras.
3. **IPs accionables**: clic en IP de router/CPE abre interfaz web (`openDeviceWeb`).
4. **Edición de nodos**: nombre, tipo, ciudad, **nodo padre** desde Árbol.

## Quality Gates

- Build client sin errores: `cd client && npm run build`
- No commitear `.env`, `.env.local`, credenciales
- Probar en lab Internetsur cuando toque routers/túneles Cloudflare
- Bump `version` en `server/package.json` + `healthCheck.js` en releases visibles

## Governance

Esta constitución guía specs, planes e implementación. En conflicto con un chat ad-hoc, prevalece la spec activa en `specs/<feature>/`. Enmiendas: actualizar este archivo vía `/speckit-constitution` y bump de versión abajo.

**Version**: 1.0.0 | **Ratified**: 2026-06-25 | **Last Amended**: 2026-06-25
