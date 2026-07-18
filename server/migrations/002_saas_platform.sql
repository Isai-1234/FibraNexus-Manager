-- 002_saas_platform.sql
-- Planes SaaS, suscripción ISP, límites ampliados, facturas SaaS manuales.
-- RESPALDO recomendado antes de producción.

DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM ('trial', 'active', 'past_due', 'suspended', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE saas_invoice_status AS ENUM ('pending', 'paid', 'overdue', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS saas_plans (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  price_monthly DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'CLP',
  max_clients INTEGER NOT NULL DEFAULT 100,
  max_users INTEGER NOT NULL DEFAULT 5,
  max_routers INTEGER NOT NULL DEFAULT 5,
  max_equipment INTEGER NOT NULL DEFAULT 500,
  metrics_retention_days INTEGER NOT NULL DEFAULT 7,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO saas_plans (slug, name, description, price_monthly, max_clients, max_users, max_routers, max_equipment, metrics_retention_days, sort_order)
VALUES
  ('trial', 'Trial', 'Prueba 14 días', 0, 50, 3, 3, 100, 7, 0),
  ('starter', 'Starter', 'ISP pequeño', 29990, 200, 5, 10, 500, 14, 1),
  ('pro', 'Pro', 'ISP en crecimiento', 79990, 1000, 15, 30, 3000, 30, 2),
  ('enterprise', 'Enterprise', 'Alto volumen', 199990, 10000, 50, 100, 20000, 90, 3)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS saas_plan_id INTEGER REFERENCES saas_plans(id);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status subscription_status NOT NULL DEFAULT 'trial';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMP;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_users INTEGER DEFAULT 5;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_equipment INTEGER DEFAULT 500;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS metrics_retention_days INTEGER DEFAULT 7;

-- Backfill estado desde plan/is_active actuales
UPDATE organizations SET subscription_status = 'suspended'
WHERE is_active = false AND subscription_status <> 'suspended';

UPDATE organizations SET subscription_status = 'trial'
WHERE plan = 'trial' AND is_active = true AND subscription_status = 'trial';

UPDATE organizations o
SET saas_plan_id = sp.id,
    max_clients = COALESCE(o.max_clients, sp.max_clients),
    max_routers = COALESCE(o.max_routers, sp.max_routers),
    max_users = COALESCE(o.max_users, sp.max_users),
    max_equipment = COALESCE(o.max_equipment, sp.max_equipment),
    metrics_retention_days = COALESCE(o.metrics_retention_days, sp.metrics_retention_days)
FROM saas_plans sp
WHERE sp.slug = o.plan AND o.saas_plan_id IS NULL;

UPDATE organizations o
SET saas_plan_id = sp.id
FROM saas_plans sp
WHERE sp.slug = 'trial' AND o.saas_plan_id IS NULL;

CREATE TABLE IF NOT EXISTS saas_invoices (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  saas_plan_id INTEGER REFERENCES saas_plans(id),
  invoice_number VARCHAR(50) NOT NULL UNIQUE,
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'CLP',
  status saas_invoice_status NOT NULL DEFAULT 'pending',
  period_start DATE,
  period_end DATE,
  due_date DATE NOT NULL,
  paid_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saas_invoices_org ON saas_invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_organizations_subscription_status ON organizations(subscription_status);
CREATE INDEX IF NOT EXISTS idx_activity_log_org_created ON activity_log(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT NOW()
);
