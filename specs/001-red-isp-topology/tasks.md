# Tasks: Red ISP — Topología jerárquica

**Input**: Design documents from `/specs/001-red-isp-topology/`  
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Organization**: Por user story (US1–US3 de spec.md). Tareas ya completadas marcadas `[x]`.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Foundational (API & datos existentes)

**Purpose**: Confirmar que backend y schema soportan la feature sin migraciones.

- [x] T001 Verificar `buildSiteTree` y PATCH `parentId` en `server/src/routes/sites.js`
- [x] T002 Confirmar campos `equipment.parentId` y `credentials.parentRouterId` en schema Drizzle
- [x] T003 [P] Documentar contratos en `specs/001-red-isp-topology/contracts/`

**Checkpoint**: API lista — UI puede consumir árbol jerárquico ✅

---

## Phase 2: User Story 1 — Vista overview sitios (Priority: P1) 🎯

**Goal**: Solo sitios en árbol padre→hijo, layout vertical centrado, sin equipos mezclados.

**Independent Test**: Con Torre Pangui (raíz) y Nodo2 (hijo), overview muestra 2 niveles y conexión curva.

### Implementation

- [x] T004 [US1] Implementar `computeOverviewLayout` en `client/src/components/NetworkTopologyMap.tsx`
- [x] T005 [US1] Filtrar overview para renderizar solo nodos `SiteNode` (sin routers/CPE)
- [x] T006 [US1] `buildConnectionPaths` + `flowPath` para enlaces padre-hijo en `NetworkTopologyMap.tsx`
- [x] T007 [US1] Breadcrumb "Red ISP" y botón "Volver al árbol" en overview/focus

### Validation

- [ ] T008 [US1] Configurar datos lab: Nodo2 `parentId` = Torre Pangui vía UI Árbol → editar
- [ ] T009 [US1] Ejecutar quickstart §1 en producción o local

**Checkpoint**: Overview jerárquico validado en lab ⏳

---

## Phase 3: User Story 2 — Drill-down equipos (Priority: P1)

**Goal**: Clic en sitio → routers/CPE en columna vertical; IPs abren interfaz web del dispositivo.

**Independent Test**: Entrar a Torre Pangui → ver routers apilados; clic IP abre pestaña nueva.

### Implementation

- [x] T010 [US2] Estado `focusSiteId` + `enterSite` / `backToOverview` en `NetworkTopologyMap.tsx`
- [x] T011 [US2] `layoutRouterColumn` — columna vertical centrada bajo título sitio
- [x] T012 [US2] `assignCpesToRouters()` — parentId, credentials.routerId, router único/upstream
- [x] T013 [US2] Integrar `openDeviceWeb` en IPs router/CPE (`client/src/lib/deviceWeb.ts`)
- [x] T014 [P] [US2] Puertos SVG input/output en nodos conectados

### Validation

- [ ] T015 [US2] Validar CPEs de Nodo2 aparecen bajo router correcto en drill-down
- [ ] T016 [US2] Ejecutar quickstart §2 (IPs clicables)

**Checkpoint**: Drill-down funcional en lab ⏳

---

## Phase 4: User Story 3 — Edición de nodos (Priority: P2)

**Goal**: Crear/editar/eliminar sitios con nodo padre desde Red ISP.

**Independent Test**: Editar nombre y parentId; árbol y topología se actualizan tras guardar.

### Implementation

- [x] T017 [US3] Modal editar sitio con selector `parentId` en `client/src/pages/admin/NetworkManager.tsx`
- [x] T018 [US3] `updateSite()` → PATCH `/sites/:id`
- [x] T019 [US3] `deleteSite()` con confirmación
- [x] T020 [US3] Botón lápiz junto al nombre del sitio en panel Árbol

### Validation

- [ ] T021 [US3] Ejecutar quickstart §3

**Checkpoint**: CRUD sitios validado ⏳

---

## Phase 5: Regresiones & Deploy (Priority: P1)

**Goal**: Menú y Routers operativos; producción en versión correcta.

- [x] T022 Fix `resolveHost()` en `client/src/pages/admin/RouterManager.tsx`
- [x] T023 Sidebar Red ISP: Topología | Árbol | Detectados en `client/src/pages/admin/Dashboard.tsx`
- [x] T024 Bump versión 1.2.8 en `server/package.json` + `server/src/lib/healthCheck.js`
- [ ] T025 Verificar `GET https://app.fibranexus.cl/api/health` → version ≥ 1.2.8
- [ ] T026 Hard refresh producción; confirmar sin líneas diagonales viejas
- [ ] T027 Ejecutar quickstart §4 Routers y agentes

---

## Phase 6: Enhancements (Priority: P3 — post-MVP)

**Goal**: Asignación explícita CPE↔router y router upstream en UI.

- [x] T028 [P] Selector `parentId` (router) en formulario edición/creación CPE — `NetworkManager.tsx` + API `sites.js`
- [x] T029 [P] Selector `credentials.parentRouterId` en edición router — `RouterManager.tsx` + PATCH `/routers/:id`
- [x] T030 [US2] Sync Árbol↔Topología: `topologyFocusId` + props controladas en `NetworkTopologyMap.tsx`
- [ ] T031 [US1] Test edge case: sitio con 3+ routers raíz sin parentRouterId — confirmar columna vertical

---

## Dependencies & Execution Order

```text
Phase 1 → Phase 2 (US1) → Phase 3 (US2) → Phase 4 (US3)
                              ↓
                         Phase 5 (deploy/QA)
                              ↓
                         Phase 6 (optional)
```

Phases 2–4 implementation **complete**; remaining work is **validation (T008–T009, T015–T016, T021, T025–T027)** and **enhancements (T028–T031)**.

## Parallel Opportunities

- T008 (datos lab) puede hacerse en paralelo con T025 (health prod)
- T028 y T029 son independientes entre sí (archivos distintos)

## MVP Scope

**MVP = Phases 1–5 validation complete** (T008, T009, T015, T016, T021, T025–T027).  
Phase 6 es mejora incremental, no bloquea cierre de spec.

---

## Task Summary

| Status | Count |
|--------|-------|
| Done | 20 |
| Pending validation | 7 |
| Pending enhancement | 4 |
| **Total** | **31** |
