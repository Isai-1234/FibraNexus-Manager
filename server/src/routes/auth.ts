import { Router } from 'express';
import { db } from '../db/index.js';
import { users, clients, activityLog } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AuthRequest, authenticateToken } from '../middleware/auth.js';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    await db.update(users)
      .set({ lastLogin: new Date() })
      .where(eq(users.id, user.id));

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token });
  } catch (error) {
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

authRouter.get('/me', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, req.user!.id),
      with: { client: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener perfil' });
  }
});
