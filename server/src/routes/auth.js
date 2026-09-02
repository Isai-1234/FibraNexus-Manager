import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { users, organizations, passwordResetTokens } from '../db/schema.js';
import { and, eq, isNull, gt } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticateToken } from '../middleware/auth.js';
import { slugify, loadOrganization, trialDaysLeft } from '../lib/tenant.js';
import { rateLimit } from '../lib/rateLimit.js';
import { parseBody, loginSchema, registerSchema, passwordResetRequestSchema, passwordResetConfirmSchema } from '../lib/validators.js';
import { writeAuditLog, clientIp } from '../lib/auditLog.js';
import { revokeToken } from '../lib/tokenRevocation.js';

export const authRouter = Router();

const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

function signToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET no configurado');
  }
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    },
    process.env.JWT_SECRET,
    { expiresIn: JWT_EXPIRES },
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

authRouter.post(
  '/register',
  rateLimit({ name: 'register', windowMs: 15 * 60_000, max: 5 }),
  async (req, res) => {
    try {
      const parsed = parseBody(registerSchema, req.body);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const { companyName, email, password, fullName, phone } = parsed.data;

      const existingUser = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
      if (existingUser) return res.status(409).json({ error: 'Este email ya está registrado' });

      let slug = slugify(companyName);
      let suffix = 0;
      while (await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) })) {
        suffix += 1;
        slug = `${slugify(companyName)}-${suffix}`;
      }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    const { getSaasPlanBySlug, limitsFromSaasPlan } = await import('../lib/saasPlans.js');
    const trialPlan = await getSaasPlanBySlug('trial');
    const planLimits = trialPlan ? limitsFromSaasPlan(trialPlan) : {
      plan: 'trial', maxClients: 50, maxUsers: 3, maxRouters: 3, maxEquipment: 100, metricsRetentionDays: 7,
    };

    const [organization] = await db.insert(organizations).values({
      name: companyName,
      slug,
      email: email.toLowerCase(),
      trialEndsAt,
      subscriptionStatus: 'trial',
      lastActivityAt: new Date(),
      isActive: true,
      ...planLimits,
    }).returning();

    const hashedPassword = await bcrypt.hash(password, 12);
      const [user] = await db.insert(users).values({
        organizationId: organization.id,
        email: email.toLowerCase(),
        password: hashedPassword,
        fullName,
        phone: phone || null,
        role: 'admin',
      }).returning();

      const token = signToken(user);
      await writeAuditLog({
        organizationId: organization.id,
        userId: user.id,
        action: 'auth.register',
        entity: 'organization',
        entityId: organization.id,
        ipAddress: clientIp(req),
      });

      res.status(201).json({
        token,
        user: userResponse(user, organization),
        message: 'Cuenta creada. Trial de 14 días activo.',
      });
    } catch (error) {
      console.error('Register error:', error.message);
      res.status(500).json({ error: 'Error al registrar' });
    }
  },
);

authRouter.post(
  '/login',
  rateLimit({ name: 'login', windowMs: 15 * 60_000, max: 20 }),
  async (req, res) => {
    try {
      const parsed = parseBody(loginSchema, req.body);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const { email, password } = parsed.data;

      const user = await db.query.users.findFirst({
        where: eq(users.email, email.toLowerCase()),
      });
      if (!user || !user.isActive) {
        await writeAuditLog({
          action: 'auth.login_failed',
          entity: 'user',
          details: { email: email.toLowerCase() },
          ipAddress: clientIp(req),
          success: false,
        });
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        await writeAuditLog({
          organizationId: user.organizationId,
          userId: user.id,
          action: 'auth.login_failed',
          entity: 'user',
          entityId: user.id,
          ipAddress: clientIp(req),
          success: false,
        });
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }

      await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, user.id));
      if (user.organizationId) {
        const { touchOrgActivity } = await import('../lib/saasPlans.js');
        await touchOrgActivity(user.organizationId);
      }
      const organization = user.organizationId ? await loadOrganization(user.organizationId) : null;
      const token = signToken(user);
      await writeAuditLog({
        organizationId: user.organizationId,
        userId: user.id,
        action: 'auth.login',
        entity: 'user',
        entityId: user.id,
        ipAddress: clientIp(req),
      });
      res.json({ user: userResponse(user, organization), token });
    } catch (error) {
      console.error('Login error:', error.message);
      if (/JWT_SECRET/i.test(String(error.message))) {
        return res.status(500).json({ error: 'JWT_SECRET no configurado en el servidor' });
      }
      res.status(500).json({ error: 'Error al iniciar sesión' });
    }
  },
);

authRouter.post('/logout', authenticateToken, async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  try {
    const decoded = jwt.decode(token);
    revokeToken(token, decoded?.exp);
    await writeAuditLog({
      organizationId: req.user.organizationId,
      userId: req.user.id,
      action: 'auth.logout',
      entity: 'user',
      entityId: req.user.id,
      ipAddress: clientIp(req),
    });
  } catch {
    /* ignore */
  }
  res.json({ message: 'Sesión cerrada' });
});

authRouter.post(
  '/password-reset/request',
  rateLimit({ name: 'pwreset', windowMs: 15 * 60_000, max: 5 }),
  async (req, res) => {
    try {
      const parsed = parseBody(passwordResetRequestSchema, req.body);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const email = parsed.data.email.toLowerCase();
      const user = await db.query.users.findFirst({ where: eq(users.email, email) });
      // Respuesta uniforme para no enumerar emails
      const okMsg = { message: 'Si el email existe, recibirás instrucciones de recuperación.' };
      if (!user || !user.isActive) return res.json(okMsg);

      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60_000);
      await db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      await writeAuditLog({
        organizationId: user.organizationId,
        userId: user.id,
        action: 'auth.password_reset_request',
        entity: 'user',
        entityId: user.id,
        ipAddress: clientIp(req),
      });

      const { sendMailForOrg, appPublicBaseUrl } = await import('../lib/mailer.js');
      const resetUrl = `${appPublicBaseUrl()}/reset-password?token=${rawToken}`;
      const mailConfigured = Boolean(process.env.RESEND_API_KEY);
      let mailProvider = 'none';
      try {
        const sent = await sendMailForOrg(user.organizationId, {
          to: email,
          subject: 'Recuperar contraseña — FibraNexus',
          text: `Hola${user.fullName ? ` ${user.fullName}` : ''},\n\nPara restablecer tu contraseña abre este enlace (válido 1 hora):\n${resetUrl}\n\nSi no pediste esto, ignora el correo.`,
          html: `<p>Hola${user.fullName ? ` ${user.fullName}` : ''},</p><p>Para restablecer tu contraseña (válido 1 hora):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Si no pediste esto, ignora el correo.</p>`,
        });
        mailProvider = sent?.provider || (mailConfigured ? 'resend' : 'console');
      } catch (mailErr) {
        console.error('Password reset mail error:', mailErr.message);
        // No filtramos el email; el token queda creado. En lab el link también va a logs.
        console.log('[password-reset] link (fallback log):', resetUrl);
        mailProvider = 'error';
      }

      // Sin Resend: el enlace queda en logs de Render. En desarrollo también en la respuesta.
      if (process.env.NODE_ENV !== 'production') {
        return res.json({
          ...okMsg,
          emailDelivery: mailProvider,
          mailConfigured,
          devToken: rawToken,
          resetUrl,
          expiresAt,
        });
      }
      if (!mailConfigured) {
        console.log('[password-reset] RESEND_API_KEY no configurada; enlace en logs:', resetUrl);
      }
      res.json({
        ...okMsg,
        emailDelivery: mailConfigured ? 'resend' : 'unavailable',
        mailConfigured,
        hint: mailConfigured
          ? undefined
          : 'El servidor aún no tiene correo configurado (RESEND_API_KEY). El enlace solo aparece en los logs de Render.',
      });
    } catch (error) {
      console.error('Password reset request error:', error.message || error);
      const hint = /password_reset_tokens|does not exist|relation/i.test(String(error.message || error))
        ? 'Falta migración de recuperación; redespliega o ejecuta node scripts/run-migrations.mjs'
        : 'Error al solicitar recuperación';
      res.status(500).json({ error: hint });
    }
  },
);
authRouter.post(
  '/password-reset/confirm',
  rateLimit({ name: 'pwreset_confirm', windowMs: 15 * 60_000, max: 10 }),
  async (req, res) => {
    try {
      const parsed = parseBody(passwordResetConfirmSchema, req.body);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const { token, password } = parsed.data;
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const rows = await db.select().from(passwordResetTokens)
        .where(and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ))
        .limit(1);
      const row = rows[0];
      if (!row) return res.status(400).json({ error: 'Token inválido o expirado' });

      const hashed = await bcrypt.hash(password, 12);
      await db.update(users).set({ password: hashed, updatedAt: new Date() }).where(eq(users.id, row.userId));
      await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id));

      await writeAuditLog({
        userId: row.userId,
        action: 'auth.password_reset_confirm',
        entity: 'user',
        entityId: row.userId,
        ipAddress: clientIp(req),
      });
      res.json({ message: 'Contraseña actualizada' });
    } catch (error) {
      console.error('Password reset confirm error:', error.message);
      res.status(500).json({ error: 'Error al actualizar contraseña' });
    }
  },
);

authRouter.get('/me', authenticateToken, async (req, res) => {
  const user = await db.query.users.findFirst({ where: eq(users.id, req.user.id) });
  if (!user || !user.isActive) return res.status(404).json({ error: 'Usuario no encontrado' });
  const organization = user.organizationId ? await loadOrganization(user.organizationId) : null;
  res.json(userResponse(user, organization));
});
