# Research: 001-red-isp-topology

## R1 — Layout de topología estilo n8n

**Decision**: SVG con layout calculado en cliente + paths Bézier/ortogonales (`flowPath` + bus horizontal para múltiples hijos).

**Rationale**: n8n usa flujo top-down con conexiones curvas desde puertos de salida/entrada. React Flow sería más pesado; el árbol actual de FibraNexus es pequeño (<50 nodos). SVG puro encaja con Vite sin dependencias extra.

**Alternatives considered**:
- React Flow / xyflow — descartado por bundle size y curva de aprendizaje
- Líneas `<line>` diagonales — descartado (UX rechazada por usuario)
- Canvas HTML5 — descartado (peor accesibilidad y DOM events)

## R2 — Jerarquía sitio vs equipos

**Decision**: Dos modos en un componente: `overview` (solo `SiteNode`) y `focus` (drill-down con routers/CPE).

**Rationale**: Mezclar sitios y equipos en una sola vista confunde (Torre Pangui al lado de MikroTik). Drill-down al clic alinea con mental model ISP: torre → equipos dentro.

**Alternatives considered**:
- Todo en un canvas — descartado (layout caótico)
- Solo lista Árbol — insuficiente para visualización

## R3 — Relaciones padre-hijo de datos

**Decision**:
- Sitios: `sites.parentId` (API PATCH `/sites/:id`)
- Router downstream: `equipment.credentials.parentRouterId`
- CPE → router: `equipment.parentId` o fallback al único router del sitio

**Rationale**: Schema ya existía; no requiere migración DB para sitios. Router/CPE linking usa JSONB credentials + parentId column.

**Alternatives considered**:
- Tabla `topology_edges` — over-engineering para v1
- Inferir solo por IP/subnet — frágil en lab

## R4 — Deploy y verificación

**Decision**: Bump `version` en `server/package.json` + `healthCheck.js`; verificar `GET /api/health` post-push Render.

**Rationale**: Usuario reportó ver bundle viejo en producción; health version es señal confiable de deploy.
