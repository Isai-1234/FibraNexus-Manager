# Fase 4 — Red y monitoreo

**Estado:** Cerrada (MVP funcional)  
**Cierre:** 2026-07-18

## Entregado

- Tabla `org_alerts` (migración `006_org_alerts.sql`) con severidad, estado y `dedupe_key` por org.
- API `/api/alerts`: listado, summary, refresh, ack, resolve.
- Scheduler refresca alertas operativas cada ~5 min (equipos offline, mora, etc.).
- Fallo de cobro en webhook puede abrir alerta (`raisePaymentFailAlert`).
- Banner de alertas en dashboard ISP (visto / resolver / actualizar).
- Acciones remotas EdgeOS (crear/borrar red, provisionar/retirar cola) exigen `confirm=true` + auditoría vía `appendPendingCmd`.
- Cola Redis: `USE_JOB_QUEUE=true` sigue siendo fatal (sin BullMQ real en Free).

## Verificación

- `alerts-phase4.unit.test.js` + suite completa.
- Build client OK.

## Pendiente post-MVP

- Redis/BullMQ real cuando haya plan de pago o Redis externo.
- Inventario OLT/ONU/AP consolidado más allá del equipo actual.
- Push/email de alertas (hoy solo banner + DB).

## Lab Camino A (2026-07-24) — addendum

- L009 lab online vía IP pública + NAT (detalle: [lab-mikrotik-camino-a.md](lab-mikrotik-camino-a.md)).
- Producto: con IP pública → “segura automática” (default) vs “manual”.
- Ayuda contextual estilo UISP: [ayuda-contextual.md](ayuda-contextual.md).
- Siguiente: script wizard endurecido + PPPoE/Simple Queue + wall garden en este lab.
