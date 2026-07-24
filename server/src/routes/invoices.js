import { Router } from 'express';
import { db } from '../db/index.js';
import { invoices, clients, users, clientServices } from '../db/schema.js';
import { eq, and, lte, or, isNull, sql } from 'drizzle-orm';
import { parsePaginationQuery, paginationMeta } from '../lib/pagination.js';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId, getInvoiceInOrg, getServiceInOrg, getClientInOrg } from '../lib/tenant.js';
import { createInvoiceForService, previewInvoiceForService, createManualInvoice } from '../lib/invoiceService.js';
import { parseBody, manualInvoiceSchema } from '../lib/validators.js';
import { registerPayment, attachInvoiceBalances } from '../lib/paymentService.js';
import { writeAuditLog, clientIp } from '../lib/auditLog.js';

export const invoicesRouter = Router();

invoicesRouter.get('/', requireRole('admin', 'office', 'technician'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const { page, limit, offset, paginated } = parsePaginationQuery(req.query);
    const clientId = req.query.clientId != null ? parseInt(String(req.query.clientId), 10) : null;

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

    const conditions = [orgFilter(invoices, orgId)];
    if (Number.isFinite(clientId) && clientId > 0) {
      conditions.push(eq(invoices.clientId, clientId));
    }
    const whereClause = and(...conditions);

    if (paginated) {
      const [{ total }] = await db.select({ total: sql`count(*)::int` })
        .from(invoices)
        .where(whereClause);
      const rows = await db.select(baseSelect)
        .from(invoices)
        .leftJoin(clients, eq(invoices.clientId, clients.id))
        .leftJoin(users, eq(clients.userId, users.id))
        .where(whereClause)
        .orderBy(invoices.createdAt)
        .limit(limit)
        .offset(offset);
      const items = await attachInvoiceBalances(rows);
      return res.json({ items, pagination: paginationMeta(total, page, limit) });
    }

    // Con clientId: todas las boletas del abonado. Sin filtro: hasta 500 (antes 50 cortaba el perfil).
    const allInvoices = await db.select(baseSelect)
      .from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .leftJoin(users, eq(clients.userId, users.id))
      .where(whereClause)
      .orderBy(sql`${invoices.createdAt} DESC`)
      .limit(Number.isFinite(clientId) && clientId > 0 ? 1000 : 500);
    res.json(await attachInvoiceBalances(allInvoices));
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

/** Boleta manual: plan, instalación, TV, cámaras u otro cargo. */
invoicesRouter.post('/manual', requireRole('admin', 'office'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const parsed = parseBody(manualInvoiceSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const data = parsed.data;

    if (!await getClientInOrg(data.clientId, orgId)) {
      return res.status(404).json({ error: 'Abonado no encontrado' });
    }
    if (data.clientServiceId && !await getServiceInOrg(data.clientServiceId, orgId)) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    const created = await createManualInvoice(orgId, {
      clientId: data.clientId,
      clientServiceId: data.clientServiceId || null,
      concept: data.concept,
      description: data.description,
      totalIngresado: data.total,
      dueDate: data.dueDate,
      notes: data.notes,
    });

    await writeAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'invoice.manual_create',
      entity: 'invoice',
      entityId: created.invoice.id,
      details: {
        clientId: data.clientId,
        concept: created.concept,
        total: created.total,
        payNow: Boolean(data.payNow),
      },
      ipAddress: clientIp(req),
    });

    let payment = null;
    let reactivation = null;
    if (data.payNow) {
      const payResult = await registerPayment({
        orgId,
        invoiceId: created.invoice.id,
        amount: created.total,
        method: data.payMethod || 'cash',
        notes: data.payNotes || 'Pago al emitir boleta manual',
        reference: data.payMethod === 'cash' ? 'efectivo' : (data.payMethod || 'manual'),
      });
      if (payResult.error) {
        return res.status(201).json({
          message: 'Boleta creada, pero el pago falló: ' + payResult.error,
          ...created,
          paymentError: payResult.error,
        });
      }
      payment = payResult;
      if (payResult.fullyPaid) {
        try {
          const { tryAutoReactivateAfterPayment } = await import('../lib/subscriberSuspend.js');
          reactivation = await tryAutoReactivateAfterPayment(created.invoice, orgId);
        } catch (e) {
          reactivation = { error: e.message };
        }
      }
    }

    res.status(201).json({
      message: data.payNow
        ? (reactivation?.reactivated || reactivation?.lifecycleStatus === 'active'
          ? 'Boleta creada, pagada y servicio activado'
          : 'Boleta creada y pagada')
        : 'Boleta manual creada',
      ...created,
      payment,
      reactivation,
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Error al crear boleta manual' });
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
