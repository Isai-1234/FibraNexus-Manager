-- 014_repair_utf8_mojibake.sql
-- Documentación / marcador: la reparación real es un script Node (doble-encoding
-- no se puede expresar bien en SQL puro sin convert_from/convert_to frágil).
--
-- Ejecutar UNA VEZ en el servidor (después de deploy del código):
--   cd /root/app
--   node --env-file=server/.env server/scripts/repair-utf8-mojibake.mjs
--
-- Qué hace el script:
--   - Crea schema_patches si no existe
--   - Repara users.full_name, clients.{address,city,region,notes,plan_nombre},
--     plans.{name,description} cuando el texto parece mojibake UTF-8 (Ã±, Ã¡, …)
--   - Marca patch id = repair_utf8_mojibake_v1 (idempotente)
--
-- Prevención hacia adelante: wisphubImport.js decodifica el body WispHub como UTF-8
-- vía arrayBuffer (no res.text()) y aplica repairUtf8Deep a cada fila.

SELECT 1;
