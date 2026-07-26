-- 016_network_pools.sql
-- Redes / pools de IPs por organización (ocupación vs capacidad).

CREATE TABLE IF NOT EXISTS network_pools (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  subnet VARCHAR(45) NOT NULL,
  gateway VARCHAR(45),
  dns VARCHAR(255),
  vlan INTEGER,
  pool_type VARCHAR(32) NOT NULL DEFAULT 'residential',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  router_id INTEGER REFERENCES equipment(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_network_pools_org_subnet
  ON network_pools (organization_id, subnet);

CREATE INDEX IF NOT EXISTS idx_network_pools_org
  ON network_pools (organization_id);

COMMENT ON TABLE network_pools IS
  'Pools / subredes del ISP para control de IPs ocupadas vs disponibles';
