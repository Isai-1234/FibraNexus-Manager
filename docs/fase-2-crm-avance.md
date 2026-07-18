# Fase 2 — CRM y ciclo de vida del abonado

**Estado:** En curso  
**Inicio:** 2026-07-18

Este documento conserva el avance de la fase sin declarar cerradas las partes
que aun requieren experiencia de usuario y pruebas contra PostgreSQL real.

## Bloque 2.1 terminado: rol administrativo

Se incorporo el rol tecnico `office`, mostrado al usuario como
**Administrativo**. La migracion aditiva es
`server/migrations/003_office_role.sql`.

Un administrativo puede:

- Consultar el dashboard comercial, abonados, planes, facturas y saldos.
- Crear y editar abonados.
- Registrar pagos manuales.
- Crear, responder y actualizar tickets.

Un administrativo no puede:

- Ver o cambiar routers, equipos, credenciales, communities SNMP ni la red.
- Ejecutar aprovisionamiento, escaneos o acciones remotas.
- Suspender/reactivar servicios, cambiar planes, eliminar abonados o gestionar
  personal.

Los administrativos cuentan dentro del limite SaaS de usuarios internos.
La API `/api/staff` permite al administrador crear y actualizar personal
`admin`, `office` y `technician`; la pantalla especifica para hacerlo sigue
pendiente.

## Verificacion

- Contratos unitarios: `server/src/lib/__tests__/office-role.unit.test.js`.
- Migracion revisada como aditiva; requiere ejecutarse antes de crear un
  usuario `office` en Supabase.

## Pendiente para cerrar Fase 2

1. Validacion de RUT chileno y datos de direccion/geolocalizacion.
2. Estados de prospecto e instalacion pendiente.
3. Ordenes de trabajo con checklist, adjuntos y cierre auditado.
4. Interfaz para administrar personal ISP y permisos visibles.
5. Pruebas de integracion de permisos con PostgreSQL real.
