-- 005_billing_payments.sql
-- Fase 3: intents de pago, webhooks idempotentes y ajustes de factura.
-- Documento interno (no DTE). Aditiva.

DO $$ BEGIN
  CREATE TYPE payment_intent_status AS ENUM (
    'pending', 'completed', 'failed', 'expired', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE invoice_adjustment_type AS ENUM ('credit', 'debit', 'void');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS payment_intents (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  provider VARCHAR(40) NOT NULL DEFAULT 'stub',
  external_id VARCHAR(120) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'CLP',
  status payment_intent_status NOT NULL DEFAULT 'pending',
  checkout_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  expires_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_org ON payment_intents(organization_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_invoice ON payment_intents(invoice_id);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  provider VARCHAR(40) NOT NULL,
  event_id VARCHAR(160) NOT NULL,
  invoice_id INTEGER REFERENCES invoices(id),
  payment_intent_id INTEGER REFERENCES payment_intents(id),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_org ON payment_webhook_events(organization_id);

CREATE TABLE IF NOT EXISTS invoice_adjustments (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  type invoice_adjustment_type NOT NULL,
  amount_delta DECIMAL(10, 2) NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  previous_total DECIMAL(10, 2),
  new_total DECIMAL(10, 2),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_adjustments_invoice ON invoice_adjustments(invoice_id);
