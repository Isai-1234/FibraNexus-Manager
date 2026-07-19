-- 009_wisphub_import.sql
-- Importación WispHub: reconciliación por id_servicio sin duplicar.
-- Aditiva.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS wisphub_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_org_wisphub_id
  ON clients (organization_id, wisphub_id)
  WHERE wisphub_id IS NOT NULL;

COMMENT ON COLUMN clients.wisphub_id IS 'id_servicio de WispHub (string); unique por organización';
