-- 007_expenses.sql
-- Módulo Finanzas: egresos por organización.
-- Aditiva.

DO $$ BEGIN
  CREATE TYPE expense_category AS ENUM (
    'equipment', 'services', 'rent', 'salary', 'taxes', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  category expense_category NOT NULL DEFAULT 'other',
  description TEXT,
  provider VARCHAR(255),
  invoice_number VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_org_date ON expenses(organization_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_org_category ON expenses(organization_id, category);
