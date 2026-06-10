import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
export const plansRouter = Router();
plansRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  res.json({ message: 'plans route', data: [] });
});
plansRouter.get('/:id', requireRole('admin', 'technician'), async (req, res) => {
  res.json({ message: 'plans detail', id: req.params.id });
});
