/**
 * Importación de clientes desde WispHub (solo lectura).
 *
 * API oficial (OpenAPI /api-docs):
 *   GET {baseUrl}/api/clientes/?limit=&offset=
 *   Authorization: Api-Key {key}
 *   Respuesta DRF: { count, next, previous, results: Cliente[] }
 *   limit máx. 300 (doc WispHub).
 *
 * No llama activar/desactivar ni toca equipment/routers.
 * dteHabilitado permanece false (default).
 */
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { clients, users } from '../db/schema.js';
import { loadOrgWisphubSettings } from './orgWisphub.js';

const PAGE_LIMIT = 200; // ≤ 300 según docs WispHub
const FETCH_TIMEOUT_MS = 60_000;

function planName(row) {
  const p = row.plan_internet;
  if (!p) return '';
  if (typeof p === 'string') return p;
  return String(p.nombre || p.name || '').trim();
}

/**
 * Precio efectivo cobrado a ese cliente en WispHub.
 * OpenAPI Cliente.precio_plan — monto del servicio (puede diferir del precio de lista
 * del plan global cuando el ISP crea variantes por cliente).
 */
function effectivePrice(row) {
  const raw = row.precio_plan ?? row.precio ?? null;
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return n;
}

function mapLifecycle(estado) {
  const e = String(estado || '').toLowerCase();
  if (!e) return 'active';
  if (/cancel|baja|elimin/.test(e)) return 'cancelled';
  if (/suspend|corte|moros|inactiv/.test(e)) return 'suspended';
  if (/pend|instal/.test(e)) return 'pending_install';
  return 'active';
}

function mapClientType(tipoPersona) {
  const t = String(tipoPersona || '').toLowerCase();
  if (/empres|jurid|moral|business|comercial/.test(t)) return 'business';
  return 'individual';
}

function resolveEmail(row, orgId) {
  const raw = String(row.email || '').trim().toLowerCase();
  if (raw && raw.includes('@') && raw.length <= 255) return raw;
  const id = row.id_servicio != null ? String(row.id_servicio) : crypto.randomBytes(4).toString('hex');
  return `wisphub-${id}@org${orgId}.import.local`;
}

function resolveDocId(row) {
  const v = String(row.cedula || row.rfc || '').trim();
  return v ? v.slice(0, 20) : null;
}

function parseCoords(coordenadas) {
  const s = String(coordenadas || '').trim();
  if (!s) return { latitude: null, longitude: null };
  const parts = s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return { latitude: null, longitude: null };
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { latitude: null, longitude: null };
  return { latitude: String(lat), longitude: String(lng) };
}

function buildWisphubTags(row, existingTags) {
  const base = existingTags && typeof existingTags === 'object' && !Array.isArray(existingTags)
    ? { ...existingTags }
    : {};
  base.wisphub = {
    idServicio: row.id_servicio,
    usuario: row.usuario || null,
    plan: planName(row) || null,
    precioPlan: row.precio_plan != null ? String(row.precio_plan) : null,
    saldo: row.saldo != null ? String(row.saldo) : null,
    fechaCorte: row.fecha_corte != null ? String(row.fecha_corte) : null,
    estado: row.estado || null,
    estadoFacturas: row.estado_facturas || null,
    importedAt: new Date().toISOString(),
  };
  return base;
}

async function fetchClientesPage({ baseUrl, apiKey, limit, offset }) {
  const url = new URL('api/clientes/', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    if (!res.ok) {
      const detail = (json && (json.detail || json.error || json.message)) || text.slice(0, 300);
      throw new Error(`WispHub HTTP ${res.status}: ${detail}`);
    }
    if (!json || !Array.isArray(json.results)) {
      throw new Error('Respuesta WispHub inválida: se esperaba { count, results[] }');
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function upsertOneClient(orgId, row) {
  const wisphubId = row.id_servicio != null ? String(row.id_servicio) : '';
  if (!wisphubId) {
    throw new Error('Fila sin id_servicio');
  }

  const fullName = String(row.nombre || row.usuario || `Cliente WispHub ${wisphubId}`).trim().slice(0, 255) || `Cliente ${wisphubId}`;
  const email = resolveEmail(row, orgId);
  const phone = String(row.telefono || '').trim().slice(0, 20) || null;
  const address = String(row.direccion || '').trim() || null;
  const city = String(row.ciudad || row.localidad || '').trim().slice(0, 100) || null;
  const rut = resolveDocId(row);
  const clientType = mapClientType(row.tipo_persona);
  const lifecycleStatus = mapLifecycle(row.estado);
  const { latitude, longitude } = parseCoords(row.coordenadas);
  const notesParts = [];
  if (row.comentarios) notesParts.push(String(row.comentarios).trim());
  if (row.informacion_adicional) notesParts.push(String(row.informacion_adicional).trim());
  if (row.saldo != null && row.saldo !== '') notesParts.push(`Saldo WispHub: ${row.saldo}`);
  if (row.fecha_corte) notesParts.push(`Fecha corte WispHub: ${row.fecha_corte}`);
  const planNombre = planName(row) || null;
  const precioEfectivo = effectivePrice(row);
  if (planNombre) notesParts.push(`Plan WispHub: ${planNombre}`);
  if (precioEfectivo != null) notesParts.push(`Precio efectivo WispHub: ${precioEfectivo}`);
  const notes = notesParts.filter(Boolean).join('\n') || null;

  const planFields = {
    planNombre,
    precioEfectivo: precioEfectivo != null ? String(precioEfectivo) : null,
  };

  const [existing] = await db.select().from(clients)
    .where(and(eq(clients.organizationId, orgId), eq(clients.wisphubId, wisphubId)))
    .limit(1);

  if (existing) {
    const tags = buildWisphubTags(row, existing.tags);
    await db.update(users).set({
      fullName,
      phone,
      updatedAt: new Date(),
      // no cambiamos email en update para no romper login portal si ya existe
    }).where(eq(users.id, existing.userId));

    const [updated] = await db.update(clients).set({
      clientType,
      rut,
      address,
      city,
      latitude,
      longitude,
      notes,
      tags,
      ...planFields,
      lifecycleStatus: existing.deletedAt ? existing.lifecycleStatus : lifecycleStatus,
      // dteHabilitado NO se toca
      updatedAt: new Date(),
    }).where(eq(clients.id, existing.id)).returning();

    return {
      action: 'updated',
      clientId: updated.id,
      wisphubId,
      hasPlan: Boolean(planNombre),
      hasPrecio: precioEfectivo != null,
    };
  }

  // Email único global: si choca, sufijo con id_servicio
  let finalEmail = email;
  const [emailTaken] = await db.select({ id: users.id }).from(users)
    .where(eq(users.email, finalEmail)).limit(1);
  if (emailTaken) {
    finalEmail = `wisphub-${wisphubId}@org${orgId}.import.local`;
  }

  const plainPass = `FnWh${crypto.randomBytes(8).toString('hex')}A1!`;
  const hashedPassword = await bcrypt.hash(plainPass, 10);

  let user;
  let client;
  try {
    [user] = await db.insert(users).values({
      organizationId: orgId,
      email: finalEmail,
      password: hashedPassword,
      fullName,
      phone,
      role: 'client',
    }).returning();

    [client] = await db.insert(clients).values({
      organizationId: orgId,
      userId: user.id,
      clientType,
      rut,
      address,
      city,
      latitude,
      longitude,
      notes,
      tags: buildWisphubTags(row, null),
      wisphubId,
      ...planFields,
      dteHabilitado: false,
      lifecycleStatus,
    }).returning();
  } catch (err) {
    if (user?.id) {
      try { await db.delete(users).where(eq(users.id, user.id)); } catch { /* ignore */ }
    }
    throw err;
  }

  return {
    action: 'created',
    clientId: client.id,
    wisphubId,
    hasPlan: Boolean(planNombre),
    hasPrecio: precioEfectivo != null,
  };
}

/**
 * Recorre todos los clientes de WispHub (paginado) e UPSERT por wisphub_id.
 * @returns {{ ok, total, created, updated, errors: Array<{ wisphubId, message }> }}
 */
export async function importWisphubClients(organizationId) {
  const loaded = await loadOrgWisphubSettings(organizationId);
  if (!loaded) {
    return { ok: false, error: 'Organización no encontrada', total: 0, created: 0, updated: 0, errors: [] };
  }

  const apiKey = String(loaded.settings.wisphubApiKey || '').trim();
  const baseUrl = String(loaded.settings.wisphubBaseUrl || '').trim().replace(/\/+$/, '');
  if (!apiKey || !baseUrl) {
    return {
      ok: false,
      error: 'Configura y guarda wisphubApiKey + wisphubBaseUrl en Ajustes antes de importar (el campo con puntos del navegador no cuenta si no está guardado).',
      total: 0,
      created: 0,
      updated: 0,
      errors: [],
    };
  }

  let offset = 0;
  let totalRemote = null;
  let created = 0;
  let updated = 0;
  let processed = 0;
  let sinPlan = 0;
  let sinPrecio = 0;
  const errors = [];

  while (true) {
    const page = await fetchClientesPage({
      baseUrl,
      apiKey,
      limit: PAGE_LIMIT,
      offset,
    });

    if (totalRemote == null) totalRemote = Number(page.count) || 0;
    const results = page.results || [];
    if (!results.length) break;

    for (const row of results) {
      const idLabel = row?.id_servicio != null ? String(row.id_servicio) : (row?.usuario || '?');
      try {
        const r = await upsertOneClient(organizationId, row);
        processed += 1;
        if (r.action === 'created') created += 1;
        else updated += 1;
        if (!r.hasPlan) sinPlan += 1;
        if (!r.hasPrecio) sinPrecio += 1;
      } catch (err) {
        errors.push({
          wisphubId: idLabel,
          message: err.message || String(err),
        });
      }
    }

    offset += results.length;
    if (page.next == null || results.length < PAGE_LIMIT) break;
    if (totalRemote > 0 && offset >= totalRemote) break;
  }

  return {
    ok: true,
    total: processed,
    remoteCount: totalRemote,
    created,
    updated,
    sinPlan,
    sinPrecio,
    errors,
    errorCount: errors.length,
  };
}
