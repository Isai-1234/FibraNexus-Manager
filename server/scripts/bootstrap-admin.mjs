#!/usr/bin/env node
/**
 * Bootstrap local de una sola ejecución (corre dentro de server/).
 *
 *   cd server
 *   $env:ALLOW_BOOTSTRAP="1"
 *   pnpm exec node scripts/bootstrap-admin.mjs --email E --password P --org-slug internetsur --role admin
 *
 * Desde la raíz:
 *   $env:ALLOW_BOOTSTRAP="1"
 *   pnpm run bootstrap:admin -- --email E --password P --org-slug internetsur --role admin
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });

import bcrypt from 'bcryptjs';
import { db } from '../src/db/index.js';
import { users, organizations } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

async function main() {
  if (process.env.ALLOW_BOOTSTRAP !== '1') {
    console.error('Refusado: define ALLOW_BOOTSTRAP=1 para ejecutar este script.');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('Falta DATABASE_URL. Créala en server/.env (no la subas a git).');
    process.exit(1);
  }

  const email = arg('email');
  const password = arg('password');
  const fullName = arg('name', 'Administrador');
  const orgSlug = arg('org-slug', 'internetsur');
  const role = arg('role', 'admin');

  if (!email || !password) {
    console.error('Uso: ALLOW_BOOTSTRAP=1 pnpm exec node scripts/bootstrap-admin.mjs --email E --password P [--name N] [--org-slug S] [--role admin|superadmin]');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('La contraseña debe tener al menos 10 caracteres');
    process.exit(1);
  }
  if (!['admin', 'superadmin', 'technician'].includes(role)) {
    console.error('Rol inválido');
    process.exit(1);
  }

  let organizationId = null;
  if (role !== 'superadmin') {
    const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) });
    if (!org) {
      console.error(`Organización slug=${orgSlug} no encontrada. No se crea automáticamente para proteger datos.`);
      process.exit(1);
    }
    organizationId = org.id;
  }

  const hashed = await bcrypt.hash(password, 12);
  const normalizedEmail = email.toLowerCase();
  const existing = await db.query.users.findFirst({ where: eq(users.email, normalizedEmail) });

  if (existing) {
    await db.update(users).set({
      password: hashed,
      fullName,
      role,
      organizationId,
      isActive: true,
      updatedAt: new Date(),
    }).where(eq(users.id, existing.id));
    console.log('Usuario actualizado:', normalizedEmail, 'role=', role, 'orgId=', organizationId);
  } else {
    await db.insert(users).values({
      email: normalizedEmail,
      password: hashed,
      fullName,
      role,
      organizationId,
      isActive: true,
    });
    console.log('Usuario creado:', normalizedEmail, 'role=', role, 'orgId=', organizationId);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
