-- 011_service_custom_price.sql
-- Precio efectivo por servicio (override del precio de lista del plan).
-- Aditiva.

ALTER TABLE client_services
  ADD COLUMN IF NOT EXISTS custom_price DECIMAL(12, 2);

COMMENT ON COLUMN client_services.custom_price IS
  'Precio cobrado a este abonado; si NULL se usa plans.price. Import WispHub: precio_plan.';
