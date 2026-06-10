import { Router } from 'express';
import { db } from '../db/index.js';
import { plans } from '../db/schema.js';
import { requireRole } from '../middleware/auth.js';

export const plansRouter = Router();

plansRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const allPlans = await db.select().from(plans);
    res.json(allPlans);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar planes' });
  }
});

plansRouter.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { name, type, downloadSpeed, uploadSpeed, price, description } = req.body;
    const [plan] = await db.insert(plans).values({
      name, type, downloadSpeed, uploadSpeed, price: String(price), description
    }).returning();
    res.status(201).json(plan);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear plan' });
  }
});
