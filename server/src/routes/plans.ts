import { Router } from 'express';
import { AuthRequest, requireRole } from '../middleware/auth.js';

export const plansRouter = Router();

plansRouter.get('/', requireRole('admin', 'technician'), async (req: AuthRequest, res) => {
  res.json({ message: 'plans route working', data: [] });
});

plansRouter.get('/:id', requireRole('admin', 'technician'), async (req: AuthRequest, res) => {
  res.json({ message: 'plans detail', id: req.params.id });
});
