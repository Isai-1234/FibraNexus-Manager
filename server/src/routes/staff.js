import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { requireRole } from '../middleware/auth.js';
import { requireOrganizationId } from '../lib/tenant.js';
import { assertWithinStaffLimit } from '../lib/orgLimits.js';
import { writeAuditLog, clientIp } from '../lib/auditLog.js';
import { parseBody, passwordSchema } from '../lib/validators.js';
import { z } from 'zod';

export const staffRouter = Router();

const createStaffSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(255),
  password: passwordSchema,
  role: z.enum(['admin', 'office', 'technician']),
  phone: z.string().max(20).optional().nullable(),
});

staffRouter.get('/', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const rows = await db.select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      phone: users.phone,
      isActive: users.isActive,
      lastLogin: users.lastLogin,
      createdAt: users.createdAt,
    })
      .from(users)
      .where(and(
        eq(users.organizationId, orgId),
        inArray(users.role, ['admin', 'office', 'technician']),
      ));
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar staff' });
  }
});

staffRouter.post('/', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const parsed = parseBody(createStaffSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    await assertWithinStaffLimit(req.organization);

    const existing = await db.query.users.findFirst({
      where: eq(users.email, parsed.data.email.toLowerCase()),
    });
    if (existing) return res.status(409).json({ error: 'Email ya registrado' });

    const hashed = await bcrypt.hash(parsed.data.password, 12);
    const [user] = await db.insert(users).values({
      organizationId: orgId,
      email: parsed.data.email.toLowerCase(),
      password: hashed,
      fullName: parsed.data.fullName,
      phone: parsed.data.phone || null,
      role: parsed.data.role,
    }).returning();

    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'staff.create',
      entity: 'user',
      entityId: user.id,
      details: { role: user.role, email: user.email },
      ipAddress: clientIp(req),
    });

    const { password: _, ...safe } = user;
    res.status(201).json(safe);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Error al crear usuario' });
  }
});

staffRouter.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const id = parseInt(req.params.id, 10);
    const [existing] = await db.select().from(users)
      .where(and(eq(users.id, id), eq(users.organizationId, orgId)))
      .limit(1);
    if (!existing || !['admin', 'office', 'technician'].includes(existing.role)) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    if (existing.id === req.user.id && req.body.isActive === false) {
      return res.status(400).json({ error: 'No puedes desactivarte a ti mismo' });
    }

    const updates = { updatedAt: new Date() };
    if (req.body.fullName != null) updates.fullName = req.body.fullName;
    if (req.body.phone !== undefined) updates.phone = req.body.phone;
    if (req.body.role != null && ['admin', 'office', 'technician'].includes(req.body.role)) {
      updates.role = req.body.role;
    }
    if (req.body.isActive != null) updates.isActive = Boolean(req.body.isActive);
    if (req.body.password) {
      const pw = passwordSchema.safeParse(req.body.password);
      if (!pw.success) return res.status(400).json({ error: pw.error.errors[0].message });
      updates.password = await bcrypt.hash(req.body.password, 12);
    }

    const [updated] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'staff.update',
      entity: 'user',
      entityId: id,
      ipAddress: clientIp(req),
    });
    const { password: _, ...safe } = updated;
    res.json(safe);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
