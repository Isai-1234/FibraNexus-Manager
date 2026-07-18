-- 002_saas_platform.down.sql
-- Rollback parcial. Preferir restore desde pg_dump en producción.

DROP TABLE IF EXISTS saas_invoices;
ALTER TABLE organizations DROP COLUMN IF EXISTS saas_plan_id;
ALTER TABLE organizations DROP COLUMN IF EXISTS subscription_status;
ALTER TABLE organizations DROP COLUMN IF EXISTS subscription_ends_at;
ALTER TABLE organizations DROP COLUMN IF EXISTS suspended_at;
ALTER TABLE organizations DROP COLUMN IF EXISTS suspended_reason;
ALTER TABLE organizations DROP COLUMN IF EXISTS last_activity_at;
ALTER TABLE organizations DROP COLUMN IF EXISTS max_users;
ALTER TABLE organizations DROP COLUMN IF EXISTS max_equipment;
ALTER TABLE organizations DROP COLUMN IF EXISTS metrics_retention_days;
-- saas_plans y enums se dejan (borrarlos puede romper si hay refs); restore dump es más seguro.
DELETE FROM schema_migrations WHERE id = '002_saas_platform';
