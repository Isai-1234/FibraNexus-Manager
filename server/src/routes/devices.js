import { Router } from 'express';
import { db } from '../db/index.js';
import { detectedDevices, equipment, clients, users, clientServices, plans, deviceMetrics } from '../db/schema.js';
import { and, eq, desc, gte, sql } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId } from '../lib/tenant.js';
import { dispatch, JobNames } from '../lib/jobs/queue.js';
import { syncDetectedDeviceStates, enrichDetectedRowsWithLiveClient, clearOrphanServiceMac, reconcileDetectedGhosts } from '../lib/detectedDeviceSync.js';
import { normalizeMac, macsEqual, matchEquipmentRow, mergeEquipmentIdentity } from '../lib/equipmentIdentity.js';
import bcrypt from 'bcryptjs';

export const devicesRouter = Router();

// GET /api/devices/detected — lista dispositivos detectados con info del router
devicesRouter.get('/detected', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;

    await reconcileDetectedGhosts(orgId);

    const { equipmentId, status } = req.query;
    const filters = [orgFilter(detectedDevices, orgId)];
    if (equipmentId) filters.push(eq(detectedDevices.equipmentId, parseInt(equipmentId, 10)));

    const rawRows = await db
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

    let rows = await enrichDetectedRowsWithLiveClient(rawRows, orgId);

    if (status) {
      const want = String(status);
      rows = rows.filter((r) => {
        const eff = r.effectiveStatus || r.status;
        return eff === want;
      });
    }

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al listar dispositivos: ' + err.message });
  }
});

// GET /api/devices/metrics/:equipmentId?hours=24 — series de tiempo para gráficos
devicesRouter.get('/metrics/:equipmentId', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const equipId = parseInt(req.params.equipmentId, 10);
    const hours = Math.min(parseInt(req.query.hours || '24', 10), 168);

    const [equip] = await db.select({ id: equipment.id })
      .from(equipment)
      .where(and(eq(equipment.id, equipId), orgFilter(equipment, orgId)))
      .limit(1);
    if (!equip) return res.status(404).json({ error: 'Equipo no encontrado' });

    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const rows = await db.select({
      sampledAt: deviceMetrics.sampledAt,
      signal: deviceMetrics.signal,
      noise: deviceMetrics.noise,
      cinr: deviceMetrics.cinr,
      txCcq: deviceMetrics.txCcq,
      txRate: deviceMetrics.txRate,
      rxRate: deviceMetrics.rxRate,
    })
      .from(deviceMetrics)
      .where(and(eq(deviceMetrics.equipmentId, equipId), gte(deviceMetrics.sampledAt, cutoff)))
      .orderBy(deviceMetrics.sampledAt)
      .limit(2000);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// POST /api/devices/reconcile — limpia adopciones fantasma (registros viejos sin antena real)
devicesRouter.post('/reconcile', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const stats = await reconcileDetectedGhosts(orgId);
    res.json({ message: 'Limpieza completada', ...stats });
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

// POST /api/devices/:id/revert-adoption — quita vínculo fantasma (sin CPE en perfil)
devicesRouter.post('/:id/revert-adoption', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const id = parseInt(req.params.id, 10);

    const [device] = await db.select().from(detectedDevices)
      .where(and(eq(detectedDevices.id, id), orgFilter(detectedDevices, orgId)))
      .limit(1);
    if (!device) return res.status(404).json({ error: 'Dispositivo no encontrado' });

    if (device.adoptedAsClientServiceId) {
      const [svc] = await db.select({ clientId: clientServices.clientId })
        .from(clientServices).where(eq(clientServices.id, device.adoptedAsClientServiceId)).limit(1);
      if (svc?.clientId && device.macAddress) {
        await clearOrphanServiceMac(svc.clientId, device.macAddress, orgId, device.adoptedAsClientServiceId);
      }
    }

    await db.update(detectedDevices)
      .set({ status: 'detected', adoptedAsClientServiceId: null, updatedAt: new Date() })
      .where(eq(detectedDevices.id, id));

    await syncDetectedDeviceStates(orgId);
    res.json({ message: 'Dispositivo desvinculado' });
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

// POST /api/devices/:id/unignore — volver a detected (también limpia adopción fantasma)
devicesRouter.post('/:id/unignore', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const id = parseInt(req.params.id, 10);

    const [device] = await db.select().from(detectedDevices)
      .where(and(eq(detectedDevices.id, id), orgFilter(detectedDevices, orgId)))
      .limit(1);
    if (!device) return res.status(404).json({ error: 'Dispositivo no encontrado' });

    if (device.adoptedAsClientServiceId && device.macAddress) {
      const [svc] = await db.select({ clientId: clientServices.clientId })
        .from(clientServices).where(eq(clientServices.id, device.adoptedAsClientServiceId)).limit(1);
      if (svc?.clientId) {
        await clearOrphanServiceMac(svc.clientId, device.macAddress, orgId, device.adoptedAsClientServiceId);
      }
    }

    await db.update(detectedDevices)
      .set({ status: 'detected', adoptedAsClientServiceId: null, updatedAt: new Date() })
      .where(eq(detectedDevices.id, id));

    await syncDetectedDeviceStates(orgId);
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

    // Emparejar inventario: MAC primero, IP después (DHCP puede cambiar la IP).
    const orgCpeRows = await db.select({
      id: equipment.id,
      clientId: equipment.clientId,
      macAddress: equipment.macAddress,
      ipAddress: equipment.ipAddress,
      name: equipment.name,
    })
      .from(equipment)
      .where(and(eq(equipment.type, 'cpe'), orgFilter(equipment, orgId)));

    const macNorm = normalizeMac(device.macAddress);
    if (macNorm) {
      const macOwner = orgCpeRows.find((r) => macsEqual(r.macAddress, device.macAddress) && r.clientId && r.clientId !== clientId);
      if (macOwner) {
        return res.status(409).json({
          error: 'Esta MAC ya está asignada a otro abonado',
          conflictClientId: macOwner.clientId,
        });
      }
    }

    const { row: existingEquip, matchedBy, conflict } = matchEquipmentRow(orgCpeRows, {
      macAddress: device.macAddress,
      ipAddress: device.ipAddress,
      clientId,
    });
    if (conflict === 'ip_mac_mismatch') {
      return res.status(409).json({
        error: 'La IP coincide con otro equipo con MAC distinta. Revisa el inventario antes de adoptar.',
      });
    }

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

    // Crear o vincular equipo CPE en la pestaña "Equipos del Abonado"
    let equipmentId;
    if (existingEquip) {
      const { patch: identityPatch, conflict: idConflict } = mergeEquipmentIdentity(existingEquip, {
        macAddress: device.macAddress,
        ipAddress: device.ipAddress,
      });
      if (idConflict) {
        return res.status(409).json({ error: 'Conflicto de MAC al vincular el equipo detectado.' });
      }
      const [relinked] = await db.update(equipment)
        .set({
          clientId,
          detectedDeviceId: device.id,
          ...identityPatch,
          updatedAt: new Date(),
        })
        .where(eq(equipment.id, existingEquip.id))
        .returning({ id: equipment.id });
      equipmentId = relinked.id;
    } else {
      const equipName = device.hostname || `CPE-${device.macAddress.slice(-5).replace(/:/g, '')}`;
      const [newEquip] = await db.insert(equipment).values({
        organizationId: orgId,
        name: equipName,
        type: 'cpe',
        brand: 'Detectado',
        model: device.hostname || 'CPE',
        ipAddress: device.ipAddress || null,
        macAddress: device.macAddress,
        clientId,
        detectedDeviceId: device.id,
        status: 'offline',
      }).returning({ id: equipment.id });
      equipmentId = newEquip.id;
    }

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
      equipmentId,
      clientId,
      ipAddress: device.ipAddress,
      matchedBy: matchedBy || 'new',
    });
  } catch (err) {
    if (err.message?.includes('duplicate key') || err.message?.includes('unique constraint')) {
      return res.status(409).json({ error: 'Ya existe un servicio con esa IP para este abonado' });
    }
    res.status(500).json({ error: 'Error al adoptar: ' + err.message });
  }
});
