import { Router } from 'express';
import { db } from '../db/index.js';
import { users, organizations } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticateToken } from '../middleware/auth.js';
import { slugify, loadOrganization, trialDaysLeft, ensureOrgStaffAccess } from '../lib/tenant.js';

export const authRouter = Router();

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  );
}

function userResponse(user, organization) {
  const { password: _, ...userData } = user;
  return {
    ...userData,
    organization: organization ? {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      plan: organization.plan,
      trialEndsAt: organization.trialEndsAt,
      trialDaysLeft: trialDaysLeft(organization),
    } : null,
  };
}

authRouter.post('/register', async (req, res) => {
  try {
    const { companyName, email, password, fullName, phone } = req.body;
    if (!companyName || !email || !password || !fullName) {
      return res.status(400).json({ error: 'Empresa, nombre, email y contraseña son requeridos' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const existingUser = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (existingUser) return res.status(409).json({ error: 'Este email ya está registrado' });

    let slug = slugify(companyName);
    let suffix = 0;
    while (await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) })) {
      suffix += 1;
      slug = `${slugify(companyName)}-${suffix}`;
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    const [organization] = await db.insert(organizations).values({
      name: companyName,
      slug,
      email,
      plan: 'trial',
      trialEndsAt,
    }).returning();

    const hashedPassword = await bcrypt.hash(password, 10);
    const [user] = await db.insert(users).values({
      organizationId: organization.id,
      email,
      password: hashedPassword,
      fullName,
      phone: phone || null,
      role: 'admin',
    }).returning();

    const token = signToken(user);
    res.status(201).json({
      token,
      user: userResponse(user, organization),
      message: 'Cuenta creada. Trial de 14 días activo.',
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Error al registrar: ' + error.message });
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });

    await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, user.id));

    const promoted = await ensureOrgStaffAccess(user);
    const organization = promoted.organizationId ? await loadOrganization(promoted.organizationId) : null;
    const token = signToken(promoted);
    res.json({ user: userResponse(promoted, organization), token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

authRouter.post('/setup', async (req, res) => {
  try {
    const { email, password, fullName, companyName } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    let organization = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'internetsur') });
    if (!organization) {
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 365);
      [organization] = await db.insert(organizations).values({
        name: companyName || 'Internetsur',
        slug: 'internetsur',
        email,
        plan: 'trial',
        trialEndsAt,
      }).returning();
    }

    const [user] = await db.insert(users).values({
      organizationId: organization.id,
      email,
      password: hashedPassword,
      fullName,
      role: 'admin',
    }).onConflictDoUpdate({
      target: users.email,
      set: { password: hashedPassword, organizationId: organization.id, role: 'admin' },
    }).returning();

    res.json({ message: 'Admin creado/actualizado', user: userResponse(user, organization) });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ error: 'Error en setup' });
  }
});

authRouter.get('/me', authenticateToken, async (req, res) => {
  let user = await db.query.users.findFirst({ where: eq(users.id, req.user.id) });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  user = await ensureOrgStaffAccess(user);
  const organization = user.organizationId ? await loadOrganization(user.organizationId) : null;
  res.json(userResponse(user, organization));
});
