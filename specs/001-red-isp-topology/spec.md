# Feature Specification: Red ISP — Topología jerárquica

**Feature Branch**: `001-red-isp-topology`

**Created**: 2026-06-25

**Status**: In Progress (parcialmente implementado)

**Input**: Topología Red ISP jerárquica estilo n8n con drill-down por nodo, conexiones curvas y edición de sitios.

## User Scenarios & Testing

### User Story 1 — Ver árbol de nodos (Priority: P1)

Como operador ISP, quiero ver todos mis sitios/nodos en orden jerárquico (raíz arriba, hijos abajo) para entender cómo está conectada mi red.

**Why this priority**: Es la vista principal de Red ISP; sin esto no hay orientación espacial.

**Independent Test**: Abrir Red ISP → Topología con 2+ nodos (uno padre de otro) y ver el padre arriba y el hijo debajo, conectados verticalmente.

**Acceptance Scenarios**:

1. **Given** Torre Pangui es padre de Nodo2, **When** abro Topología, **Then** Torre Pangui aparece arriba y Nodo2 debajo con línea de conexión.
2. **Given** solo hay un nodo raíz, **When** abro Topología, **Then** se muestra centrado sin nodos huérfanos al mismo nivel.

---

### User Story 2 — Entrar a un nodo y ver equipos (Priority: P1)

Como operador, quiero hacer clic en un nodo y ver dentro sus routers y CPEs conectados en columna vertical, para administrar la infraestructura local.

**Why this priority**: Es el drill-down que diferencia nodos de equipos.

**Independent Test**: Clic en Torre Pangui → ver MikroTik y EdgeRouter apilados verticalmente con conexiones curvas, no diagonales.

**Acceptance Scenarios**:

1. **Given** un nodo con 2 routers, **When** entro al nodo, **Then** ambos routers aparecen en columna bajo el nombre del sitio.
2. **Given** un router con CPEs, **When** entro al nodo, **Then** los CPE cuelgan del router correspondiente.
3. **Given** clic en IP de router o CPE, **When** hago clic, **Then** se abre la interfaz web del equipo en nueva pestaña.

---

### User Story 3 — Editar jerarquía de nodos (Priority: P2)

Como admin, quiero editar un sitio y asignar su nodo padre para corregir la topología.

**Why this priority**: Sin esto los nodos quedan planos aunque la UI sea jerárquica.

**Independent Test**: Árbol → seleccionar Nodo2 → lápiz → elegir Torre Pangui como padre → guardar → Topología refleja el cambio.

**Acceptance Scenarios**:

1. **Given** Nodo2 sin padre, **When** edito y asigno Torre Pangui, **Then** Nodo2 pasa a ser hijo en Topología.
2. **Given** edito nombre/ciudad, **When** guardo, **Then** el cambio se refleja en Árbol y Topología.

---

### Edge Cases

- Nodo sin equipos: mostrar mensaje vacío al entrar, no crash.
- Router sin IP: mostrar "sin IP", no enlace roto.
- Varios routers raíz en un mismo sitio: apilar verticalmente bajo el label del sitio.
- CPE sin `parentId`: asignar al único router del sitio o al router upstream.

## Requirements

### Functional Requirements

- **FR-001**: Vista Topología MUST mostrar solo sitios en overview (no routers/CPE mezclados).
- **FR-002**: Clic en sitio MUST abrir vista interna (drill-down) con equipos del nodo.
- **FR-003**: Conexiones MUST ser ortogonales/curvas estilo flujo (n8n), no líneas diagonales rectas.
- **FR-004**: Layout interno MUST ser vertical centrado: sitio → routers → CPEs.
- **FR-005**: IPs de routers/CPE MUST abrir interfaz web externa.
- **FR-006**: Admin MUST poder editar sitio incluyendo nodo padre desde Árbol.
- **FR-007**: Breadcrumb MUST permitir volver al árbol global ("Red ISP" / "Volver al árbol").

### Key Entities

- **Site (nodo)**: name, type, city, parentId, equipment[], children[]
- **Equipment (router/cpe)**: type, ipAddress, credentials.tunnelHostname, parentId, siteId
- **Topology view state**: focusSiteId (overview vs drill-down)

## Success Criteria

- **SC-001**: Operador identifica jerarquía de nodos en < 10 s sin leer documentación.
- **SC-002**: 100% de IPs configuradas abren interfaz web al clic.
- **SC-003**: Cero pantallas en blanco al navegar Red ISP / Routers y agentes.
- **SC-004**: `/api/health` version coincide con deploy tras push a main.

## Assumptions

- Jerarquía de sitios usa `sites.parentId` en PostgreSQL.
- Enlace router→router downstream usa `credentials.parentRouterId`.
- Lab Internetsur: Torre Pangui (MikroTik) + Nodo2 (EdgeRouter) + CPEs en 192.168.126.0/24.
- Producción despliega desde GitHub → Render automáticamente.
