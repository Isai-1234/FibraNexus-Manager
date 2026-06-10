import { Router } from 'express';
import { AuthRequest, requireRole } from '../middleware/auth.js';

export const ipManagementRouter = Router();

ipManagementRouter.get('/', requireRole('admin', 'technician'), async (req: AuthRequest, res) => {
  res.json({ message: 'ipManagement route working', data: [] });
});

ipManagementRouter.get('/:id', requireRole('admin', 'technician'), async (req: AuthRequest, res) => {
  res.json({ message: 'ipManagement detail', id: req.params.id });
});
