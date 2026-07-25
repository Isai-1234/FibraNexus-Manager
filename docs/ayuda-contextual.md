# Ayuda contextual en plataforma (estilo UISP)

**Estado:** Diseño acordado — pendiente implementación global  
**Fecha:** 2026-07-24  
**Referencia UX:** UISP Server — icono `?` → columna lateral con explicación

---

## Problema

ISP primerizos no conocen términos (PPPoE, Simple Queue, wall garden, www-ssl, community SNMP). Hoy hay ayuda parcial solo en el wizard de routers (`WizardHelpPanel` en `RouterManager.tsx`). Falta un sistema **reutilizable** en toda la plataforma.

## Propuesta UX

1. Junto a cada control / sección relevante: icono **?** (`HelpCircle`).
2. Al hacer clic: se abre una **columna derecha** (drawer ~320–380px) sin tapar el formulario.
3. Contenido: título, para qué sirve, cómo configurarlo, advertencias de seguridad, enlace “Ver más” si existe doc larga.
4. Cerrar con X, clic fuera o Esc. Una sola columna abierta a la vez.
5. En móvil: sheet inferior a pantalla casi completa.

## Contenido por tema (primer lote)

| Tema | Dónde aparece |
|------|----------------|
| Conectar MikroTik (IP pública / sin IP) | Wizard routers |
| Segura automática vs Manual | Wizard routers · IP pública |
| PPPoE + Simple Queue | Red ISP / provisionar abonado |
| Wall garden / suspensión | Ajustes billing + suspender |
| Planes y velocidades | Planes |
| SNMP LiteBeam / airOS | Equipos CPE |
| Túnel Cloudflare | Wizard · sin IP pública |
| Entrada del mes / por cobrar | Dashboard |

## Arquitectura sugerida (cuando se implemente)

- `client/src/components/help/HelpDrawer.tsx` — shell UI.
- `client/src/components/help/HelpTip.tsx` — botón `?` + `helpId`.
- `client/src/content/help/*.ts` — textos por `helpId` (ES), sin hardcodear en cada página.
- Opcional: `docs/help/` espejo markdown para el equipo.

## Relación con docs internas

- Avances de lab/producto → `docs/*-avance.md` y reglas `.cursor/rules/`.
- Textos al ISP dentro de la app → este sistema (no PDFs).
- Glosario existente: `docs/glosario.md` puede alimentar los textos del drawer.

## Criterio

Si un ISP primerizo se pregunta “¿qué es esto?”, debe haber un `?` a un clic. Si no, falta ayuda contextual.
