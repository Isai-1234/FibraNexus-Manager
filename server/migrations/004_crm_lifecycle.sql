-- 004_crm_lifecycle.sql
-- Fase 2: ciclo de vida del abonado + órdenes de trabajo.
-- Aditiva; no borra datos de Internetsur.

DO $$ BEGIN
  CREATE TYPE client_lifecycle AS ENUM (
    'prospect', 'pending_install', 'active', 'suspended', 'cut', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE work_order_status AS ENUM ('open', 'in_progress', 'done', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE work_order_type AS ENUM ('install', 'visit', 'support', 'disconnect', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS lifecycle_status client_lifecycle NOT NULL DEFAULT 'prospect';

-- Abonados con servicio activo → active (best-effort backfill)
UPDATE clients c
SET lifecycle_status = 'active'
WHERE c.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM client_services cs
    WHERE cs.client_id = c.id AND cs.status = 'active'
  )
  AND c.lifecycle_status = 'prospect';

CREATE TABLE IF NOT EXISTS work_orders (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  service_id INTEGER REFERENCES client_services(id) ON DELETE SET NULL,
  assigned_to INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  type work_order_type NOT NULL DEFAULT 'visit',
  status work_order_status NOT NULL DEFAULT 'open',
  checklist JSONB DEFAULT '[]'::jsonb,
  attachments JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  completion_notes TEXT,
  scheduled_at TIMESTAMP,
  completed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_orders_org ON work_orders(organization_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_client ON work_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_clients_lifecycle ON clients(lifecycle_status);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT NOW()
);
