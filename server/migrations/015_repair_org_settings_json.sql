-- 015_repair_org_settings_json.sql
-- organizations.settings a veces quedó como jsonb tipo "string" (JSON
-- serializado dos veces). Eso hace que mergeOrgSettings ignore WispHub/Flow/DTE.
--
-- Reparación:
--   cd /root/app/server
--   node --env-file=.env scripts/repair-org-settings-json.mjs
--
-- El código también desenvuelve strings en mergeOrgSettings (normalizeOrgSettingsRaw).

SELECT 1;
