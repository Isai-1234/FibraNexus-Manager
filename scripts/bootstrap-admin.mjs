#!/usr/bin/env node
/**
 * Bootstrap local de una sola ejecución.
 *
 * Uso:
 *   ALLOW_BOOTSTRAP=1 node scripts/bootstrap-admin.mjs \
 *     --email admin@ejemplo.cl --password 'Segura123!' --name 'Admin' \
 *     --org-slug internetsur
 *
 * REQUIERE ALLOW_BOOTSTRAP=1. No expone HTTP.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db } from '../server/src/db/index.js';
import { users, organizations } from '../server/src/db/schema.js';
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

  const email = arg('email');
  const password = arg('password');
  const fullName = arg('name', 'Administrador');
  const orgSlug = arg('org-slug', 'internetsur');
  const role = arg('role', 'admin'); // admin | superadmin

  if (!email || !password) {
    console.error('Uso: ALLOW_BOOTSTRAP=1 node scripts/bootstrap-admin.mjs --email E --password P [--name N] [--org-slug S] [--role admin|superadmin]');
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
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });

  if (existing) {
    await db.update(users).set({
      password: hashed,
      fullName,
      role,
      organizationId,
      isActive: true,
      updatedAt: new Date(),
    }).where(eq(users.id, existing.id));
    console.log('Usuario actualizado:', email, 'role=', role, 'orgId=', organizationId);
  } else {
    await db.insert(users).values({
      email,
      password: hashed,
      fullName,
      role,
      organizationId,
      isActive: true,
    });
    console.log('Usuario creado:', email, 'role=', role, 'orgId=', organizationId);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
