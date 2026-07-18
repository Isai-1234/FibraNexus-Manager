-- 006_org_alerts.sql
-- Fase 4: alertas operativas por organización (sin Redis).
-- Aditiva.

DO $$ BEGIN
  CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE alert_status AS ENUM ('open', 'acked', 'resolved');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS org_alerts (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  severity alert_severity NOT NULL DEFAULT 'warning',
  status alert_status NOT NULL DEFAULT 'open',
  kind VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  entity_type VARCHAR(40),
  entity_id INTEGER,
  dedupe_key VARCHAR(160) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP,
  acked_at TIMESTAMP,
  acked_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_org_alerts_org_status ON org_alerts(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_org_alerts_org_severity ON org_alerts(organization_id, severity);
CREATE INDEX IF NOT EXISTS idx_org_alerts_last_seen ON org_alerts(last_seen_at DESC);
