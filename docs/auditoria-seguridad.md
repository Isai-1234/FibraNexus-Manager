# Auditoría de seguridad — FibraNexus Manager

**Fecha:** 2026-07-18  
**Alcance:** Backend Express, schema Drizzle/Postgres, rutas multi-tenant, portal, agentes de red, frontend de credenciales.  
**Datos críticos:** No modificar secretos reales ni `.env`. Preservar datos de Internetsur (slug `internetsur`).  
**Seguimiento de avance:** [auditoria-seguridad-avance.md](auditoria-seguridad-avance.md)

---

## Resumen ejecutivo

Se identificaron vulnerabilidades **críticas** en bootstrap público, filtrado de secretos de red, lógica de pagos y borrado destructivo de historial financiero. El aislamiento por `organizationId` existe en muchas rutas, pero hay huecos (unicidad global de IP, promoción automática de roles, respuestas que reenvían credenciales).

| Severidad | Cantidad (inicial) |
|-----------|-------------------|
| Crítica (P0) | 8 |
| Alta (P0/P1) | 7 |
| Media (P1) | 6 |

---

## Hallazgos

### SEC-01 — Endpoint `/api/auth/setup` público (crear/elevar admin)

| Campo | Valor |
|-------|-------|
| **Severidad** | Crítica |
| **Archivo** | `server/src/routes/auth.js` (`POST /setup`) |
| **Riesgo** | Cualquier persona en Internet puede crear o **elevar a admin** cualquier email en la org Internetsur (`onConflictDoUpdate` fuerza `role: 'admin'` y nueva contraseña). Compromiso total del tenant piloto. |
| **Solución** | Eliminar la ruta HTTP. Bootstrap solo vía script CLI local (`scripts/bootstrap-admin.mjs`) con `ALLOW_BOOTSTRAP=1` y confirmación explícita. |
| **Estado** | Corregido en esta entrega |

---

### SEC-02 — Credenciales de routers/SNMP/tokens en respuestas API

| Campo | Valor |
|-------|-------|
| **Severidad** | Crítica |
| **Archivo** | `server/src/routes/routers.js` (GET lista devuelve `credentials` completo), `sites.js`, `equipment.js`, `edgeos.js` |
| **Riesgo** | Admin/técnico (o XSS futuro) recibe `routerPass`, `agentToken`, `tunnelToken`, `snmpCommunity` en claro. Filtración masiva de acceso a la red del ISP. |
| **Solución** | Capa `sanitizeEquipmentForApi()`: nunca devolver secretos; solo flags (`hasRouterPass`, `hasAgentToken`, `hasSnmpCommunity`). Tokens de agente solo en endpoints de rotación/creación one-shot. |
| **Estado** | Corregido en esta entrega |

---

### SEC-03 — Frontend precarga contraseñas y communities SNMP

| Campo | Valor |
|-------|-------|
| **Severidad** | Alta |
| **Archivo** | `client/src/pages/admin/RouterManager.tsx`, `ClientDetail.tsx`, `NetworkManager.tsx` |
| **Riesgo** | Formularios rellenan `routerPass` / `snmpCommunity` desde la API → exposición en DOM, historial, capturas. |
| **Solución** | Campos vacíos; placeholder “dejar vacío para no cambiar”; enviar solo si el usuario escribe un valor nuevo. |
| **Estado** | Corregido en esta entrega |

---

### SEC-04 — Secretos en reposo sin cifrado

| Campo | Valor |
|-------|-------|
| **Severidad** | Crítica |
| **Archivo** | `equipment.credentials` (jsonb), `snmp_community` |
| **Riesgo** | Dump de DB / backup / insider = acceso a todos los routers. |
| **Solución** | AES-256-GCM con `CREDENTIALS_ENCRYPTION_KEY` (32 bytes hex o base64). Prefijo `enc:v1:`. Migración `scripts/migrate-encrypt-secrets.mjs`. Lectura compatible con plaintext legacy. |
| **Estado** | Corregido en esta entrega |

---

### SEC-05 — Rotación de agentToken sin auditoría

| Campo | Valor |
|-------|-------|
| **Severidad** | Media → Alta |
| **Archivo** | `routers.js` `POST /:id/token` |
| **Riesgo** | Rotación silenciosa; sin registro de quién/cuándo. |
| **Solución** | Persistir `agentTokenRotatedAt` / `agentTokenRotatedBy`; escribir `activity_log`; devolver token solo en esa respuesta. |
| **Estado** | Corregido en esta entrega |

---

### SEC-06 — Unicidad global de IP (`ip_addresses.address UNIQUE`)

| Campo | Valor |
|-------|-------|
| **Severidad** | Alta (multi-tenant) |
| **Archivo** | `server/src/db/schema.js` — `address ... unique()` |
| **Riesgo** | Dos ISPs no pueden usar la misma IP privada (p. ej. `192.168.1.1`). Falso conflicto cross-tenant. |
| **Solución** | Unique compuesto `(organization_id, address)`. Migración SQL versionada. |
| **Estado** | Corregido en esta entrega |

---

### SEC-07 — Pagos parciales marcan factura como `paid`

| Campo | Valor |
|-------|-------|
| **Severidad** | Crítica (negocio) |
| **Archivo** | `server/src/routes/payments.js` |
| **Riesgo** | Pago de $1.000 sobre factura de $20.000 → estado `paid` + posible auto-reactivación. Pérdida de cobranza. |
| **Solución** | Estados: `pending`, `partial`, `paid`, `overdue`, `cancelled`. Saldo = total − suma pagos. Reactivar solo si saldo ≤ 0. Idempotencia por `idempotencyKey`. |
| **Estado** | Corregido en esta entrega |

---

### SEC-08 — Borrado hard de cliente elimina pagos y facturas

| Campo | Valor |
|-------|-------|
| **Severidad** | Crítica (integridad / compliance) |
| **Archivo** | `server/src/routes/clients.js` `DELETE /:id` |
| **Riesgo** | Destruye historial financiero; imposibilita auditoría y disputas. |
| **Solución** | Baja lógica: cancelar servicios, desactivar usuario, anular facturas pendientes; **no** borrar pagos ni facturas pagadas/parciales. |
| **Estado** | Corregido en esta entrega |

---

### SEC-09 — Auth débil: sin rate limit, JWT 7d, password corta, sin Zod

| Campo | Valor |
|-------|-------|
| **Severidad** | Alta |
| **Archivo** | `auth.js`, `index.js`, `middleware/auth.js` |
| **Riesgo** | Brute force login/registro/agente; tokens longevos; input no validado. |
| **Solución** | Rate limit in-memory; JWT 8h + denylist logout; Zod en auth/pagos; password ≥10 con complejidad; cabeceras seguridad; CORS a `FRONTEND_URL`; recuperación con token one-shot. |
| **Estado** | Corregido en esta entrega |

---

### SEC-10 — `ensureOrgStaffAccess` promueve `client` → `admin`

| Campo | Valor |
|-------|-------|
| **Severidad** | Crítica |
| **Archivo** | `server/src/lib/tenant.js` |
| **Riesgo** | Usuario `client` sin ficha de abonado puede auto-elevarse a admin si no hay staff con `lastLogin`. |
| **Solución** | Eliminar auto-promoción. Recuperación solo por bootstrap CLI o superadmin. |
| **Estado** | Corregido en esta entrega |

---

### SEC-11 — Migraciones destructivas/side-effects al arrancar la API

| Campo | Valor |
|-------|-------|
| **Severidad** | Media |
| **Archivo** | `server/src/db/migrate.js` llamado desde `index.js` |
| **Riesgo** | DELETE de métricas, backfills, promoción superadmin en cada boot; difícil revertir. |
| **Solución** | Migraciones versionadas en `server/migrations/` ejecutadas por script explícito; arranque no corre DDL destructivo. |
| **Estado** | Parcial — nuevas migraciones versionadas; boot deja de llamar side-effects peligrosos |

---

### SEC-12 — Activity log sin uso

| Campo | Valor |
|-------|-------|
| **Severidad** | Media (P1) |
| **Archivo** | `activity_log` en schema |
| **Riesgo** | Sin trazabilidad de pagos, rotaciones, bajas. |
| **Solución** | `lib/auditLog.js` + escrituras en auth crítica, pagos, rotación token, baja cliente. |
| **Estado** | Corregido (núcleo P1) |

---

### SEC-13 — Límites `maxClients` / `maxRouters` no enforceados

| Campo | Valor |
|-------|-------|
| **Severidad** | Media (P1) |
| **Archivo** | `organizations`, rutas clients/routers |
| **Solución** | Validar antes de insert. |
| **Estado** | Corregido en esta entrega |

---

### SEC-14 — Cola Redis stub activable en producción

| Campo | Valor |
|-------|-------|
| **Severidad** | Media (P1) |
| **Archivo** | `lib/jobs/redisQueue.js` |
| **Solución** | Si `USE_JOB_QUEUE=true`, fallar el arranque con mensaje claro (no stub silencioso). Jobs siguen inline hasta implementación real. |
| **Estado** | Corregido en esta entrega |

---

### SEC-15 — Logs con datos sensibles potenciales

| Campo | Valor |
|-------|-------|
| **Severidad** | Media |
| **Archivo** | `routers.js` heartbeat logs |
| **Solución** | Redactar tokens; no loguear bodies con agentToken completo. |
| **Estado** | Corregido en esta entrega |

---

## Plan de respaldo (antes de migraciones)

1. Snapshot Supabase / `pg_dump` de producción (Internetsur).
2. Ejecutar migraciones primero en staging o DB de copia.
3. Script de cifrado es **idempotente** (salta valores ya `enc:v1:`).
4. Rollback: restaurar dump; claves de cifrado **deben** conservarse o los secretos no se recuperan.

Variables nuevas (solo documentadas en `.env.example`, **no** tocar `.env` real):

- `CREDENTIALS_ENCRYPTION_KEY` — obligatoria en producción
- `ALLOW_BOOTSTRAP=1` — solo para script CLI
- `JWT_EXPIRES_IN` — default `8h`
- `PASSWORD_RESET_SECRET` — opcional (deriva de JWT_SECRET si falta)

---

## Pruebas requeridas

- Aislamiento tenant: org A no lee/edita/borra recursos de org B
- Pagos: parcial → `partial`; completo → `paid`; no reactivar con saldo
- Auth: setup HTTP ausente; rate limit; sanitize credentials
- Build client + server

Ver avance y resultados en [auditoria-seguridad-avance.md](auditoria-seguridad-avance.md).
