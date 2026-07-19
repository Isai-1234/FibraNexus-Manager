-- 013_service_facturar_desde.sql
-- Fecha de inicio de facturación (permite incluir el mes actual u otro mes pasado/futuro).
-- Aditiva; NULL = comportamiento actual (desde hoy).

ALTER TABLE client_services
  ADD COLUMN IF NOT EXISTS facturar_desde DATE;

COMMENT ON COLUMN client_services.facturar_desde IS
  'Primer periodo a facturar (YYYY-MM-DD). Si NULL, se calcula desde hoy.';
