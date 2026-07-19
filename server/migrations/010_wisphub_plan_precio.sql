-- 010_wisphub_plan_precio.sql
-- Snapshot de plan/precio efectivo importado desde WispHub (solo lectura UI por ahora).
-- Aditiva.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS plan_nombre VARCHAR(255);

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS precio_efectivo DECIMAL(12, 2);

COMMENT ON COLUMN clients.plan_nombre IS 'Nombre del plan en WispHub (plan_internet.nombre)';
COMMENT ON COLUMN clients.precio_efectivo IS 'Monto cobrado al cliente en WispHub (precio_plan del servicio)';
