/**
 * Almacenamiento local de evidencias OT (multipart).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getUploadRoot() {
  const configured = process.env.UPLOAD_DIR;
  if (configured) return path.resolve(configured);
  return path.join(__dirname, '../../uploads');
}

export function ensureUploadRoot() {
  const root = getUploadRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function workOrderUploadDir(orgId, workOrderId) {
  const dir = path.join(ensureUploadRoot(), 'work-orders', String(orgId), String(workOrderId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function buildStoredFilename(originalName) {
  const ext = path.extname(originalName || '').toLowerCase().slice(0, 10) || '.bin';
  const safeExt = /^\.(jpe?g|png|gif|webp|heic|pdf)$/i.test(ext) ? ext.toLowerCase() : '.bin';
  return `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${safeExt}`;
}

/** URL pública relativa servida por Express */
export function publicUploadUrl(orgId, workOrderId, filename) {
  return `/uploads/work-orders/${orgId}/${workOrderId}/${filename}`;
}
