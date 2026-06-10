import { Router } from 'express';
import { AuthRequest, requireRole } from '../middleware/auth.js';

export const invoicesRouter = Router();

invoicesRouter.get('/', requireRole('admin', 'technician'), async (req: AuthRequest, res) => {
  res.json({ message: 'invoices route working', data: [] });
});

invoicesRouter.get('/:id', requireRole('admin', 'technician'), async (req: AuthRequest, res) => {
  res.json({ message: 'invoices detail', id: req.params.id });
});
