import { Router } from 'express';
import { db } from '../db/index.js';
import { clientServices, clients, plans, users, equipment } from '../db/schema.js';
import { and, eq, ne, inArray, sql } from 'drizzle-orm';
import { parsePaginationQuery, paginationMeta } from '../lib/pagination.js';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId, getClientInOrg, getPlanInOrg, getServiceInOrg } from '../lib/tenant.js';
import { dispatch, JobNames } from '../lib/jobs/queue.js';
import { billingDayFromInstall, computeNextBillingDate } from '../lib/billing.js';
import { createInvoiceForService } from '../lib/invoiceService.js';

export const servicesRouter = Router();

const BLOCKING_STATUSES = ['active', 'suspended', 'pending'];

async function findServiceConflict(orgId, { clientId, planId, ipAddress, excludeId }) {
  const baseOrg = orgFilter(clients, orgId);
  const exclude = excludeId ? ne(clientServices.id, excludeId) : undefined;

  const sameClientPlan = await db.select({ id: clientServices.id })
    .from(clientServices)
    .innerJoin(clients, eq(clientServices.clientId, clients.id))
    .where(and(
      baseOrg,
      eq(clientServices.clientId, clientId),
      eq(clientServices.planId, planId),
      inArray(clientServices.status, BLOCKING_STATUSES),
      ...(exclude ? [exclude] : []),
    ))
    .limit(1);

  if (sameClientPlan.length) {
    return { type: 'client_plan', serviceId: sameClientPlan[0].id };
  }

  const ip = ipAddress?.trim();
  if (ip) {
    const sameIp = await db.select({
      id: clientServices.id,
      clientName: users.fullName,
    })
      .from(clientServices)
      .innerJoin(clients, eq(clientServices.clientId, clients.id))
      .innerJoin(users, eq(clients.userId, users.id))
      .where(and(
        baseOrg,
        eq(clientServices.ipAddress, ip),
        inArray(clientServices.status, BLOCKING_STATUSES),
        ...(exclude ? [exclude] : []),
      ))
      .limit(1);

    if (sameIp.length) {
      return { type: 'ip', serviceId: sameIp[0].id, clientName: sameIp[0].clientName };
    }
  }

  return null;
}

servicesRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const { page, limit, offset, paginated } = parsePaginationQuery(req.query);

    const baseQuery = db.select({
      id: clientServices.id, status: clientServices.status,
      ipAddress: clientServices.ipAddress, macAddress: clientServices.macAddress,
      routerId: clientServices.routerId, siteId: clientServices.siteId,
      pppoeUsername: clientServices.pppoeUsername, pppoePassword: clientServices.pppoePassword,
      pppProfile: clientServices.pppProfile,
      queueName: clientServices.queueName, networkMeta: clientServices.networkMeta,
      installationDate: clientServices.installationDate,
      nextBillingDate: clientServices.nextBillingDate,
      billingCycleType: clientServices.billingCycleType,
      billingDay: clientServices.billingDay,
      billingDueDay: clientServices.billingDueDay,
      createdAt: clientServices.createdAt,
      client: { id: clients.id, fullName: users.fullName, email: users.email },
      plan: { id: plans.id, name: plans.name, downloadSpeed: plans.downloadSpeed, uploadSpeed: plans.uploadSpeed, price: plans.price },
    })
      .from(clientServices)
      .leftJoin(clients, eq(clientServices.clientId, clients.id))
      .leftJoin(users, eq(clients.userId, users.id))
      .leftJoin(plans, eq(clientServices.planId, plans.id))
      .where(orgFilter(clients, orgId));

    if (paginated) {
      const [{ total }] = await db.select({ total: sql`count(*)::int` })
        .from(clientServices)
        .innerJoin(clients, eq(clientServices.clientId, clients.id))
        .where(orgFilter(clients, orgId));
      const services = await baseQuery.limit(limit).offset(offset);
      return res.json({ items: services, pagination: paginationMeta(total, page, limit) });
    }

    const services = await baseQuery.limit(50);
    res.json(services);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar servicios' });
  }
});

servicesRouter.post('/', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const { clientId, planId, ipAddress, macAddress, routerId, siteId, provisionNetwork, provisionMode, status,
      installationDate, billingCycleType, billingDueDay, generateFirstInvoice } = req.body;

    const parsedClientId = parseInt(clientId, 10);
    const parsedPlanId = parseInt(planId, 10);
    if (!clientId || Number.isNaN(parsedClientId)) {
      return res.status(400).json({ error: 'Selecciona un abonado' });
    }
    if (!planId || Number.isNaN(parsedPlanId)) {
      return res.status(400).json({ error: 'Selecciona un plan comercial' });
    }

    if (!await getClientInOrg(parsedClientId, orgId)) {
      return res.status(404).json({ error: 'Cliente no encontrado en tu organización' });
    }
    if (!await getPlanInOrg(parsedPlanId, orgId)) {
      return res.status(404).json({ error: 'Plan no encontrado en tu organización' });
    }

    const conflict = await findServiceConflict(orgId, {
      clientId: parsedClientId,
      planId: parsedPlanId,
      ipAddress,
    });
    if (conflict?.type === 'client_plan') {
      return res.status(409).json({
        error: 'Este abonado ya tiene una suscripción activa con ese plan. Edita la existente o elimínala primero.',
        existingServiceId: conflict.serviceId,
      });
    }
    if (conflict?.type === 'ip') {
      return res.status(409).json({
        error: `La IP ${ipAddress.trim()} ya está asignada a ${conflict.clientName || 'otro abonado'}.`,
        existingServiceId: conflict.serviceId,
      });
    }

    const installDate = (installationDate && String(installationDate).split('T')[0])
      || new Date().toISOString().split('T')[0];
    const cycle = ['anniversary', 'calendar_prorate'].includes(billingCycleType)
      ? billingCycleType : 'anniversary';
    const billingDay = billingDayFromInstall(installDate);
    const dueDay = billingDueDay != null ? parseInt(billingDueDay, 10) : (cycle === 'calendar_prorate' ? 5 : billingDay);
    const nextBilling = computeNextBillingDate(installDate, cycle, billingDay);
    const parsedRouterId = routerId ? parseInt(routerId, 10) : null;
    const parsedSiteId = siteId ? parseInt(siteId, 10) : null;
    const [service] = await db.insert(clientServices).values({
      clientId: parsedClientId, planId: parsedPlanId,
      ipAddress: ipAddress || null, macAddress: macAddress || null,
      routerId: parsedRouterId && !Number.isNaN(parsedRouterId) ? parsedRouterId : null,
      siteId: parsedSiteId && !Number.isNaN(parsedSiteId) ? parsedSiteId : null,
      installationDate: installDate,
      nextBillingDate: nextBilling,
      billingCycleType: cycle,
      billingDay,
      billingDueDay: Number.isNaN(dueDay) ? 5 : dueDay,
      status: status && ['active', 'suspended', 'pending', 'cancelled', 'cut'].includes(status) ? status : 'active',
    }).returning();

    if (provisionNetwork && parsedRouterId && !Number.isNaN(parsedRouterId)) {
      try {
        const result = await dispatch(JobNames.PROVISION_NETWORK, {
          serviceId: service.id,
          orgId,
          routerId: parsedRouterId,
          provisionMode: provisionMode || 'both',
        });
        if (generateFirstInvoice) {
          try {
            const inv = await createInvoiceForService(orgId, service.id);
            return res.status(201).json({ ...result.service, network: result, firstInvoice: inv.invoice });
          } catch (invErr) {
            return res.status(201).json({
              ...result.service,
              network: result,
              invoiceWarning: invErr.message,
            });
          }
        }
        return res.status(201).json({ ...result.service, network: result });
      } catch (netErr) {
        return res.status(201).json({
          ...service,
          networkWarning: 'Servicio creado pero falló provisión en router: ' + netErr.message,
        });
      }
    }

    if (generateFirstInvoice) {
      try {
        const inv = await createInvoiceForService(orgId, service.id);
        return res.status(201).json({ ...service, firstInvoice: inv.invoice, billing: inv });
      } catch (invErr) {
        return res.status(201).json({ ...service, invoiceWarning: invErr.message });
      }
    }

    res.status(201).json(service);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear servicio: ' + error.message });
  }
});

servicesRouter.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const serviceId = parseInt(req.params.id);
    if (!await getServiceInOrg(serviceId, orgId)) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }
    const { status, pppProfile, ipAddress, macAddress } = req.body;
    const patch = { updatedAt: new Date() };
    if (status !== undefined) patch.status = status;
    if (pppProfile !== undefined) patch.pppProfile = pppProfile;
    if (ipAddress !== undefined) patch.ipAddress = ipAddress;
    if (macAddress !== undefined) patch.macAddress = macAddress;
    const [updated] = await db.update(clientServices)
      .set(patch)
      .where(eq(clientServices.id, serviceId))
      .returning();
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar servicio' });
  }
});

servicesRouter.put('/:id/suspend', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const serviceId = parseInt(req.params.id);
    if (!await getServiceInOrg(serviceId, orgId)) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }
    const [updated] = await db.update(clientServices)
      .set({ status: 'suspended', updatedAt: new Date() })
      .where(eq(clientServices.id, serviceId))
      .returning();

    let networkResult = null;
    try {
      networkResult = await dispatch(JobNames.SUSPEND_SERVICE, { serviceId, orgId });
    } catch (netErr) {
      networkResult = { error: netErr.message };
    }

    res.json({ message: 'Servicio suspendido', service: updated, network: networkResult });
  } catch (error) {
    res.status(500).json({ error: 'Error al suspender servicio' });
  }
});

servicesRouter.put('/:id/reactivate', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const serviceId = parseInt(req.params.id);
    if (!await getServiceInOrg(serviceId, orgId)) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }
    const [updated] = await db.update(clientServices)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(clientServices.id, serviceId))
      .returning();

    let networkResult = null;
    try {
      networkResult = await dispatch(JobNames.REACTIVATE_SERVICE, { serviceId, orgId });
    } catch (netErr) {
      networkResult = { error: netErr.message };
    }

    res.json({ message: 'Servicio reactivado', service: updated, network: networkResult });
  } catch (error) {
    res.status(500).json({ error: 'Error al reactivar servicio' });
  }
});

servicesRouter.post('/:id/provision', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const serviceId = parseInt(req.params.id);
    const { routerId, provisionMode, pppProfile } = req.body;
    if (!routerId) return res.status(400).json({ error: 'routerId requerido' });
    if (!await getServiceInOrg(serviceId, orgId)) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }
    if (pppProfile) {
      await db.update(clientServices).set({ pppProfile, updatedAt: new Date() }).where(eq(clientServices.id, serviceId));
    }
    const result = await dispatch(JobNames.PROVISION_NETWORK, {
      serviceId,
      orgId,
      routerId: parseInt(routerId, 10),
      provisionMode: provisionMode || 'both',
      pppProfile,
    });
    res.json({ message: 'Red provisionada', ...result });
  } catch (error) {
    res.status(503).json({ error: 'Error al provisionar: ' + error.message });
  }
});

servicesRouter.post('/:id/sync-queue', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const serviceId = parseInt(req.params.id, 10);
    if (!await getServiceInOrg(serviceId, orgId)) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }
    const result = await dispatch(JobNames.SYNC_QUEUE_METADATA, { serviceId, orgId });
    if (result.skipped) {
      return res.json({ message: result.reason, skipped: true });
    }
    res.json({ message: 'Cola actualizada en MikroTik', ...result });
  } catch (error) {
    res.status(503).json({ error: 'Error al sincronizar cola: ' + error.message });
  }
});

servicesRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const serviceId = parseInt(req.params.id, 10);
    if (Number.isNaN(serviceId)) {
      return res.status(400).json({ error: 'ID de servicio inválido' });
    }
    if (!await getServiceInOrg(serviceId, orgId)) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }
    await db.delete(clientServices).where(eq(clientServices.id, serviceId));
    res.json({ message: 'Suscripción eliminada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar servicio: ' + error.message });
  }
});
