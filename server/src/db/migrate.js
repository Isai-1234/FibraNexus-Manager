import postgres from 'postgres';

export async function runMigrations(connectionString) {
  const sql = postgres(connectionString, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) NOT NULL UNIQUE,
        email VARCHAR(255),
        plan VARCHAR(50) NOT NULL DEFAULT 'trial',
        trial_ends_at TIMESTAMP,
        is_active BOOLEAN NOT NULL DEFAULT true,
        max_routers INTEGER DEFAULT 5,
        max_clients INTEGER DEFAULT 100,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `;

    const tables = ['users', 'clients', 'plans', 'equipment', 'tickets', 'invoices', 'ip_addresses', 'activity_log'];
    for (const table of tables) {
      await sql.unsafe(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    }

    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM organizations`;
    if (count === 0) {
      const [org] = await sql`
        INSERT INTO organizations (name, slug, email, plan, trial_ends_at)
        VALUES ('Internetsur', 'internetsur', 'admin@fibranexus.cl', 'trial', NOW() + INTERVAL '365 days')
        RETURNING id
      `;
      for (const table of tables) {
        await sql.unsafe(`UPDATE ${table} SET organization_id = ${org.id} WHERE organization_id IS NULL`);
      }
      console.log('Migration: default organization created (id=%s)', org.id);
    } else {
      const [defaultOrg] = await sql`SELECT id FROM organizations ORDER BY id LIMIT 1`;
      for (const table of tables) {
        await sql.unsafe(`UPDATE ${table} SET organization_id = ${defaultOrg.id} WHERE organization_id IS NULL`);
      }
    }

    await sql`
      UPDATE users u SET organization_id = o.id
      FROM organizations o
      WHERE u.organization_id IS NULL AND o.slug = 'internetsur'
    `;

    await sql`
      UPDATE users u SET organization_id = o.id
      FROM organizations o
      WHERE u.organization_id IS NULL
        AND o.slug = 'internetsur'
        AND u.email IN ('admin@fibranexus.cl', 'tecnico@fibranexus.cl')
    `;

    await sql`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'superadmin'`;

    const superEmail = process.env.SUPERADMIN_EMAIL;
    if (superEmail) {
      await sql`
        UPDATE users SET role = 'superadmin', organization_id = NULL
        WHERE LOWER(email) = LOWER(${superEmail})
      `;
      console.log('Superadmin assigned to', superEmail);
    }

    const seedPlanNames = ['Fibra 100 Megas', 'Fibra 300 Megas', 'Fibra 600 Megas', 'WISP 50 Megas', 'Fibra 1 Giga'];
    await sql`
      UPDATE plans SET is_active = false
      WHERE name = ANY(${seedPlanNames})
        AND id NOT IN (
          SELECT DISTINCT plan_id FROM client_services WHERE plan_id IS NOT NULL
        )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS sites (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        parent_id INTEGER,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'node',
        address TEXT,
        city VARCHAR(100),
        latitude DECIMAL(10,8),
        longitude DECIMAL(11,8),
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `;

    await sql`ALTER TABLE equipment ADD COLUMN IF NOT EXISTS site_id INTEGER`;
    await sql`ALTER TABLE client_services ADD COLUMN IF NOT EXISTS router_id INTEGER`;
    await sql`ALTER TABLE client_services ADD COLUMN IF NOT EXISTS site_id INTEGER`;
    await sql`ALTER TABLE client_services ADD COLUMN IF NOT EXISTS pppoe_username VARCHAR(64)`;
    await sql`ALTER TABLE client_services ADD COLUMN IF NOT EXISTS pppoe_password VARCHAR(64)`;
    await sql`ALTER TABLE client_services ADD COLUMN IF NOT EXISTS ppp_profile VARCHAR(64) DEFAULT 'default'`;
    await sql`ALTER TABLE client_services ADD COLUMN IF NOT EXISTS queue_name VARCHAR(64)`;
    await sql`ALTER TABLE client_services ADD COLUMN IF NOT EXISTS network_meta JSONB`;
    await sql`ALTER TABLE client_services ADD COLUMN IF NOT EXISTS billing_cycle_type VARCHAR(32) DEFAULT 'anniversary'`;
    await sql`ALTER TABLE client_services ADD COLUMN IF NOT EXISTS billing_day INTEGER`;
    await sql`ALTER TABLE client_services ADD COLUMN IF NOT EXISTS billing_due_day INTEGER DEFAULT 5`;
    await sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb`;

    await sql`CREATE INDEX IF NOT EXISTS idx_clients_organization_id ON clients(organization_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_equipment_organization_id ON equipment(organization_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_equipment_site_id ON equipment(site_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_invoices_org_status ON invoices(organization_id, status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_tickets_organization_id ON tickets(organization_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_plans_organization_id ON plans(organization_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_sites_organization_id ON sites(organization_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_services_client_id ON client_services(client_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id)`;
    await sql`ALTER TABLE equipment ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_equipment_client_id ON equipment(client_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS detected_devices (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER REFERENCES organizations(id),
        equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
        mac_address VARCHAR(17) NOT NULL,
        ip_address VARCHAR(45),
        hostname VARCHAR(255),
        interface_name VARCHAR(64),
        source VARCHAR(16) NOT NULL DEFAULT 'dhcp',
        first_seen TIMESTAMP NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMP NOT NULL DEFAULT NOW(),
        status VARCHAR(16) NOT NULL DEFAULT 'detected',
        adopted_as_client_service_id INTEGER REFERENCES client_services(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_detected_equipment_mac UNIQUE (equipment_id, mac_address)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_detected_devices_org ON detected_devices(organization_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_detected_devices_status ON detected_devices(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_detected_devices_last_seen ON detected_devices(last_seen DESC)`;

    // Bidirectional link: equipment ← detected_devices (for reversible adopt/unlink cycle)
    await sql`ALTER TABLE equipment ADD COLUMN IF NOT EXISTS detected_device_id INTEGER`;
    await sql`CREATE INDEX IF NOT EXISTS idx_equipment_detected_device_id ON equipment(detected_device_id)`;

    // Backfill: create equipment records for devices adopted before this migration ran
    await sql`
      INSERT INTO equipment (
        organization_id, name, type, brand, model,
        ip_address, mac_address, client_id, detected_device_id,
        status, created_at, updated_at
      )
      SELECT
        dd.organization_id,
        COALESCE(NULLIF(dd.hostname, ''), 'CPE-' || RIGHT(REPLACE(dd.mac_address, ':', ''), 6)),
        'cpe'::equipment_type,
        'Detectado',
        COALESCE(NULLIF(dd.hostname, ''), 'CPE'),
        dd.ip_address,
        dd.mac_address,
        cs.client_id,
        dd.id,
        'offline'::equipment_status,
        NOW(),
        NOW()
      FROM detected_devices dd
      JOIN client_services cs ON dd.adopted_as_client_service_id = cs.id
      WHERE dd.status = 'adopted'
        AND NOT EXISTS (SELECT 1 FROM equipment e WHERE e.detected_device_id = dd.id)
        AND NOT EXISTS (SELECT 1 FROM equipment e WHERE e.mac_address = dd.mac_address AND e.client_id = cs.client_id)
    `;

    // Fix FK: permite eliminar client_services sin romper detected_devices
    await sql`ALTER TABLE detected_devices DROP CONSTRAINT IF EXISTS detected_devices_adopted_as_client_service_id_fkey`;
    await sql`
      ALTER TABLE detected_devices ADD CONSTRAINT detected_devices_adopted_as_client_service_id_fkey
        FOREIGN KEY (adopted_as_client_service_id) REFERENCES client_services(id) ON DELETE SET NULL
    `;

    await sql`ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_client_service_id_fkey`;
    await sql`
      ALTER TABLE invoices ADD CONSTRAINT invoices_client_service_id_fkey
        FOREIGN KEY (client_service_id) REFERENCES client_services(id) ON DELETE SET NULL
    `;

    // Métricas de antenas CPE (CCQ, señal, ruido) — series de tiempo
    await sql`
      CREATE TABLE IF NOT EXISTS device_metrics (
        id SERIAL PRIMARY KEY,
        equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
        sampled_at TIMESTAMP NOT NULL DEFAULT NOW(),
        signal INTEGER,
        noise INTEGER,
        cinr INTEGER,
        tx_ccq INTEGER,
        tx_rate INTEGER,
        rx_rate INTEGER,
        source VARCHAR(20) NOT NULL DEFAULT 'heartbeat'
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_device_metrics_equip_time ON device_metrics(equipment_id, sampled_at DESC)`;
    // Limpieza de métricas antiguas: NO en el arranque (usar job/cron separado)

    await sql`
      CREATE TABLE IF NOT EXISTS ticket_messages (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        message TEXT NOT NULL,
        is_internal BOOLEAN DEFAULT false,
        attachments JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON ticket_messages(ticket_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(128) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id)`;

    console.log('Multi-tenant migration OK (indexes applied)');
  } finally {
    await sql.end();
  }
}
