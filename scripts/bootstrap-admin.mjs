#!/usr/bin/env node
/** Compat: redirige al script dentro de server/ */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, '../server/scripts/bootstrap-admin.mjs');
const r = spawnSync(process.execPath, [target, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '../server'),
  env: process.env,
  shell: false,
});
process.exit(r.status ?? 1);
