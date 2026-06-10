import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
export const ticketsRouter = Router();
ticketsRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  res.json({ message: 'tickets route', data: [] });
});
ticketsRouter.get('/:id', requireRole('admin', 'technician'), async (req, res) => {
  res.json({ message: 'tickets detail', id: req.params.id });
});
