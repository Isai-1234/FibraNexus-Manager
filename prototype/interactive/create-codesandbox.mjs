/**
 * Sube el prototipo a CodeSandbox vía Define API.
 * Uso: node create-codesandbox.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;

const filesToUpload = [
  'package.json',
  'public/index.html',
  'src/index.js',
  'src/App.js',
  'src/data.js',
  'src/styles.css',
];

const files = {};
for (const rel of filesToUpload) {
  const full = path.join(root, rel);
  files[rel.replace(/\\/g, '/')] = { content: fs.readFileSync(full, 'utf8') };
}

const body = {
  files,
  template: 'create-react-app',
};

const res = await fetch('https://codesandbox.io/api/v1/sandboxes/define?json=1', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const data = await res.json();
if (!res.ok) {
  console.error('Error:', data);
  process.exit(1);
}

console.log('Sandbox URL:', data.sandbox_url || `https://codesandbox.io/s/${data.sandbox_id}`);
console.log('Sandbox ID:', data.sandbox_id);
