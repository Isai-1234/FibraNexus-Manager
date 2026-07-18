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

## Pendiente post-MVP

- Upload binario de fotos (hoy URL).
- PDF descargable / DTE.
- Flow/Webpay live en portal.
- PWA offline.
