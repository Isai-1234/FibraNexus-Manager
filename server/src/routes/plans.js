import { Router } from 'express';
import { db } from '../db/index.js';
import { plans } from '../db/schema.js';
import { and, eq, ne, or, isNull } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId } from '../lib/tenant.js';

export const plansRouter = Router();

plansRouter.get('/', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const includeDemo = req.query.includeDemo === '1';
    const conditions = [orgFilter(plans, orgId)];
    if (!includeDemo) {
      conditions.push(or(eq(plans.isActive, true), isNull(plans.isActive)));
    }
    const allPlans = await db.select().from(plans).where(and(...conditions));
    res.json(allPlans);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar planes' });
  }
});

plansRouter.post('/', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const { name, type, downloadSpeed, uploadSpeed, price, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre del plan requerido' });
    if (downloadSpeed == null || uploadSpeed == null || price == null) {
      return res.status(400).json({ error: 'Velocidades y precio son requeridos' });
    }
    const allowedTypes = ['fiber', 'wisp', 'copper', 'wireless'];
    const planType = allowedTypes.includes(type) ? type : 'fiber';
    const [plan] = await db.insert(plans).values({
      organizationId: orgId,
      name,
      type: planType,
      downloadSpeed: parseInt(downloadSpeed, 10),
      uploadSpeed: parseInt(uploadSpeed, 10),
      price: String(price),
      description: description || null,
    }).returning();
    res.status(201).json(plan);
  } catch (error) {
    console.error('Create plan error:', error.message);
    res.status(500).json({ error: error.message || 'Error al crear plan' });
  }
});

plansRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    await db.delete(plans).where(and(eq(plans.id, parseInt(req.params.id)), orgFilter(plans, orgId)));
    res.json({ message: 'Plan eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar plan' });
  }
});

plansRouter.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const { name, type, downloadSpeed, uploadSpeed, price, setupPrice, description } = req.body;
    const [updated] = await db.update(plans).set({
      name, type, downloadSpeed: parseInt(downloadSpeed), uploadSpeed: parseInt(uploadSpeed),
      price, setupPrice, description, updatedAt: new Date(),
    }).where(and(eq(plans.id, parseInt(req.params.id)), orgFilter(plans, orgId))).returning();
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar plan' });
  }
});
