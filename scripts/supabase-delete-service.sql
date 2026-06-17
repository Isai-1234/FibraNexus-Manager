-- Eliminar servicio bloqueado por factura pendiente (Liliana #7, Carlos, etc.)
-- Supabase → SQL Editor

-- 0) Ver servicios y facturas ligadas (opcional)
SELECT cs.id AS service_id,
       u.full_name,
       cs.status AS servicio,
       i.id AS invoice_id,
       i.invoice_number,
       i.status AS factura,
       i.total
FROM client_services cs
JOIN clients c ON c.id = cs.client_id
JOIN users u ON u.id = c.user_id
LEFT JOIN invoices i ON i.client_service_id = cs.id
WHERE u.full_name ILIKE '%liliana%' OR u.full_name ILIKE '%carlos%'
ORDER BY u.full_name, cs.id;

-- 1) Liliana — servicio #7 (cambia el id si el SELECT de arriba muestra otro)
DELETE FROM payments
WHERE invoice_id IN (SELECT id FROM invoices WHERE client_service_id = 7);

DELETE FROM invoices WHERE client_service_id = 7;

UPDATE detected_devices
SET status = 'detected', adopted_as_client_service_id = NULL, updated_at = NOW()
WHERE adopted_as_client_service_id = 7;

DELETE FROM client_services WHERE id = 7;

-- 2) Carlos — reemplaza 99 por el service_id del SELECT (ejemplo)
-- DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE client_service_id = 99);
-- DELETE FROM invoices WHERE client_service_id = 99;
-- UPDATE detected_devices SET status = 'detected', adopted_as_client_service_id = NULL, updated_at = NOW() WHERE adopted_as_client_service_id = 99;
-- DELETE FROM client_services WHERE id = 99;
