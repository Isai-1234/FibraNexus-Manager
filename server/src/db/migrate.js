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

    console.log('Multi-tenant migration OK');
  } finally {
    await sql.end();
  }
}
