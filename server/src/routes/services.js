import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
export const servicesRouter = Router();
servicesRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  res.json({ message: 'services route', data: [] });
});
servicesRouter.get('/:id', requireRole('admin', 'technician'), async (req, res) => {
  res.json({ message: 'services detail', id: req.params.id });
});
