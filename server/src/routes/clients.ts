import { Router } from 'express';
import { db } from '../db/index.js';
import { clients, users } from '../db/schema.js';
import { eq, like, or } from 'drizzle-orm';
import { AuthRequest, requireRole } from '../middleware/auth.js';

export const clientsRouter = Router();

clientsRouter.get('/', requireRole('admin', 'technician'), async (req: AuthRequest, res) => {
  try {
    const { search, limit = '50', offset = '0' } = req.query;
    let conditions = [];
    
    if (search) {
      const searchTerm = `%${search}%`;
      conditions.push(or(like(users.fullName, searchTerm), like(users.email, searchTerm)));
    }

    const allClients = await db
      .select({
        id: clients.id,
        userId: clients.userId,
        clientType: clients.clientType,
        rut: clients.rut,
        address: clients.address,
        city: clients.city,
        region: clients.region,
        createdAt: clients.createdAt,
        user: {
          fullName: users.fullName,
          email: users.email,
          phone: users.phone,
          isActive: users.isActive,
        },
      })
      .from(clients)
      .leftJoin(users, eq(clients.userId, users.id))
      .limit(Number(limit))
      .offset(Number(offset));

    res.json(allClients);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar clientes' });
  }
});

clientsRouter.get('/:id', requireRole('admin', 'technician'), async (req: AuthRequest, res) => {
  try {
    const clientId = Number(req.params.id);
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, clientId),
      with: {
        user: true,
        services: { with: { plan: true } },
        equipment: true,
        invoices: { limit: 10 },
        tickets: { limit: 10 },
      },
    });

    if (!client) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const { password: _, ...userWithoutPassword } = client.user;
    res.json({ ...client, user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener cliente' });
  }
});
