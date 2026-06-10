import { Router } from 'express';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticateToken } from '../middleware/auth.js';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Login attempt:', email);
    
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    console.log('User found:', user ? 'yes' : 'no');
    
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const valid = await bcrypt.compare(password, user.password);
    console.log('Password valid:', valid);
    
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, user.id));
    
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    const { password: _, ...userData } = user;
    res.json({ user: userData, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// Endpoint para crear admin (solo usar una vez)
authRouter.post('/setup', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const [user] = await db.insert(users).values({
      email,
      password: hashedPassword,
      fullName,
      role: 'admin',
    }).onConflictDoUpdate({
      target: users.email,
      set: { password: hashedPassword }
    }).returning();
    
    const { password: _, ...userData } = user;
    res.json({ message: 'Admin creado/actualizado', user: userData });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ error: 'Error en setup' });
  }
});

authRouter.get('/me', authenticateToken, async (req, res) => {
  const user = await db.query.users.findFirst({ where: eq(users.id, req.user.id) });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const { password: _, ...userData } = user;
  res.json(userData);
});