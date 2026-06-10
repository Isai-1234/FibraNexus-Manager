import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
export const invoicesRouter = Router();
invoicesRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  res.json({ message: 'invoices route', data: [] });
});
invoicesRouter.get('/:id', requireRole('admin', 'technician'), async (req, res) => {
  res.json({ message: 'invoices detail', id: req.params.id });
});
