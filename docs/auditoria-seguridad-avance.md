# Avance — remediación de seguridad

Documento vivo. Actualizar tras cada grupo de cambios.

| Grupo | Descripción | Estado | Fecha |
|-------|-------------|--------|-------|
| G0 | Auditoría documentada | **Hecho** | 2026-07-18 |
| G1 | Eliminar `/setup` + script bootstrap CLI | **Hecho** | 2026-07-18 |
| G2 | Cifrado secretos + sanitize API/UI + rotación auditada | **Hecho** | 2026-07-18 |
| G3 | Tenant isolation (IP unique, promote, tests) | **Hecho** | 2026-07-18 |
| G4 | Pagos parciales + baja lógica clientes | **Hecho** | 2026-07-18 |
| G5 | Auth endurecida (Zod, rate limit, JWT, CORS, reset) | **Hecho** | 2026-07-18 |
| G6 | P1: audit log, límites plan, cola stub, migraciones | **Hecho (núcleo)** | 2026-07-18 |
| G7 | Build + pruebas + resumen | **Hecho** | 2026-07-18 |

## Pruebas ejecutadas

```
node --test server/src/lib/__tests__/*.test.js
→ 25 passed, 0 failed
pnpm --filter fibranexus-client build
→ OK (warning preexistente duplicate key "cut" en Dashboard.tsx)
```

## Cómo aplicar en producción (Internetsur)

1. **Respaldo:** `pg_dump` / snapshot Supabase.
2. Variables nuevas en Render (no commitear `.env`):
   - `CREDENTIALS_ENCRYPTION_KEY` (32 bytes hex)
   - `JWT_EXPIRES_IN=8h` (opcional)
   - Asegurar `FRONTEND_URL` exacto (CORS estricto)
3. Migraciones: `node scripts/run-migrations.mjs`
4. Cifrado legado: `CREDENTIALS_ENCRYPTION_KEY=... node scripts/migrate-encrypt-secrets.mjs`
5. Deploy API + frontend.
6. Verificar: login, listado routers **sin** passwords, pago parcial → status `partial`, baja abonado conserva facturas pagadas.

## Bootstrap admin (solo local/ops)

```bash
ALLOW_BOOTSTRAP=1 node scripts/bootstrap-admin.mjs \
  --email admin@ejemplo.cl --password 'Segura12345' --name 'Admin' --org-slug internetsur
```

## Riesgos pendientes

- Token revocation / rate limit son in-memory (un dyno). Multi-instancia → Redis.
- `agentToken` sigue en claro en DB para lookup de heartbeat (no se expone en GET).
- Migración legacy `migrate.js` aún corre en boot (sin DELETE de métricas); ideal migrar 100% a `scripts/run-migrations.mjs`.
- PDF facturas / pasarelas / DTE: fuera de alcance.
- Tests de integración con Postgres real aún no (solo unit + contratos estáticos).
- UI puede necesitar ajustes menores donde aún lea `snmpCommunity` en texto.

## Notas

- Repo: FibraNexus-Manager
- No se modificaron archivos `.env` reales
- Datos Internetsur: preservar slug; baja lógica en vez de hard delete financiero
