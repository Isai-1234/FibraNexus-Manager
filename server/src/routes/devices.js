import { Router } from 'express';
import { db } from '../db/index.js';
import { detectedDevices, equipment, clients, users, clientServices, plans } from '../db/schema.js';
import { and, eq, desc, sql } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId } from '../lib/tenant.js';
import { dispatch, JobNames } from '../lib/jobs/queue.js';
import bcrypt from 'bcryptjs';

export const devicesRouter = Router();

// GET /api/devices/detected — lista dispositivos detectados con info del router
devicesRouter.get('/detected', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;

    const { equipmentId, status } = req.query;
    const filters = [orgFilter(detectedDevices, orgId)];
    if (equipmentId) filters.push(eq(detectedDevices.equipmentId, parseInt(equipmentId, 10)));
    if (status) filters.push(eq(detectedDevices.status, status));

    const rows = await db
      .select({
        id: detectedDevices.id,
        macAddress: detectedDevices.macAddress,
        ipAddress: detectedDevices.ipAddress,
        hostname: detectedDevices.hostname,
        interfaceName: detectedDevices.interfaceName,
        source: detectedDevices.source,
        firstSeen: detectedDevices.firstSeen,
        lastSeen: detectedDevices.lastSeen,
        status: detectedDevices.status,
        adoptedAsClientServiceId: detectedDevices.adoptedAsClientServiceId,
        equipmentId: detectedDevices.equipmentId,
        routerName: equipment.name,
        routerBrand: equipment.brand,
        routerModel: equipment.model,
      })
      .from(detectedDevices)
      .leftJoin(equipment, eq(detectedDevices.equipmentId, equipment.id))
      .where(and(...filters))
      .orderBy(desc(detectedDevices.lastSeen))
      .limit(500);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al listar dispositivos: ' + err.message });
  }
});

// GET /api/devices/scan/status — última vez que se escaneó
devicesRouter.get('/scan/status', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;

    const [latest] = await db
      .select({ lastSeen: sql`MAX(${detectedDevices.lastSeen})` })
      .from(detectedDevices)
      .where(orgFilter(detectedDevices, orgId));

    const [total] = await db
      .select({ count: sql`COUNT(*)::int` })
      .from(detectedDevices)
      .where(and(orgFilter(detectedDevices, orgId), eq(detectedDevices.status, 'detected')));

    res.json({ lastScan: latest?.lastSeen || null, pendingCount: total?.count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/devices/scan — dispara escaneo bajo demanda
devicesRouter.post('/scan', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;

    res.status(202).json({ message: 'Escaneo iniciado en background' });

    dispatch(JobNames.DEVICE_SCAN_ORG, { orgId })
      .catch((err) => console.error('[devices/scan] org=%d error: %s', orgId, err.message));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/devices/:id/ignore
devicesRouter.post('/:id/ignore', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const id = parseInt(req.params.id, 10);

    const [existing] = await db.select().from(detectedDevices)
      .where(and(eq(detectedDevices.id, id), orgFilter(detectedDevices, orgId)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: 'Dispositivo no encontrado' });

    await db.update(detectedDevices)
      .set({ status: 'ignored', updatedAt: new Date() })
      .where(eq(detectedDevices.id, id));

    res.json({ message: 'Dispositivo ignorado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/devices/:id/unignore — volver a detected
devicesRouter.post('/:id/unignore', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const id = parseInt(req.params.id, 10);

    await db.update(detectedDevices)
      .set({ status: 'detected', updatedAt: new Date() })
      .where(and(eq(detectedDevices.id, id), orgFilter(detectedDevices, orgId)));

    res.json({ message: 'Dispositivo restaurado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/devices/:id/adopt
// Body: { clientId?, newClient?: { fullName, email, phone, password }, planId, routerId? }
devicesRouter.post('/:id/adopt', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const id = parseInt(req.params.id, 10);

    const [device] = await db.select().from(detectedDevices)
      .where(and(eq(detectedDevices.id, id), orgFilter(detectedDevices, orgId)))
      .limit(1);

    if (!device) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    if (device.status === 'adopted') return res.status(409).json({ error: 'Dispositivo ya adoptado' });

    const { clientId: rawClientId, newClient, planId: rawPlanId, routerId: rawRouterId } = req.body;
    const planId = parseInt(rawPlanId, 10);
    if (!planId) return res.status(400).json({ error: 'planId requerido' });

    // Verificar plan existe en la org
    const [plan] = await db.select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.id, planId), orgFilter(plans, orgId)))
      .limit(1);
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });

    let clientId = rawClientId ? parseInt(rawClientId, 10) : null;

    // Crear nuevo cliente si se solicitó
    if (!clientId && newClient) {
      const { fullName, email, phone, password } = newClient;
      if (!fullName || !email) return res.status(400).json({ error: 'fullName y email requeridos para nuevo cliente' });

      const hashedPassword = await bcrypt.hash(password || Math.random().toString(36).slice(2) + 'Fn1!', 10);
      const [newUser] = await db.insert(users).values({
        organizationId: orgId,
        email,
        password: hashedPassword,
        fullName,
        phone: phone || null,
        role: 'client',
      }).returning();

      const [newClientRow] = await db.insert(clients).values({
        organizationId: orgId,
        userId: newUser.id,
        clientType: 'individual',
      }).returning();

      clientId = newClientRow.id;
    }

    if (!clientId) return res.status(400).json({ error: 'Proporciona clientId o newClient' });

    // Verificar que el cliente pertenece a la org
    const [clientRow] = await db.select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, clientId), orgFilter(clients, orgId)))
      .limit(1);
    if (!clientRow) return res.status(404).json({ error: 'Cliente no encontrado en esta organización' });

    // Crear client_service con la IP detectada
    const routerId = rawRouterId ? parseInt(rawRouterId, 10) : device.equipmentId;
    const installDate = new Date().toISOString().split('T')[0];

    const [service] = await db.insert(clientServices).values({
      clientId,
      planId,
      routerId,
      status: 'active',
      ipAddress: device.ipAddress || null,
      macAddress: device.macAddress,
      installationDate: installDate,
    }).returning();

    // Marcar dispositivo como adoptado
    await db.update(detectedDevices)
      .set({
        status: 'adopted',
        adoptedAsClientServiceId: service.id,
        updatedAt: new Date(),
      })
      .where(eq(detectedDevices.id, id));

    res.status(201).json({
      message: 'Dispositivo adoptado',
      clientServiceId: service.id,
      clientId,
      ipAddress: device.ipAddress,
    });
  } catch (err) {
    if (err.message?.includes('duplicate key') || err.message?.includes('unique constraint')) {
      return res.status(409).json({ error: 'Ya existe un servicio con esa IP para este abonado' });
    }
    res.status(500).json({ error: 'Error al adoptar: ' + err.message });
  }
});
