import { Router } from 'express';
import { db } from '../db/index.js';
import { invoices, clients, users, clientServices } from '../db/schema.js';
import { eq, and, lte, or, isNull, sql } from 'drizzle-orm';
import { parsePaginationQuery, paginationMeta } from '../lib/pagination.js';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId, getInvoiceInOrg, getServiceInOrg } from '../lib/tenant.js';
import { createInvoiceForService, previewInvoiceForService } from '../lib/invoiceService.js';

export const invoicesRouter = Router();

invoicesRouter.get('/', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const { page, limit, offset, paginated } = parsePaginationQuery(req.query);

    const baseSelect = {
      id: invoices.id,
      clientId: invoices.clientId,
      invoiceNumber: invoices.invoiceNumber,
      amount: invoices.amount,
      tax: invoices.tax,
      total: invoices.total,
      status: invoices.status,
      dueDate: invoices.dueDate,
      billingPeriod: invoices.billingPeriod,
      paidDate: invoices.paidDate,
      createdAt: invoices.createdAt,
      clientServiceId: invoices.clientServiceId,
      client: { fullName: users.fullName, email: users.email },
    };

    if (paginated) {
      const [{ total }] = await db.select({ total: sql`count(*)::int` })
        .from(invoices)
        .where(orgFilter(invoices, orgId));
      const rows = await db.select(baseSelect)
        .from(invoices)
        .leftJoin(clients, eq(invoices.clientId, clients.id))
        .leftJoin(users, eq(clients.userId, users.id))
        .where(orgFilter(invoices, orgId))
        .orderBy(invoices.createdAt)
        .limit(limit)
        .offset(offset);
      return res.json({ items: rows, pagination: paginationMeta(total, page, limit) });
    }

    const allInvoices = await db.select(baseSelect)
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

invoicesRouter.get('/preview/:serviceId', requireRole('admin', 'office', 'technician'), async (req, res) => {
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
    const force = Boolean(req.body?.force);

    const dueFilter = force
      ? and(eq(clientServices.status, 'active'), orgFilter(clients, orgId))
      : and(
        eq(clientServices.status, 'active'),
        orgFilter(clients, orgId),
        or(isNull(clientServices.nextBillingDate), lte(clientServices.nextBillingDate, today)),
      );

    const activeServices = await db.select({ id: clientServices.id })
      .from(clientServices)
      .leftJoin(clients, eq(clientServices.clientId, clients.id))
      .where(dueFilter);

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
    const hint = !force && generated.length === 0 && activeServices.length === 0
      ? ' Ningún servicio activo tiene cobro vencido hoy. Usa «Forzar» o genera desde el perfil del abonado.'
      : '';
    res.json({
      message: `${generated.length} facturas generadas${skipped.length ? `, ${skipped.length} omitidas` : ''}${hint}`,
      count: generated.length,
      invoices: generated,
      skipped,
      force,
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
    if (status === 'cancelled') {
      return res.status(400).json({ error: 'Usa POST /api/invoices/:id/void para anular con motivo' });
    }
    const [updated] = await db.update(invoices)
      .set({ status, paidDate: status === 'paid' ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(invoices.id, invoiceId), orgFilter(invoices, orgId)))
      .returning();
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar factura' });
  }
});

invoicesRouter.post('/:id/void', requireRole('admin', 'office'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const invoiceId = parseInt(req.params.id, 10);
    const { voidInvoice } = await import('../lib/invoiceAdjustments.js');
    const { writeAuditLog, clientIp } = await import('../lib/auditLog.js');
    const result = await voidInvoice({
      orgId,
      invoiceId,
      reason: req.body.reason,
      userId: req.user.id,
    });
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'invoice.void',
      entity: 'invoice',
      entityId: invoiceId,
      details: { reason: req.body.reason },
      ipAddress: clientIp(req),
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

invoicesRouter.post('/:id/adjust', requireRole('admin', 'office'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const invoiceId = parseInt(req.params.id, 10);
    const { adjustInvoice } = await import('../lib/invoiceAdjustments.js');
    const { writeAuditLog, clientIp } = await import('../lib/auditLog.js');
    const result = await adjustInvoice({
      orgId,
      invoiceId,
      amountDelta: req.body.amountDelta,
      reason: req.body.reason,
      userId: req.user.id,
    });
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'invoice.adjust',
      entity: 'invoice',
      entityId: invoiceId,
      details: {
        amountDelta: req.body.amountDelta,
        reason: req.body.reason,
        newTotal: result.invoice?.total,
      },
      ipAddress: clientIp(req),
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

invoicesRouter.get('/:id/pdf', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const invoiceId = parseInt(req.params.id, 10);
    const [inv] = await db.select().from(invoices)
      .where(and(eq(invoices.id, invoiceId), orgFilter(invoices, orgId)))
      .limit(1);
    if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });

    const [row] = await db.select({
      fullName: users.fullName,
      email: users.email,
      rut: clients.rut,
      address: clients.address,
    }).from(clients)
      .leftJoin(users, eq(clients.userId, users.id))
      .where(and(eq(clients.id, inv.clientId), orgFilter(clients, orgId)))
      .limit(1);

    const { sumPaymentsForInvoice } = await import('../lib/paymentService.js');
    const { buildInvoicePdfBuffer } = await import('../lib/invoicePdf.js');
    const { organizations } = await import('../db/schema.js');
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const paidSum = await sumPaymentsForInvoice(invoiceId);
    const balance = Math.max(0, Number(inv.total) - paidSum);
    const buf = await buildInvoicePdfBuffer({
      invoice: inv,
      client: row || {},
      org,
      paidSum,
      balance,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${inv.invoiceNumber || `factura-${invoiceId}`}.pdf"`);
    res.send(buf);
  } catch (error) {
    console.error('Invoice PDF error:', error.message);
    res.status(500).json({ error: error.message || 'Error al generar PDF' });
  }
});
