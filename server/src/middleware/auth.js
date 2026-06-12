import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { ensureOrgStaffAccess } from '../lib/tenant.js';

export async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    let user = await db.query.users.findFirst({ where: eq(users.id, decoded.id) });
    if (!user || !user.isActive) {
      return res.status(403).json({ error: 'Usuario inactivo o no encontrado' });
    }

    if (user.role !== 'superadmin') {
      user = await ensureOrgStaffAccess(user);
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    };
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Token inválido' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Sin permisos' });
    next();
  };
}
