import { Router } from 'express';
import { db } from '../db/index.js';
import { ipAddresses, clients, users, networkPools } from '../db/schema.js';
import { and, eq, asc } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId } from '../lib/tenant.js';
import {
  attachUsageToPool,
  collectOrgIpUsage,
  guessPoolType,
  suggestPoolsFromUsage,
  subnetMeta,
} from '../lib/networkPoolUsage.js';

export const ipManagementRouter = Router();

const POOL_TYPES = new Set(['residential', 'business', 'wireless', 'management']);

function poolCode(id) {
  return `N-${String(id).padStart(2, '0')}`;
}

function normalizePoolBody(body = {}) {
  const name = String(body.name || '').trim();
  const subnetRaw = String(body.subnet || '').trim();
  if (!name) throw new Error('Nombre requerido');
  if (!subnetRaw) throw new Error('Subred requerida (ej: 192.168.10.0/24)');
  const meta = subnetMeta(subnetRaw);
  const poolType = POOL_TYPES.has(body.poolType) ? body.poolType : guessPoolType(name, meta.subnet);
  const status = body.status === 'inactive' ? 'inactive' : 'active';
  return {
    name,
    subnet: meta.subnet,
    gateway: body.gateway ? String(body.gateway).trim() : meta.defaultGateway,
    dns: body.dns != null ? String(body.dns).trim() || null : '8.8.8.8, 1.1.1.1',
    vlan: body.vlan != null && body.vlan !== '' ? parseInt(body.vlan, 10) : null,
    poolType,
    status,
    siteId: body.siteId ? parseInt(body.siteId, 10) : null,
    routerId: body.routerId ? parseInt(body.routerId, 10) : null,
    notes: body.notes != null ? String(body.notes).trim() || null : null,
  };
}

// ─── Pools / redes ───────────────────────────────────────────────

ipManagementRouter.get('/pools', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;

    const [rows, allUsed] = await Promise.all([
      db.select().from(networkPools)
        .where(orgFilter(networkPools, orgId))
        .orderBy(asc(networkPools.id)),
      collectOrgIpUsage(orgId),
    ]);

    const items = rows.map((p) => attachUsageToPool(p, allUsed, poolCode(p.id)));
    const suggested = rows.length === 0 ? suggestPoolsFromUsage(allUsed) : [];

    const byType = {
      residential: items.filter((i) => i.poolType === 'residential').length,
      business: items.filter((i) => i.poolType === 'business').length,
      wireless: items.filter((i) => i.poolType === 'wireless').length,
      management: items.filter((i) => i.poolType === 'management').length,
    };
    const usedSum = items.reduce((s, i) => s + (i.usedCount || 0), 0);
    const totalSum = items.reduce((s, i) => s + (i.totalUsable || 0), 0);

    res.json({
      items,
      suggested,
      stats: {
        networks: items.length,
        usedIps: usedSum,
        totalIps: totalSum,
        byType,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al listar pools: ' + error.message });
  }
});

ipManagementRouter.post('/pools', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const data = normalizePoolBody(req.body);
    const [created] = await db.insert(networkPools).values({
      organizationId: orgId,
      ...data,
    }).returning();
    const allUsed = await collectOrgIpUsage(orgId);
    res.status(201).json(attachUsageToPool(created, allUsed, poolCode(created.id)));
  } catch (error) {
    const msg = error.message || 'Error al crear red';
    const status = /unique|duplicate|uq_network/i.test(msg) ? 409 : 400;
    res.status(status).json({ error: msg });
  }
});

ipManagementRouter.post('/pools/bootstrap', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const allUsed = await collectOrgIpUsage(orgId);
    const existing = await db.select({ subnet: networkPools.subnet })
      .from(networkPools)
      .where(orgFilter(networkPools, orgId));
    const have = new Set(existing.map((e) => e.subnet));
    const suggested = suggestPoolsFromUsage(allUsed).filter((s) => !have.has(s.subnet));
    const created = [];
    for (const s of suggested) {
      try {
        const [row] = await db.insert(networkPools).values({
          organizationId: orgId,
          name: s.name,
          subnet: s.subnet,
          gateway: s.gateway,
          dns: s.dns,
          vlan: null,
          poolType: s.poolType,
          status: 'active',
        }).returning();
        created.push(attachUsageToPool(row, allUsed, poolCode(row.id)));
      } catch {
        // skip duplicates
      }
    }
    res.json({ created: created.length, items: created });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

ipManagementRouter.patch('/pools/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const id = parseInt(req.params.id, 10);
    const [existing] = await db.select().from(networkPools)
      .where(and(eq(networkPools.id, id), orgFilter(networkPools, orgId)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: 'Red no encontrada' });

    const patch = { updatedAt: new Date() };
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body.subnet !== undefined) {
      const meta = subnetMeta(req.body.subnet);
      patch.subnet = meta.subnet;
    }
    if (req.body.gateway !== undefined) patch.gateway = String(req.body.gateway).trim() || null;
    if (req.body.dns !== undefined) patch.dns = String(req.body.dns).trim() || null;
    if (req.body.vlan !== undefined) {
      patch.vlan = req.body.vlan === '' || req.body.vlan == null ? null : parseInt(req.body.vlan, 10);
    }
    if (req.body.poolType !== undefined && POOL_TYPES.has(req.body.poolType)) {
      patch.poolType = req.body.poolType;
    }
    if (req.body.status !== undefined) {
      patch.status = req.body.status === 'inactive' ? 'inactive' : 'active';
    }
    if (req.body.notes !== undefined) patch.notes = String(req.body.notes || '').trim() || null;

    const [updated] = await db.update(networkPools).set(patch)
      .where(eq(networkPools.id, id)).returning();
    const allUsed = await collectOrgIpUsage(orgId);
    res.json(attachUsageToPool(updated, allUsed, poolCode(updated.id)));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

ipManagementRouter.delete('/pools/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const id = parseInt(req.params.id, 10);
    await db.delete(networkPools)
      .where(and(eq(networkPools.id, id), orgFilter(networkPools, orgId)));
    res.json({ message: 'Red eliminada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar red' });
  }
});

// ─── IPs sueltas (legacy CRUD) ───────────────────────────────────

ipManagementRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  const orgId = requireOrganizationId(req, res);
  if (!orgId) return;
  const ips = await db.select({
    id: ipAddresses.id, address: ipAddresses.address, subnet: ipAddresses.subnet,
    gateway: ipAddresses.gateway, vlan: ipAddresses.vlan, status: ipAddresses.status,
    assignedTo: { fullName: users.fullName },
  })
    .from(ipAddresses)
    .leftJoin(clients, eq(ipAddresses.assignedTo, clients.id))
    .leftJoin(users, eq(clients.userId, users.id))
    .where(orgFilter(ipAddresses, orgId))
    .limit(100);
  res.json(ips);
});

ipManagementRouter.post('/', requireRole('admin'), async (req, res) => {
  const orgId = requireOrganizationId(req, res);
  if (!orgId) return;
  const { address, subnet, gateway, vlan } = req.body;
  const [ip] = await db.insert(ipAddresses).values({
    organizationId: orgId,
    address, subnet, gateway, vlan: parseInt(vlan) || null,
  }).returning();
  res.status(201).json(ip);
});

ipManagementRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    // Avoid deleting pool routes by numeric id collision — pools use /pools/:id
    await db.delete(ipAddresses).where(and(eq(ipAddresses.id, parseInt(req.params.id)), orgFilter(ipAddresses, orgId)));
    res.json({ message: 'IP eliminada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar IP' });
  }
});
