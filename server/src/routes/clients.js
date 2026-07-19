import { Router } from 'express';
import { db } from '../db/index.js';
import { clients, users, invoices, tickets, clientServices, equipment, detectedDevices } from '../db/schema.js';
import { and, eq, inArray, sql, isNull } from 'drizzle-orm';
import { parsePaginationQuery, paginationMeta } from '../lib/pagination.js';
import bcrypt from 'bcryptjs';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId, loadOrganization } from '../lib/tenant.js';
import { buildClientOverview } from '../lib/clientOverview.js';
import { listClientEquipment } from '../lib/equipmentClientLink.js';
import {
  refreshStaleEquipmentStatus,
  forceRefreshEquipmentStatus,
  attachEquipmentDisplay,
  isPollable,
} from '../lib/equipmentStatus.js';
import { enrichMacFromDhcp } from '../lib/ipAllocation.js';
import { assertWithinClientLimit } from '../lib/orgLimits.js';
import { assertOptionalRut } from '../lib/rut.js';
import { writeAuditLog, clientIp } from '../lib/auditLog.js';

export const clientsRouter = Router();

clientsRouter.get('/overview', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    res.json(await buildClientOverview(orgId));
  } catch (error) {
    res.status(500).json({ error: 'Error al listar clientes' });
  }
});

clientsRouter.get('/', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const { page, limit, offset, paginated } = parsePaginationQuery(req.query);

    const baseSelect = {
      id: clients.id, userId: clients.userId, clientType: clients.clientType,
      rut: clients.rut, address: clients.address, city: clients.city,
      region: clients.region, lifecycleStatus: clients.lifecycleStatus,
      latitude: clients.latitude, longitude: clients.longitude,
      createdAt: clients.createdAt,
      user: { fullName: users.fullName, email: users.email, phone: users.phone, isActive: users.isActive },
    };

    const activeFilter = and(orgFilter(clients, orgId), isNull(clients.deletedAt));

    if (paginated) {
      const [{ total }] = await db.select({ total: sql`count(*)::int` })
        .from(clients)
        .where(activeFilter);
      const rows = await db.select(baseSelect)
        .from(clients)
        .leftJoin(users, eq(clients.userId, users.id))
        .where(activeFilter)
        .limit(limit)
        .offset(offset);
      return res.json({ items: rows, pagination: paginationMeta(total, page, limit) });
    }

    const allClients = await db.select(baseSelect)
      .from(clients)
      .leftJoin(users, eq(clients.userId, users.id))
      .where(activeFilter)
      .limit(50);
    res.json(allClients);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar clientes' });
  }
});

clientsRouter.get('/:id/equipment', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const clientId = parseInt(req.params.id, 10);
    const quick = req.query.quick === '1' || req.query.quick === 'true';
    let items = await listClientEquipment(clientId, orgId);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.ipAddress && !item.macAddress && item.siteId) {
        const mac = await enrichMacFromDhcp(orgId, {
          siteId: item.siteId,
          ipAddress: item.ipAddress,
          macAddress: null,
        });
        if (mac) {
          await db.update(equipment).set({ macAddress: mac, updatedAt: new Date() })
            .where(eq(equipment.id, item.id));
          items[i] = { ...item, macAddress: mac };
        }
      }
    }

    items = quick
      ? items.map(attachEquipmentDisplay)
      : await refreshStaleEquipmentStatus(items, orgId);
    res.json(items);
  } catch (error) {
    const status = error.message === 'Abonado no encontrado' ? 404 : 500;
    res.status(status).json({ error: error.message || 'Error al listar equipos' });
  }
});

/** Poll SNMP en background — respuesta inmediata para no bloquear la UI. */
clientsRouter.post('/:id/equipment/refresh', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const clientId = parseInt(req.params.id, 10);
    let items = await listClientEquipment(clientId, orgId);
    const pollable = items.filter(isPollable);

    res.status(202).json({
      ok: true,
      polling: pollable.length,
      message: pollable.length
        ? 'Actualización SNMP iniciada'
        : 'Sin equipos con IP y community SNMP',
    });

    if (!pollable.length) return;

    setImmediate(async () => {
      try {
        await forceRefreshEquipmentStatus(items, orgId, { maxPoll: pollable.length });
      } catch (err) {
        console.error('[equipment-refresh] client=%s error=%s', clientId, err.message);
      }
    });
  } catch (error) {
    const status = error.message === 'Abonado no encontrado' ? 404 : 500;
    res.status(status).json({ error: error.message || 'Error al iniciar actualización SNMP' });
  }
});

clientsRouter.get('/:id', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const clientId = parseInt(req.params.id);
    const result = await db.select({
      id: clients.id, userId: clients.userId, clientType: clients.clientType,
      rut: clients.rut, address: clients.address, city: clients.city,
      region: clients.region, notes: clients.notes, createdAt: clients.createdAt,
      dteHabilitado: clients.dteHabilitado,
      wisphubId: clients.wisphubId,
      planNombre: clients.planNombre,
      precioEfectivo: clients.precioEfectivo,
      lifecycleStatus: clients.lifecycleStatus,
      user: { fullName: users.fullName, email: users.email, phone: users.phone, isActive: users.isActive },
    }).from(clients).leftJoin(users, eq(clients.userId, users.id))
      .where(and(eq(clients.id, clientId), orgFilter(clients, orgId))).limit(1);
    if (!result.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(result[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener cliente: ' + error.message });
  }
});

clientsRouter.post('/', requireRole('admin', 'office'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const org = req.organization || await loadOrganization(orgId);
    await assertWithinClientLimit(org);

    const { email, password, fullName, phone, clientType, rut, address, city, region, latitude, longitude, lifecycleStatus } = req.body;
    if (!email || !fullName) {
      return res.status(400).json({ error: 'Email y nombre son requeridos' });
    }
    const typeAliases = {
      individual: 'individual',
      business: 'business',
      residential: 'individual',
      residencial: 'individual',
      empresa: 'business',
      comercial: 'business',
    };
    const normalizedType = typeAliases[String(clientType || 'individual').toLowerCase()];
    if (!normalizedType) {
      return res.status(400).json({ error: 'Tipo de cliente inválido (individual o business)' });
    }
    const normalizedRut = assertOptionalRut(rut);
    const allowedLifecycle = ['prospect', 'pending_install', 'active', 'suspended', 'cut', 'cancelled'];
    const life = allowedLifecycle.includes(lifecycleStatus) ? lifecycleStatus : 'prospect';

    const plainPass = password && String(password).length >= 10
      ? password
      : cryptoRandomPassword();
    const hashedPassword = await bcrypt.hash(plainPass, 12);

    let user;
    let client;
    try {
      [user] = await db.insert(users).values({
        organizationId: orgId,
        email, password: hashedPassword, fullName, phone, role: 'client',
      }).returning();
      [client] = await db.insert(clients).values({
        organizationId: orgId,
        userId: user.id,
        clientType: normalizedType,
        rut: normalizedRut,
        address,
        city,
        region,
        latitude: latitude != null ? String(latitude) : null,
        longitude: longitude != null ? String(longitude) : null,
        lifecycleStatus: life,
        dteHabilitado: req.body.dteHabilitado === true,
      }).returning();
    } catch (inner) {
      if (user?.id) {
        try { await db.delete(users).where(eq(users.id, user.id)); } catch { /* ignore rollback helper */ }
      }
      throw inner;
    }

    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'client.create',
      entity: 'client',
      entityId: client.id,
      details: { lifecycleStatus: life },
      ipAddress: clientIp(req),
    });

    const { password: _, ...userData } = user;
    res.status(201).json({
      ...client,
      user: userData,
      temporaryPassword: password ? undefined : plainPass,
    });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Error al crear cliente' });
  }
});

function cryptoRandomPassword() {
  return `Fn${Date.now().toString(36)}A1!`;
}

clientsRouter.put('/:id', requireRole('admin', 'office'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const clientId = parseInt(req.params.id);
    const {
      fullName, email, phone, clientType, rut, address, city, region, password,
      latitude, longitude, lifecycleStatus, dteHabilitado,
    } = req.body;
    const existing = await db.select().from(clients)
      .where(and(eq(clients.id, clientId), orgFilter(clients, orgId))).limit(1);
    if (!existing.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    const row = existing[0];
    const userUpdate = {};
    if (fullName) userUpdate.fullName = fullName;
    if (email) userUpdate.email = email;
    if (phone) userUpdate.phone = phone;
    if (password) userUpdate.password = await bcrypt.hash(password, 12);
    userUpdate.updatedAt = new Date();
    if (Object.keys(userUpdate).length > 1) {
      await db.update(users).set(userUpdate).where(eq(users.id, row.userId));
    }

    const patch = {
      clientType: clientType || row.clientType,
      address: address ?? row.address,
      city: city ?? row.city,
      region: region ?? row.region,
      updatedAt: new Date(),
    };
    if (rut !== undefined) patch.rut = assertOptionalRut(rut);
    if (latitude !== undefined) patch.latitude = latitude != null && latitude !== '' ? String(latitude) : null;
    if (longitude !== undefined) patch.longitude = longitude != null && longitude !== '' ? String(longitude) : null;
    if (typeof dteHabilitado === 'boolean') patch.dteHabilitado = dteHabilitado;
    if (lifecycleStatus) {
      const allowed = ['prospect', 'pending_install', 'active', 'suspended', 'cut', 'cancelled'];
      if (!allowed.includes(lifecycleStatus)) {
        return res.status(400).json({ error: 'Estado de ciclo de vida inválido' });
      }
      patch.lifecycleStatus = lifecycleStatus;
    }

    const [updated] = await db.update(clients).set(patch)
      .where(eq(clients.id, clientId)).returning();

    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'client.update',
      entity: 'client',
      entityId: clientId,
      details: { lifecycleStatus: updated.lifecycleStatus, dteHabilitado: updated.dteHabilitado },
      ipAddress: clientIp(req),
    });

    res.json({ ...updated, user: { fullName, email, phone } });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Error al actualizar cliente' });
  }
});

clientsRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const clientId = parseInt(req.params.id);
    const existing = await db.select().from(clients)
      .where(and(eq(clients.id, clientId), orgFilter(clients, orgId))).limit(1);
    if (!existing.length) return res.status(404).json({ error: 'Abonado no encontrado' });
    if (existing[0].deletedAt) {
      return res.status(400).json({ error: 'El abonado ya está dado de baja' });
    }

    const svcRows = await db.select({ id: clientServices.id })
      .from(clientServices).where(eq(clientServices.clientId, clientId));
    const serviceIds = svcRows.map((s) => s.id);

    if (serviceIds.length) {
      await db.update(detectedDevices)
        .set({ status: 'detected', adoptedAsClientServiceId: null, updatedAt: new Date() })
        .where(inArray(detectedDevices.adoptedAsClientServiceId, serviceIds));
      await db.update(equipment)
        .set({ clientId: null, detectedDeviceId: null, updatedAt: new Date() })
        .where(and(eq(equipment.clientId, clientId), orgFilter(equipment, orgId)));
      await db.update(clientServices)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(clientServices.clientId, clientId));
    }

    // Anular solo facturas abiertas; preservar pagadas/parciales y todos los pagos
    await db.update(invoices)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(
        eq(invoices.clientId, clientId),
        inArray(invoices.status, ['pending', 'overdue', 'partial']),
      ));

    await db.update(clients)
      .set({ deletedAt: new Date(), lifecycleStatus: 'cancelled', updatedAt: new Date() })
      .where(eq(clients.id, clientId));

    await db.update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(users.id, existing[0].userId));

    const { writeAuditLog, clientIp } = await import('../lib/auditLog.js');
    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'client.soft_delete',
      entity: 'client',
      entityId: clientId,
      ipAddress: clientIp(req),
      details: { preservedInvoices: true },
    });

    res.json({
      message: 'Abonado dado de baja. Facturas pagadas/parciales y pagos se conservan.',
      softDelete: true,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al dar de baja: ' + error.message });
  }
});
