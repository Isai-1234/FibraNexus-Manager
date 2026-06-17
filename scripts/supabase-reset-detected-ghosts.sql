-- FibraNexus / Internetsur — limpiar adopciones fantasma en detected_devices
-- Supabase → SQL Editor → Run (una sola vez)

-- 1) MAC huérfana en servicios (ej. Liliana #7 sin antena en Equipos)
UPDATE client_services cs
SET mac_address = NULL, updated_at = NOW()
WHERE cs.mac_address IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM equipment e
    WHERE e.client_id = cs.client_id
      AND e.type = 'cpe'
      AND e.client_id IS NOT NULL
      AND lower(replace(coalesce(e.mac_address, ''), ':', ''))
        = lower(replace(cs.mac_address, ':', ''))
  );

-- 2) detected_devices "adopted" sin CPE vinculado al abonado
UPDATE detected_devices dd
SET status = 'detected',
    adopted_as_client_service_id = NULL,
    updated_at = NOW()
WHERE (dd.status = 'adopted' OR dd.adopted_as_client_service_id IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM equipment e
    WHERE e.organization_id = dd.organization_id
      AND e.type = 'cpe'
      AND e.client_id IS NOT NULL
      AND lower(replace(coalesce(e.mac_address, ''), ':', ''))
        = lower(replace(dd.mac_address, ':', ''))
  );

-- 3) Equipos CPE sin abonado pero con puntero a detected_device
UPDATE equipment e
SET detected_device_id = NULL, updated_at = NOW()
WHERE e.type = 'cpe'
  AND e.client_id IS NULL
  AND e.detected_device_id IS NOT NULL;

-- Verificación (debe devolver 0 filas adoptadas fantasma)
SELECT dd.mac_address, dd.ip_address, dd.status, dd.adopted_as_client_service_id
FROM detected_devices dd
WHERE dd.status = 'adopted'
  AND NOT EXISTS (
    SELECT 1 FROM equipment e
    WHERE e.organization_id = dd.organization_id
      AND e.type = 'cpe'
      AND e.client_id IS NOT NULL
      AND lower(replace(coalesce(e.mac_address, ''), ':', ''))
        = lower(replace(dd.mac_address, ':', ''))
  );
