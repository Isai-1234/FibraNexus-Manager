-- 012_service_uisp_billing.sql
-- Perfil de facturación estilo UISP en client_services.
-- Aditiva + defaults seguros: los 80 servicios existentes siguen igual.

DO $$ BEGIN
  CREATE TYPE contrato_tipo AS ENUM ('abierto', 'cerrado');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE tipo_facturacion AS ENUM ('retroactiva', 'anticipada');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE tipo_descuento AS ENUM ('sin_descuento', 'porcentaje', 'monto_fijo');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE client_services
  ADD COLUMN IF NOT EXISTS contrato_tipo contrato_tipo NOT NULL DEFAULT 'abierto',
  ADD COLUMN IF NOT EXISTS contrato_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS costo_instalacion DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS cargo_cancelacion_anticipada DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS duracion_minima_meses INTEGER,
  ADD COLUMN IF NOT EXISTS dia_comienzo_periodo INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tipo_facturacion tipo_facturacion NOT NULL DEFAULT 'retroactiva',
  ADD COLUMN IF NOT EXISTS prorratear_primera_factura BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS crear_factura_dias_antes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS facturar_por_separado BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS aprobar_enviar_automaticamente BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS usar_credito_automaticamente BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tipo_descuento tipo_descuento NOT NULL DEFAULT 'sin_descuento',
  ADD COLUMN IF NOT EXISTS valor_descuento DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS impuesto_override DECIMAL(5, 2),
  ADD COLUMN IF NOT EXISTS atributos_personalizados JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS etiqueta_factura VARCHAR(255);

-- Rellenar día de comienzo desde billing_day / installation_date si quedó NULL
UPDATE client_services
SET dia_comienzo_periodo = COALESCE(
  billing_day,
  EXTRACT(DAY FROM installation_date::date)::integer,
  1
)
WHERE dia_comienzo_periodo IS NULL;

ALTER TABLE client_services
  ALTER COLUMN dia_comienzo_periodo SET DEFAULT 1;

COMMENT ON COLUMN client_services.contrato_tipo IS 'Contrato abierto o cerrado (UISP)';
COMMENT ON COLUMN client_services.tipo_facturacion IS 'retroactiva = periodo pasado; anticipada = periodo siguiente';
COMMENT ON COLUMN client_services.impuesto_override IS 'IVA % override; NULL = 19% default Chile';
COMMENT ON COLUMN client_services.atributos_personalizados IS 'Pares clave-valor libres del servicio';
COMMENT ON COLUMN client_services.etiqueta_factura IS 'Texto en factura; NULL = nombre del plan';
