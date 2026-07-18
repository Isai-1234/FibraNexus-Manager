-- 003_office_role.sql
-- Fase 2: rol administrativo/comercial por ISP.
-- Es aditiva y conserva los usuarios existentes.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'office';
