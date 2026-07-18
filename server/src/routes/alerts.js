import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { requireOrganizationId } from '../lib/tenant.js';
import {
  listOrgAlerts,
  countOpenAlerts,
  ackOrgAlert,
  resolveOrgAlert,
  refreshOperationalAlerts,
} from '../lib/orgAlerts.js';
import { writeAuditLog, clientIp } from '../lib/auditLog.js';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { orgAlerts } from '../db/schema.js';

export const alertsRouter = Router();

alertsRouter.get('/', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const status = req.query.status || 'open';
    const items = await listOrgAlerts(orgId, { status: status === 'all' ? null : status, limit: 80 });
    const counts = await countOpenAlerts(orgId);
    res.json({ items, counts });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Error al listar alertas' });
  }
});

alertsRouter.get('/summary', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    res.json(await countOpenAlerts(orgId));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

alertsRouter.post('/refresh', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const result = await refreshOperationalAlerts(orgId);
    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'alerts.refresh',
      entity: 'org_alerts',
      ipAddress: clientIp(req),
    });
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

alertsRouter.post('/:id/ack', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const id = parseInt(req.params.id, 10);
    const row = await ackOrgAlert(orgId, id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Alerta no encontrada o ya gestionada' });
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

alertsRouter.post('/:id/resolve', requireRole('admin', 'office'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const id = parseInt(req.params.id, 10);
    const [row] = await db.select().from(orgAlerts)
      .where(and(eq(orgAlerts.id, id), eq(orgAlerts.organizationId, orgId)))
      .limit(1);
    if (!row) return res.status(404).json({ error: 'Alerta no encontrada' });
    await resolveOrgAlert(orgId, row.dedupeKey);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
