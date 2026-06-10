import { Router } from 'express';
import { AuthRequest, requireRole } from '../middleware/auth.js';

export const paymentsRouter = Router();

paymentsRouter.get('/', requireRole('admin', 'technician'), async (req: AuthRequest, res) => {
  res.json({ message: 'payments route working', data: [] });
});

paymentsRouter.get('/:id', requireRole('admin', 'technician'), async (req: AuthRequest, res) => {
  res.json({ message: 'payments detail', id: req.params.id });
});
