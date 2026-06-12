import { Router } from 'express';
import { db } from '../db/index.js';
import { clients, users, invoices, tickets, clientServices, payments } from '../db/schema.js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { parsePaginationQuery, paginationMeta } from '../lib/pagination.js';
import bcrypt from 'bcryptjs';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId } from '../lib/tenant.js';
import { buildClientOverview } from '../lib/clientOverview.js';
import { listClientEquipment } from '../lib/equipmentClientLink.js';

export const clientsRouter = Router();

clientsRouter.get('/overview', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    res.json(await buildClientOverview(orgId));
  } catch (error) {
    res.status(500).json({ error: 'Error al listar clientes' });
  }
});

clientsRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const { page, limit, offset, paginated } = parsePaginationQuery(req.query);

    const baseSelect = {
      id: clients.id, userId: clients.userId, clientType: clients.clientType,
      rut: clients.rut, address: clients.address, city: clients.city,
      region: clients.region, createdAt: clients.createdAt,
      user: { fullName: users.fullName, email: users.email, phone: users.phone, isActive: users.isActive },
    };

    if (paginated) {
      const [{ total }] = await db.select({ total: sql`count(*)::int` })
        .from(clients)
        .where(orgFilter(clients, orgId));
      const rows = await db.select(baseSelect)
        .from(clients)
        .leftJoin(users, eq(clients.userId, users.id))
        .where(orgFilter(clients, orgId))
        .limit(limit)
        .offset(offset);
      return res.json({ items: rows, pagination: paginationMeta(total, page, limit) });
    }

    const allClients = await db.select(baseSelect)
      .from(clients)
      .leftJoin(users, eq(clients.userId, users.id))
      .where(orgFilter(clients, orgId))
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
    const items = await listClientEquipment(clientId, orgId);
    res.json(items);
  } catch (error) {
    const status = error.message === 'Abonado no encontrado' ? 404 : 500;
    res.status(status).json({ error: error.message || 'Error al listar equipos' });
  }
});

clientsRouter.get('/:id', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const clientId = parseInt(req.params.id);
    const result = await db.select({
      id: clients.id, userId: clients.userId, clientType: clients.clientType,
      rut: clients.rut, address: clients.address, city: clients.city,
      region: clients.region, notes: clients.notes, createdAt: clients.createdAt,
      user: { fullName: users.fullName, email: users.email, phone: users.phone, isActive: users.isActive },
    }).from(clients).leftJoin(users, eq(clients.userId, users.id))
      .where(and(eq(clients.id, clientId), orgFilter(clients, orgId))).limit(1);
    if (!result.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(result[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener cliente: ' + error.message });
  }
});

clientsRouter.post('/', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const { email, password, fullName, phone, clientType, rut, address, city, region } = req.body;
    const hashedPassword = await bcrypt.hash(password || '123456', 10);
    const [user] = await db.insert(users).values({
      organizationId: orgId,
      email, password: hashedPassword, fullName, phone, role: 'client',
    }).returning();
    const [client] = await db.insert(clients).values({
      organizationId: orgId,
      userId: user.id, clientType: clientType || 'individual', rut, address, city, region,
    }).returning();
    const { password: _, ...userData } = user;
    res.status(201).json({ ...client, user: userData });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear cliente: ' + error.message });
  }
});

clientsRouter.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const clientId = parseInt(req.params.id);
    const { fullName, email, phone, clientType, rut, address, city, region, password } = req.body;
    const existing = await db.select().from(clients)
      .where(and(eq(clients.id, clientId), orgFilter(clients, orgId))).limit(1);
    if (!existing.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    const row = existing[0];
    const userUpdate = {};
    if (fullName) userUpdate.fullName = fullName;
    if (email) userUpdate.email = email;
    if (phone) userUpdate.phone = phone;
    if (password) userUpdate.password = await bcrypt.hash(password, 10);
    userUpdate.updatedAt = new Date();
    if (Object.keys(userUpdate).length > 1) {
      await db.update(users).set(userUpdate).where(eq(users.id, row.userId));
    }
    const [updated] = await db.update(clients).set({
      clientType: clientType || row.clientType,
      rut: rut ?? row.rut,
      address: address ?? row.address,
      city: city ?? row.city,
      region: region ?? row.region,
      updatedAt: new Date(),
    }).where(eq(clients.id, clientId)).returning();
    res.json({ ...updated, user: { fullName, email, phone } });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar cliente: ' + error.message });
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

    const clientInvoices = await db.select({ id: invoices.id })
      .from(invoices).where(eq(invoices.clientId, clientId));
    const invoiceIds = clientInvoices.map((i) => i.id);

    if (invoiceIds.length) {
      await db.delete(payments).where(inArray(payments.invoiceId, invoiceIds));
      await db.delete(invoices).where(eq(invoices.clientId, clientId));
    }
    await db.delete(tickets).where(eq(tickets.clientId, clientId));
    await db.delete(clientServices).where(eq(clientServices.clientId, clientId));
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(users).where(eq(users.id, existing[0].userId));

    res.json({ message: 'Abonado eliminado junto con servicios, facturas y tickets' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar: ' + error.message });
  }
});
