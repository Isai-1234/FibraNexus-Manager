import { Router, Response } from 'express';
import { AuthRequest, requireRole } from '../middleware/auth.js';
export const Router = Router();
Router.get('/', requireRole('admin', 'technician'), async (req: AuthRequest, res: Response) => {
  res.json({ message: ' route', data: [] });
});
Router.get('/:id', requireRole('admin', 'technician'), async (req: AuthRequest, res: Response) => {
  res.json({ message: ' detail', id: req.params.id });
});
