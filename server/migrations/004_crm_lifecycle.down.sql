-- 004_crm_lifecycle.down.sql
DROP TABLE IF EXISTS work_orders;
ALTER TABLE clients DROP COLUMN IF EXISTS lifecycle_status;
DELETE FROM schema_migrations WHERE id = '004_crm_lifecycle';
-- Los ENUMs de Postgres no se eliminan aquí (pueden quedar huérfanos); preferir restore de dump.
