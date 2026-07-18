# Avance de fases MVP

Log corto al cerrar cada fase. Plan maestro: [plan-implementacion.md](plan-implementacion.md).

---

## Fase 0 — Base segura y confiable

**Estado:** Hecho  
**Fecha:** 2026-07-18

### Funciones completadas
- Validación de remediación P0 (setup eliminado, secretos, pagos parciales, tenant, auth).
- Suite de pruebas seguridad/tenant en verde (25).
- Build client OK.
- Docs: roadmap, plan-implementacion, modulos actualizados.

### Archivos / migraciones
- Sin código nuevo de producto en este cierre (validación + docs).
- Migraciones P0 ya existentes: `001_security_hardening.sql`.

### Pruebas
- `node --test server/src/lib/__tests__/*.test.js` → **25 pass**
- `pnpm --filter fibranexus-client build` → **OK**

### Riesgos / pendientes
- Deploy prod: `CREDENTIALS_ENCRYPTION_KEY` + `run-migrations.mjs` + encrypt secrets.
- Rate limit/JWT revoke in-memory.
- `migrate.js` legacy aún en boot.

### Siguiente fase recomendada
**Fase 1 — SaaS de FibraNexus**

---

## Fase 1 — SaaS de FibraNexus

**Estado:** Hecho  
**Fecha:** 2026-07-18

### Funciones completadas
- Catálogo `saas_plans` (trial/starter/pro/enterprise) con límites.
- Org: `subscriptionStatus`, suspensión/reactivación, `lastActivityAt`, límites ampliados.
- Panel plataforma: uso vs límites, suspender/reactivar, actividad, facturas SaaS manuales.
- API staff ISP (`/api/staff`) con tope `maxUsers`.
- Retención de métricas por org en scheduler.
- Registro aplica plan trial con límites.

### Archivos / migraciones
- `server/migrations/002_saas_platform.sql` (+ down)
- `server/src/db/schema.js`, `routes/platform.js`, `routes/staff.js`, `lib/saasPlans.js`, `lib/orgLimits.js`, `lib/tenant.js`, `lib/scheduler.js`, `routes/auth.js`, `index.js`
- `client/src/pages/platform/PlatformDashboard.tsx`
- Tests: `saas-platform.unit.test.js`

### Pruebas
- Suite completa → **34 pass**
- Build client → **OK**

### Riesgos / pendientes
- Aplicar migración 002 en Supabase/prod antes de usar columnas nuevas.
- Si columnas no existen aún, API fallará al leer org — desplegar migración primero.
- Gateway SaaS real sigue pendiente (Fase 3).

### Siguiente fase recomendada
**Fase 2 — CRM y ciclo de vida del abonado**

---

## Fase 2 — CRM y ciclo de vida del abonado

**Estado:** Hecho (MVP)  
**Fecha:** 2026-07-18

### Funciones completadas
- Rol `office` (Administrativo) con permisos comerciales sin red.
- Ciclo de vida CRM + RUT chileno + lat/long.
- Órdenes de trabajo con checklist y cierre auditado.
- UI: personal ISP, OT, menú por rol, campos CRM en abonados.

### Archivos / migraciones
- `003_office_role.sql`, `004_crm_lifecycle.sql`
- `server/src/lib/rut.js`, `routes/workOrders.js`, `routes/clients.js`, `routes/staff.js`
- `client/.../StaffManager.tsx`, `WorkOrdersManager.tsx`, `Dashboard.tsx`
- Docs: `fase-2-crm-avance.md`

### Pruebas
- Suite unitaria → **45 pass**
- Build client → **OK**

### Riesgos / pendientes
- Aplicar migraciones 003 y 004 en prod antes de usar columnas/tablas nuevas.
- Adjuntos OT solo metadatos/URL.
- Integración E2E de permisos con PostgreSQL real aún pendiente.

### Siguiente fase recomendada
**Fase 3 — Facturación y cobranzas**

---

## Fase 3 — Facturación y pagos

**Estado:** Hecho (MVP)  
**Fecha:** 2026-07-18

### Funciones completadas
- PaymentGateway stub + checkout + webhooks firmados/idempotentes.
- Void y adjust de facturas internas con auditoría.
- Avisos de deuda (console/email stub) opcionales por org.
- Migración `005_billing_payments.sql`; Render preDeploy corre migraciones.

### Archivos
- `server/src/lib/paymentGateway.js`, `invoiceAdjustments.js`, `debtNotices.js`
- `server/src/routes/webhooks.js`, updates en `payments.js`, `invoices.js`, `billingScheduler.js`
- Docs: `fase-3-facturacion-avance.md`

### Pruebas
- Suite unitaria → **52 pass**
- Build client → **OK**

### Riesgos / pendientes
- Configurar `PAYMENT_WEBHOOK_SECRET` en Render.
- Flow/Webpay reales y PDF quedan post-MVP.
- Sin `DATABASE_URL` local las migraciones se aplican en preDeploy de Render.

### Siguiente fase recomendada
**Fase 4 — Red y monitoreo**
