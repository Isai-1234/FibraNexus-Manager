import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
export const paymentsRouter = Router();
paymentsRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  res.json({ message: 'payments route', data: [] });
});
paymentsRouter.get('/:id', requireRole('admin', 'technician'), async (req, res) => {
  res.json({ message: 'payments detail', id: req.params.id });
});
