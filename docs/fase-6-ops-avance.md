# Post-MVP — Operación diaria Internetsur

**Estado:** Cerrada (MVP usable)  
**Cierre:** 2026-07-18

## Entregado

- Pasarela **Flow por ISP**: cada organización configura API Key + Secret en Ajustes facturación (cifradas). Sin keys → stub.
- Indicador **STUB / LIVE** según credenciales de esa org.
- **PDF factura interna** (`GET /api/invoices/:id/pdf` y `GET /api/portal/invoices/:id/pdf`) + botones Descargar.
- **Upload multipart** de evidencias OT (`POST /api/work-orders/:id/attachments`) servido en `/uploads/...`.
- Vista de campo: elegir/tomar foto además de URL.

## Variables de entorno (opcionales / plataforma)

| Variable | Uso |
|----------|-----|
| `CREDENTIALS_ENCRYPTION_KEY` | Cifrar API keys Flow/Webpay por org (recomendado en prod) |
| `UPLOAD_DIR` | Carpeta local de evidencias OT |
| `PUBLIC_URL` / `FRONTEND_URL` | URLs de retorno / webhooks Flow |

**Nota:** Las API de Flow ya no van en env global del servidor — cada ISP las pega en Ajustes → Pasarela.

## Verificación

- `ops-postmvp.unit.test.js` + suite completa.
- Build client OK.

## Fuera de alcance (sigue post)

- DTE / SII  
- Redis / BullMQ  
- PWA offline  
