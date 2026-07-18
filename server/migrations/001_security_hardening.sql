-- 001_security_hardening.sql
-- Migración versionada (ejecutar con: node scripts/run-migrations.mjs)
-- Reversible: ver 001_security_hardening.down.sql
-- RESPALDO OBLIGATORIO antes de producción (pg_dump).

-- 1) Estado de factura: pago parcial
DO $$ BEGIN
  ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'partial';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) Baja lógica de abonados
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- 3) IP única por organización (no global)
ALTER TABLE ip_addresses DROP CONSTRAINT IF EXISTS ip_addresses_address_key;
ALTER TABLE ip_addresses DROP CONSTRAINT IF EXISTS ip_addresses_address_unique;
DO $$ BEGIN
  ALTER TABLE ip_addresses ADD CONSTRAINT uq_ip_addresses_org_address UNIQUE (organization_id, address);
EXCEPTION WHEN duplicate_table THEN NULL;
WHEN duplicate_object THEN NULL;
END $$;

-- 4) Tokens de recuperación de contraseña
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);

-- 5) Tabla de control de migraciones
CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT NOW()
);
