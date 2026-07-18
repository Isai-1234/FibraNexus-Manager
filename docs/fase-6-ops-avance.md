# Post-MVP — Operación diaria Internetsur

**Estado:** Cerrada (MVP usable)  
**Cierre:** 2026-07-18

## Entregado

- Pasarela **Flow / Webpay live opcional** cuando existen env vars; si no, stub intacto.
- Indicador **STUB / LIVE** en Ajustes facturación (sin secretos).
- **PDF factura interna** (`GET /api/invoices/:id/pdf` y `GET /api/portal/invoices/:id/pdf`) + botones Descargar.
- **Upload multipart** de evidencias OT (`POST /api/work-orders/:id/attachments`) servido en `/uploads/...`.
- Vista de campo: elegir/tomar foto además de URL.

## Variables de entorno (opcionales)

| Variable | Uso |
|----------|-----|
| `FLOW_API_KEY` + `FLOW_SECRET_KEY` | Checkout Flow live |
| `FLOW_API_URL` | Override API Flow |
| `WEBPAY_COMMERCE_CODE` + `WEBPAY_API_KEY` | Checkout Webpay live |
| `WEBPAY_ENV=production` | Endpoint producción Transbank |
| `UPLOAD_DIR` | Carpeta local de evidencias |
| `PUBLIC_URL` / `FRONTEND_URL` | URLs de retorno / webhooks |

## Verificación

- `ops-postmvp.unit.test.js` + suite completa.
- Build client OK.

## Fuera de alcance (sigue post)

- DTE / SII  
- Redis / BullMQ  
- PWA offline  
