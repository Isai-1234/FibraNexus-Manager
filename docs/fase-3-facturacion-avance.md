# Fase 3 — Facturación y pagos

**Estado:** Cerrada (MVP funcional)  
**Cierre:** 2026-07-18

## Entregado

- Adaptador `PaymentGateway` + stub seguro (Flow/Webpay solo cuando existan credenciales reales; hoy stub).
- Checkout: `POST /api/payments/checkout` → `payment_intents` + URL.
- Webhooks firmados HMAC (`PAYMENT_WEBHOOK_SECRET`), idempotentes (`payment_webhook_events`), auditados.
- Anulación con motivo: `POST /api/invoices/:id/void`.
- Ajuste crédito/débito: `POST /api/invoices/:id/adjust` (documento interno, no DTE).
- Avisos de deuda desacoplados (`DEBT_NOTICE_PROVIDER=console|email`) al correr jobs si `debtNoticesEnabled`.
- Migración `005_billing_payments.sql`.
- Render: `preDeployCommand` ejecuta `scripts/run-migrations.mjs`.

## Verificación

- `billing-phase3.unit.test.js` + suite completa.
- Build client OK.

## Pendiente post-MVP

- Integración real Flow/Webpay.
- PDF de factura interna.
- DTE / SII (explícitamente fuera de alcance).
