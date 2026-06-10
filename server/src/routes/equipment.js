import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
export const equipmentRouter = Router();
equipmentRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  res.json({ message: 'equipment route', data: [] });
});
equipmentRouter.get('/:id', requireRole('admin', 'technician'), async (req, res) => {
  res.json({ message: 'equipment detail', id: req.params.id });
});
