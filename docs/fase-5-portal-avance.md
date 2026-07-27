# Fase 5 — Portal y experiencia operativa

**Estado:** Cerrada (MVP funcional)  
**Cierre:** 2026-07-18

## Entregado

- Portal abonado: botón **Pagar** → `POST /api/portal/checkout` (stub/pasarela), pestaña Documentos (facturas internas).
- Branding por org en settings: logo URL, colores, título del portal; se aplica en `ClientPortal`.
- Vista de campo técnico: `FieldWorkOrders` (mis OT, checklist, evidencias por URL, cierre); arranca en Órdenes de trabajo.
- Asignación de técnico al crear OT (admin/office).
- Filtro `?mine=1` en `/api/work-orders`.

## Verificación

- `portal-phase5.unit.test.js` + suite completa.
- Build client OK.

## Madurez abonado (2026-07-26)

Probado como Camila Rojas (Nexus Sur QA) en `/portal/nexus-sur-qa`:

- Logout vuelve al portal del ISP (`/portal/{slug}`), no al login SaaS FibraNexus.
- Tema claro forzado en portal/login/mora (el dark del panel ISP ya no mancha inputs).
- Fechas legibles (`es-CL`); pestañas Resumen / Facturas / Soporte (sin “Documentos” duplicado ni jerga post-MVP).
- Resumen muestra próximo cobro + estado de enlace radio (señal/CCQ vía equipo del abonado).
- Mora: CTA “Entrar y pagar” + secundario “Ya tengo cuenta”.
- Splash de carga genérico (sin “FibraNexus Manager”) en rutas `/portal` y `/mora`.

## Pendiente post-MVP

- Upload binario de fotos (hoy URL).
- Checkout Flow en mora **sin login** (identificar por IP suspendida).
- Flow/Webpay live en portal (PDF ya disponible).
- PWA offline.
