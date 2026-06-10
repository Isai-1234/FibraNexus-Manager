import { Router } from 'express';
import { db } from '../db/index.js';
import { plans } from '../db/schema.js';
import { eq } from 'drizzle-orm';
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

// DELETE /:id
plansRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await db.delete(plans).where(eq(plans.id, parseInt(req.params.id)));
    res.json({ message: 'Plan eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar plan' });
  }
});

// PUT /:id
plansRouter.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { name, type, downloadSpeed, uploadSpeed, price, setupPrice, description } = req.body;
    const [updated] = await db.update(plans).set({
      name, type, downloadSpeed: parseInt(downloadSpeed), uploadSpeed: parseInt(uploadSpeed),
      price, setupPrice, description, updatedAt: new Date()
    }).where(eq(plans.id, parseInt(req.params.id))).returning();
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar plan' });
  }
});
