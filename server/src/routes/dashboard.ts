import { Router } from 'express';
import { AuthRequest, requireRole } from '../middleware/auth.js';

export const dashboardRouter = Router();

dashboardRouter.get('/', requireRole('admin', 'technician'), async (req: AuthRequest, res) => {
  res.json({ message: 'dashboard route working', data: [] });
});

dashboardRouter.get('/:id', requireRole('admin', 'technician'), async (req: AuthRequest, res) => {
  res.json({ message: 'dashboard detail', id: req.params.id });
});
