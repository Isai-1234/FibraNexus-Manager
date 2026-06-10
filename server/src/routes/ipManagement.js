import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
export const ipManagementRouter = Router();
ipManagementRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  res.json({ message: 'ipManagement route', data: [] });
});
ipManagementRouter.get('/:id', requireRole('admin', 'technician'), async (req, res) => {
  res.json({ message: 'ipManagement detail', id: req.params.id });
});
