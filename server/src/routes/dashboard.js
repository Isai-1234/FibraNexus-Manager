import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
export const dashboardRouter = Router();
dashboardRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  res.json({ message: 'dashboard route', data: [] });
});
dashboardRouter.get('/:id', requireRole('admin', 'technician'), async (req, res) => {
  res.json({ message: 'dashboard detail', id: req.params.id });
});
