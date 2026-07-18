#!/usr/bin/env node
/**
 * Bootstrap local (ejecutar desde server/):
 *   $env:ALLOW_BOOTSTRAP="1"
 *   pnpm exec node scripts/bootstrap-admin.mjs --email E --password P --org-slug internetsur --role admin
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  path.join(__dirname, '../.env'),
  path.join(__dirname, '../.env.local'),
  path.join(__dirname, '../../.env'),
  path.join(process.cwd(), '.env'),
];

function loadEnvFiles() {
  for (const p of envCandidates) {
    if (!fs.existsSync(p)) continue;
    dotenv.config({ path: p, override: true });
    console.log('[bootstrap] .env cargado:', p);
  }
}

function readDatabaseUrlFromFiles() {
  for (const p of envCandidates) {
    if (!fs.existsSync(p)) continue;
    let buf = fs.readFileSync(p);
    if (buf[0] === 0xff && buf[1] === 0xfe) buf = Buffer.from(buf.toString('utf16le'));
    const text = buf.toString('utf8').replace(/^\uFEFF/, '');
    const m = text.match(/^\s*DATABASE_URL\s*=\s*(.+)$/m);
    if (!m) continue;
    let v = m[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return '';
}

function cleanUrl(raw) {
  let v = String(raw || '').trim();
  if (!v) return '';
  const uriMatch = v.match(/postgres(?:ql)?:\/\/[^\s"'`]+/i);
  if (uriMatch) v = uriMatch[0];
  v = v.replace(/^["']|["']$/g, '');
  // postgres.js + pgbouncer: quitar flag que a veces rompe prepares
  v = v.replace(/[?&]pgbouncer=true/i, (m) => (m.startsWith('?') ? '?' : '')).replace(/\?$/, '');
  v = v.replace(/\?&/, '?').replace(/[?&]$/, '');
  return v.trim();
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !String(process.argv[i + 1]).startsWith('--')) {
    return process.argv[i + 1];
  }
  return fallback;
}

async function main() {
  loadEnvFiles();

  if (process.env.ALLOW_BOOTSTRAP !== '1') {
    console.error('Refusado: define ALLOW_BOOTSTRAP=1');
    process.exit(1);
  }

  let dbUrl = cleanUrl(process.env.DATABASE_URL);
  if (!dbUrl) dbUrl = cleanUrl(readDatabaseUrlFromFiles());
  if (!dbUrl) {
    console.error('Falta DATABASE_URL en server/.env o en $env:DATABASE_URL');
    for (const p of envCandidates) {
      console.error(' ', p, fs.existsSync(p) ? 'existe' : 'no existe');
    }
    process.exit(1);
  }
  process.env.DATABASE_URL = dbUrl;

  const email = arg('email');
  const password = arg('password');
  const fullName = arg('name', 'Administrador');
  const orgSlug = arg('org-slug', 'internetsur');
  const role = arg('role', 'admin');

  if (!email || !password) {
    console.error('Faltan --email y --password');
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

  // Importar DB DESPUÉS de fijar DATABASE_URL
  const { default: bcrypt } = await import('bcryptjs');
  const { eq } = await import('drizzle-orm');
  const { db } = await import('../src/db/index.js');
  const { users, organizations } = await import('../src/db/schema.js');

  let organizationId = null;
  if (role !== 'superadmin') {
    const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) });
    if (!org) {
      console.error(`Organización slug=${orgSlug} no encontrada.`);
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
    console.log('OK Usuario actualizado:', normalizedEmail, 'role=', role, 'orgId=', organizationId);
  } else {
    await db.insert(users).values({
      email: normalizedEmail,
      password: hashed,
      fullName,
      role,
      organizationId,
      isActive: true,
    });
    console.log('OK Usuario creado:', normalizedEmail, 'role=', role, 'orgId=', organizationId);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
