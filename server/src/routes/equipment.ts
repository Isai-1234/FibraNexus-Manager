import { Router } from 'express';
import { AuthRequest, requireRole } from '../middleware/auth.js';

export const equipmentRouter = Router();

equipmentRouter.get('/', requireRole('admin', 'technician'), async (req: AuthRequest, res) => {
  res.json({ message: 'equipment route working', data: [] });
});

equipmentRouter.get('/:id', requireRole('admin', 'technician'), async (req: AuthRequest, res) => {
  res.json({ message: 'equipment detail', id: req.params.id });
});
