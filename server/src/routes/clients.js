import { Router } from 'express';
import { db } from '../db/index.js';
import { clients, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { requireRole } from '../middleware/auth.js';

export const clientsRouter = Router();

// GET - Listar clientes
clientsRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const allClients = await db
      .select({
        id: clients.id, userId: clients.userId, clientType: clients.clientType,
        rut: clients.rut, address: clients.address, city: clients.city,
        region: clients.region, createdAt: clients.createdAt,
        user: { fullName: users.fullName, email: users.email, phone: users.phone, isActive: users.isActive },
      })
      .from(clients)
      .leftJoin(users, eq(clients.userId, users.id))
      .limit(50);
    res.json(allClients);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar clientes' });
  }
});

// GET - Obtener un cliente
clientsRouter.get('/:id', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const clientId = parseInt(req.params.id);
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, clientId),
      with: { user: true },
    });
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    const { password: _, ...userData } = client.user;
    res.json({ ...client, user: userData });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener cliente' });
  }
});

// POST - Crear cliente
clientsRouter.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { email, password, fullName, phone, clientType, rut, address, city, region } = req.body;
    
    const hashedPassword = await bcrypt.hash(password || '123456', 10);
    
    const [user] = await db.insert(users).values({
      email, password: hashedPassword, fullName, phone, role: 'client'
    }).returning();

    const [client] = await db.insert(clients).values({
      userId: user.id, clientType: clientType || 'individual', rut, address, city, region
    }).returning();

    const { password: _, ...userData } = user;
    res.status(201).json({ ...client, user: userData });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear cliente: ' + error.message });
  }
});

// PUT /:id - Actualizar cliente
clientsRouter.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const clientId = parseInt(req.params.id);
    const { fullName, email, phone, clientType, rut, address, city, region, password } = req.body;
    const existing = await db.query.clients.findFirst({
      where: eq(clients.id, clientId), with: { user: true }
    });
    if (!existing) return res.status(404).json({ error: 'Cliente no encontrado' });
    const userUpdate: any = {};
    if (fullName) userUpdate.fullName = fullName;
    if (email) userUpdate.email = email;
    if (phone) userUpdate.phone = phone;
    if (password) userUpdate.password = await bcrypt.hash(password, 10);
    userUpdate.updatedAt = new Date();
    if (Object.keys(userUpdate).length > 1) {
      await db.update(users).set(userUpdate).where(eq(users.id, existing.userId));
    }
    const [updated] = await db.update(clients).set({
      clientType: clientType || existing.clientType,
      rut: rut ?? existing.rut,
      address: address ?? existing.address,
      city: city ?? existing.city,
      region: region ?? existing.region,
      updatedAt: new Date()
    }).where(eq(clients.id, clientId)).returning();
    res.json({ ...updated, user: { fullName, email, phone } });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al actualizar cliente: ' + error.message });
  }
});

// DELETE /:id - Eliminar cliente
clientsRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const clientId = parseInt(req.params.id);
    const existing = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
    if (!existing) return res.status(404).json({ error: 'Cliente no encontrado' });
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(users).where(eq(users.id, existing.userId));
    res.json({ message: 'Cliente eliminado' });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al eliminar: ' + error.message });
  }
});
