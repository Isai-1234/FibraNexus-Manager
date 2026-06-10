import { Router } from 'express';
import { db } from '../db/index.js';
import { equipment } from '../db/schema.js';
import { requireRole } from '../middleware/auth.js';

export const equipmentRouter = Router();

equipmentRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const allEquipment = await db.select().from(equipment).limit(50);
    res.json(allEquipment);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar equipos' });
  }
});

equipmentRouter.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { name, type, brand, model, ipAddress, location } = req.body;
    const [eq] = await db.insert(equipment).values({
      name, type, brand, model, ipAddress, location, status: 'offline'
    }).returning();
    res.status(201).json(eq);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear equipo' });
  }
});
