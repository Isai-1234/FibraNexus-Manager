# Fase 2 — CRM y ciclo de vida del abonado

**Estado:** Cerrada (MVP funcional)  
**Cierre:** 2026-07-18

## Bloque 2.1 — Rol administrativo

Rol técnico `office` (Administrativo). Migración `003_office_role.sql`.

Puede: dashboard comercial, abonados, planes, facturas, pagos, tickets, órdenes de trabajo.  
No puede: routers, equipos, SNMP, red, aprovisionamiento remoto, gestión de personal.

## Bloque 2.2 — Ciclo de vida y RUT

- Estados CRM: `prospect`, `pending_install`, `active`, `suspended`, `cut`, `cancelled`.
- Validación/normalización de RUT chileno (`server/src/lib/rut.js`).
- Soft-delete marca `lifecycleStatus = cancelled`.
- Migración `004_crm_lifecycle.sql` (+ lat/long en clientes, tabla `work_orders`).

## Bloque 2.3 — Órdenes de trabajo

API `/api/work-orders`: crear, actualizar checklist/adjuntos metadatos, completar (con force), anular.  
Instalación → `pending_install`; completar instalación → `active`. Auditoría en cada acción.

## Bloque 2.4 — UI ISP

- Menú filtrado por rol (office no ve Red ISP / routers / inventario).
- Pestaña **Personal ISP** (`StaffManager`) para admin.
- Pestaña **Órdenes de trabajo** (`WorkOrdersManager`).
- Formulario de abonado: RUT, estado CRM, lat/long.

## Verificación

- `office-role.unit.test.js`, `rut.unit.test.js`, `crm-lifecycle.unit.test.js`
- Suite `node --test server/src/lib/__tests__/*.test.js`
- Build client

## Pendiente post-MVP (no bloquea cierre)

- Adjuntos binarios reales (hoy solo URL/metadatos).
- Pruebas de integración de permisos con PostgreSQL real.
- Asignación de OT a técnico desde selector de staff.
