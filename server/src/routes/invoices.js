import { Router } from 'express';
import { db } from '../db/index.js';
import { invoices, clients, users, clientServices } from '../db/schema.js';
import { eq, and, lte, or, isNull } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId, getInvoiceInOrg, getServiceInOrg } from '../lib/tenant.js';
import { createInvoiceForService, previewInvoiceForService } from '../lib/invoiceService.js';

export const invoicesRouter = Router();

invoicesRouter.get('/', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const allInvoices = await db.select({
      id: invoices.id, invoiceNumber: invoices.invoiceNumber, amount: invoices.amount,
      tax: invoices.tax, total: invoices.total, status: invoices.status,
      dueDate: invoices.dueDate, billingPeriod: invoices.billingPeriod,
      paidDate: invoices.paidDate, createdAt: invoices.createdAt,
      clientServiceId: invoices.clientServiceId,
      client: { fullName: users.fullName, email: users.email },
    })
      .from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .leftJoin(users, eq(clients.userId, users.id))
      .where(orgFilter(invoices, orgId))
      .orderBy(invoices.createdAt)
      .limit(50);
    res.json(allInvoices);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar facturas' });
  }
});

invoicesRouter.post('/service/:serviceId', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const serviceId = parseInt(req.params.serviceId, 10);
    if (!await getServiceInOrg(serviceId, orgId)) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }
    const result = await createInvoiceForService(orgId, serviceId, req.body);
    if (result.skipped) {
      return res.status(409).json({ error: result.reason, invoice: result.invoice });
    }
    res.status(201).json({
      message: result.window.isProrated
        ? `Factura proporcional (${result.days}/${result.totalDays} días)`
        : 'Factura generada',
      ...result,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

invoicesRouter.get('/preview/:serviceId', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const serviceId = parseInt(req.params.serviceId, 10);
    res.json(await previewInvoiceForService(orgId, serviceId));
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

invoicesRouter.post('/generate', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const today = new Date().toISOString().split('T')[0];

    const activeServices = await db.select({ id: clientServices.id })
      .from(clientServices)
      .leftJoin(clients, eq(clientServices.clientId, clients.id))
      .where(and(
        eq(clientServices.status, 'active'),
        orgFilter(clients, orgId),
        or(isNull(clientServices.nextBillingDate), lte(clientServices.nextBillingDate, today)),
      ));

    const generated = [];
    const skipped = [];
    for (const svc of activeServices) {
      try {
        const result = await createInvoiceForService(orgId, svc.id, req.body);
        if (result.skipped) skipped.push({ serviceId: svc.id, reason: result.reason });
        else generated.push(result.invoice);
      } catch (err) {
        skipped.push({ serviceId: svc.id, reason: err.message });
      }
    }
    res.json({
      message: `${generated.length} facturas generadas${skipped.length ? `, ${skipped.length} omitidas` : ''}`,
      count: generated.length,
      invoices: generated,
      skipped,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

invoicesRouter.put('/:id/status', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const invoiceId = parseInt(req.params.id);
    if (!await getInvoiceInOrg(invoiceId, orgId)) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }
    const { status } = req.body;
    const [updated] = await db.update(invoices)
      .set({ status, paidDate: status === 'paid' ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(invoices.id, invoiceId), orgFilter(invoices, orgId)))
      .returning();
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar factura' });
  }
});
