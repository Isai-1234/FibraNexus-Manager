import { Router } from 'express';
import { AuthRequest, requireRole } from '../middleware/auth.js';

export const servicesRouter = Router();

servicesRouter.get('/', requireRole('admin', 'technician'), async (req: AuthRequest, res) => {
  res.json({ message: 'services route working', data: [] });
});

servicesRouter.get('/:id', requireRole('admin', 'technician'), async (req: AuthRequest, res) => {
  res.json({ message: 'services detail', id: req.params.id });
});
