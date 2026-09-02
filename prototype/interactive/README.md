# FibraNexus — Prototipo interactivo (sin backend)

Simulación completa en browser para validar flujos CRM / Network / Alerts antes de código real.

## Abrir ahora (CodeSandbox)

**https://codesandbox.io/s/m9f9tw**

Espera ~30s a que compile la primera vez. Abre la pestaña **Browser** (preview) a la derecha.

## Qué probar

1. **CRM** — buscar cliente, Ver → detail con tabs Servicios / Facturas / Notas / Pagar
2. **Pagar** — botón Flow simulado (1–3s, 90% éxito)
3. **Cortar** — suspende cliente (fila roja)
4. **Network** — 150 dispositivos, barras de señal, detail + Reconectar
5. **Alerts** — eventos automáticos cada 30s (antena online/offline)
6. **Consola** — `[POLLING]` cada 2 segundos
7. **Sync** — indicador top-right; se pone rojo si >5s (simulado)

## Local

```bash
cd prototype/interactive
npm install
npm start
```

## Regenerar CodeSandbox

```bash
node create-codesandbox.mjs
```

## Datos

- 82 clientes, 150 dispositivos, 300 facturas — JSON generado en `src/data.js`
- Todo en memoria; recargar página reinicia el estado
