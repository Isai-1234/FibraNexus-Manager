-- 001_security_hardening.down.sql
-- Rollback parcial. NO elimina el valor enum 'partial' (Postgres no lo permite fácilmente).
-- Restaurar desde pg_dump es el rollback seguro para producción.

DROP TABLE IF EXISTS password_reset_tokens;
ALTER TABLE clients DROP COLUMN IF EXISTS deleted_at;

-- Restaurar unique global de IP solo si se necesita el estado anterior (puede fallar si hay duplicados cross-org)
ALTER TABLE ip_addresses DROP CONSTRAINT IF EXISTS uq_ip_addresses_org_address;
-- ALTER TABLE ip_addresses ADD CONSTRAINT ip_addresses_address_key UNIQUE (address);

DELETE FROM schema_migrations WHERE id = '001_security_hardening';
