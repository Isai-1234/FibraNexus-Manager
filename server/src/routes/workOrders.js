import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workOrders, clients, users } from '../db/schema.js';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId, getClientInOrg } from '../lib/tenant.js';
import { writeAuditLog, clientIp } from '../lib/auditLog.js';
import { z } from 'zod';
import { parseBody } from '../lib/validators.js';

export const workOrdersRouter = Router();

const createSchema = z.object({
  clientId: z.coerce.number().int().positive(),
  serviceId: z.coerce.number().int().positive().optional().nullable(),
  assignedTo: z.coerce.number().int().positive().optional().nullable(),
  title: z.string().min(3).max(255),
  type: z.enum(['install', 'visit', 'support', 'disconnect', 'other']).default('visit'),
  notes: z.string().max(5000).optional().nullable(),
  scheduledAt: z.string().optional().nullable(),
  checklist: z.array(z.object({
    id: z.string().optional(),
    label: z.string().min(1),
    done: z.boolean().optional(),
  })).optional(),
});

const defaultChecklist = (type) => {
  if (type === 'install') {
    return [
      { id: '1', label: 'Confirmar dirección y acceso', done: false },
      { id: '2', label: 'Instalar/verificar CPE', done: false },
      { id: '3', label: 'Medir señal / enlace', done: false },
      { id: '4', label: 'Probar navegación con el abonado', done: false },
      { id: '5', label: 'Entregar datos de portal/wifi', done: false },
    ];
  }
  return [
    { id: '1', label: 'Contactar abonado', done: false },
    { id: '2', label: 'Diagnosticar en terreno', done: false },
    { id: '3', label: 'Resolver o escalar', done: false },
  ];
};

workOrdersRouter.get('/', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const status = req.query.status;
    const conditions = [orgFilter(workOrders, orgId)];
    if (status) conditions.push(eq(workOrders.status, status));
    if (req.query.mine === '1' || req.query.mine === 'true') {
      conditions.push(eq(workOrders.assignedTo, req.user.id));
    }

    const rows = await db.select({
      id: workOrders.id,
      clientId: workOrders.clientId,
      serviceId: workOrders.serviceId,
      assignedTo: workOrders.assignedTo,
      title: workOrders.title,
      type: workOrders.type,
      status: workOrders.status,
      scheduledAt: workOrders.scheduledAt,
      completedAt: workOrders.completedAt,
      createdAt: workOrders.createdAt,
      clientName: users.fullName,
    })
      .from(workOrders)
      .leftJoin(clients, eq(workOrders.clientId, clients.id))
      .leftJoin(users, eq(clients.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(workOrders.createdAt))
      .limit(100);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar órdenes de trabajo' });
  }
});

workOrdersRouter.get('/:id', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const id = parseInt(req.params.id, 10);
    const [row] = await db.select().from(workOrders)
      .where(and(eq(workOrders.id, id), orgFilter(workOrders, orgId)))
      .limit(1);
    if (!row) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

workOrdersRouter.post('/', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const parsed = parseBody(createSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const data = parsed.data;

    const client = await getClientInOrg(data.clientId, orgId);
    if (!client) return res.status(404).json({ error: 'Abonado no encontrado' });

    const checklist = (data.checklist && data.checklist.length)
      ? data.checklist.map((c, i) => ({
        id: c.id || String(i + 1),
        label: c.label,
        done: Boolean(c.done),
      }))
      : defaultChecklist(data.type);

    const [wo] = await db.insert(workOrders).values({
      organizationId: orgId,
      clientId: data.clientId,
      serviceId: data.serviceId || null,
      assignedTo: data.assignedTo || null,
      createdBy: req.user.id,
      title: data.title,
      type: data.type,
      notes: data.notes || null,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      checklist,
      attachments: [],
      status: 'open',
    }).returning();

    if (data.type === 'install') {
      await db.update(clients)
        .set({ lifecycleStatus: 'pending_install', updatedAt: new Date() })
        .where(and(eq(clients.id, data.clientId), orgFilter(clients, orgId)));
    }

    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'work_order.create',
      entity: 'work_order',
      entityId: wo.id,
      details: { type: wo.type, clientId: wo.clientId },
      ipAddress: clientIp(req),
    });

    res.status(201).json(wo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

workOrdersRouter.patch('/:id', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const id = parseInt(req.params.id, 10);
    const [existing] = await db.select().from(workOrders)
      .where(and(eq(workOrders.id, id), orgFilter(workOrders, orgId)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: 'Orden no encontrada' });
    if (existing.status === 'done' || existing.status === 'cancelled') {
      return res.status(400).json({ error: 'La orden ya está cerrada; no se puede modificar' });
    }

    const updates = { updatedAt: new Date() };
    if (req.body.title != null) updates.title = String(req.body.title).slice(0, 255);
    if (req.body.notes !== undefined) updates.notes = req.body.notes;
    if (req.body.assignedTo !== undefined) {
      updates.assignedTo = req.body.assignedTo ? parseInt(req.body.assignedTo, 10) : null;
    }
    if (req.body.scheduledAt !== undefined) {
      updates.scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;
    }
    if (Array.isArray(req.body.checklist)) {
      updates.checklist = req.body.checklist.map((c, i) => ({
        id: c.id || String(i + 1),
        label: String(c.label || '').slice(0, 200),
        done: Boolean(c.done),
      }));
    }
    if (Array.isArray(req.body.attachments)) {
      // Solo metadatos/URL — sin upload binario en MVP
      updates.attachments = req.body.attachments.slice(0, 20).map((a) => ({
        name: String(a.name || 'archivo').slice(0, 120),
        url: String(a.url || '').slice(0, 500),
        note: a.note ? String(a.note).slice(0, 200) : undefined,
      }));
    }
    if (req.body.status === 'in_progress') updates.status = 'in_progress';

    const [updated] = await db.update(workOrders).set(updates)
      .where(eq(workOrders.id, id)).returning();

    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'work_order.update',
      entity: 'work_order',
      entityId: id,
      ipAddress: clientIp(req),
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

workOrdersRouter.post('/:id/complete', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const id = parseInt(req.params.id, 10);
    const [existing] = await db.select().from(workOrders)
      .where(and(eq(workOrders.id, id), orgFilter(workOrders, orgId)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: 'Orden no encontrada' });
    if (existing.status === 'done') return res.status(400).json({ error: 'Ya está completada' });
    if (existing.status === 'cancelled') return res.status(400).json({ error: 'Está anulada' });

    const checklist = Array.isArray(existing.checklist) ? existing.checklist : [];
    const pending = checklist.filter((c) => !c.done);
    if (pending.length && !req.body.force) {
      return res.status(400).json({
        error: `Quedan ${pending.length} ítems del checklist sin marcar. Envía force=true para cerrar igual.`,
        pending,
      });
    }

    const [updated] = await db.update(workOrders).set({
      status: 'done',
      completedAt: new Date(),
      completionNotes: req.body.completionNotes || null,
      checklist: checklist.map((c) => ({ ...c, done: true })),
      updatedAt: new Date(),
    }).where(eq(workOrders.id, id)).returning();

    if (existing.type === 'install') {
      await db.update(clients)
        .set({ lifecycleStatus: 'active', updatedAt: new Date() })
        .where(and(eq(clients.id, existing.clientId), orgFilter(clients, orgId)));
    }

    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'work_order.complete',
      entity: 'work_order',
      entityId: id,
      details: { force: Boolean(req.body.force) },
      ipAddress: clientIp(req),
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

workOrdersRouter.post('/:id/cancel', requireRole('admin', 'office'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const id = parseInt(req.params.id, 10);
    const [existing] = await db.select().from(workOrders)
      .where(and(eq(workOrders.id, id), orgFilter(workOrders, orgId)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: 'Orden no encontrada' });
    if (existing.status === 'done') {
      return res.status(400).json({ error: 'No se puede anular una orden completada' });
    }

    const [updated] = await db.update(workOrders).set({
      status: 'cancelled',
      cancelledAt: new Date(),
      notes: req.body.reason
        ? `${existing.notes || ''}\n[Anulación] ${req.body.reason}`.trim()
        : existing.notes,
      updatedAt: new Date(),
    }).where(eq(workOrders.id, id)).returning();

    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'work_order.cancel',
      entity: 'work_order',
      entityId: id,
      ipAddress: clientIp(req),
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
