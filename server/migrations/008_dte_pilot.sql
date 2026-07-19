-- 008_dte_pilot.sql
-- Pilotaje DTE: flag por cliente + trazabilidad en factura.
-- Aditiva. Default seguro: dte_habilitado = false.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS dte_habilitado BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS dte_emitido_por VARCHAR(32);

COMMENT ON COLUMN clients.dte_habilitado IS 'Si true, puede emitir DTE (SimpleFactura) según reglas de org/Flow';
COMMENT ON COLUMN invoices.dte_emitido_por IS 'Quién emitió boleta/DTE: flow | simplefactura | null';

CREATE INDEX IF NOT EXISTS idx_clients_org_dte ON clients(organization_id, dte_habilitado)
  WHERE dte_habilitado = true;
