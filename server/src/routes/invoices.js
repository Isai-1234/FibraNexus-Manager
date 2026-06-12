import { Router } from 'express';
import { db } from '../db/index.js';
import { invoices, clients, users, clientServices, plans, payments } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { orgFilter, requireOrganizationId, getClientInOrg, getInvoiceInOrg } from '../lib/tenant.js';

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
      client: { fullName: users.fullName, email: users.email }
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

// POST /generate - Generar facturas del mes
invoicesRouter.post('/generate', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const { billingPeriod, dueDate } = req.body;
    const activeServices = await db.select({
      id: clientServices.id, clientId: clientServices.clientId,
      planId: clientServices.planId,
    })
    .from(clientServices)
    .leftJoin(clients, eq(clientServices.clientId, clients.id))
    .leftJoin(plans, eq(clientServices.planId, plans.id))
    .where(and(eq(clientServices.status, 'active'), orgFilter(clients, orgId)));

    const generated = [];
    for (const svc of activeServices) {
      const plan = await db.query.plans.findFirst({ where: eq(plans.id, svc.planId) });
      if (!plan) continue;
      
      const amount = Number(plan.price);
      const tax = Math.round(amount * 0.19);
      const total = amount + tax;
      const invNumber = 'F-' + billingPeriod + '-' + svc.clientId + '-' + svc.id;

      const exists = await db.query.invoices.findFirst({
        where: and(eq(invoices.billingPeriod, billingPeriod), eq(invoices.clientServiceId, svc.id))
      });
      if (exists) continue;

      const [inv] = await db.insert(invoices).values({
        organizationId: orgId,
        invoiceNumber: invNumber, clientId: svc.clientId, clientServiceId: svc.id,
        amount: String(amount), tax: String(tax), total: String(total),
        status: 'pending', dueDate: dueDate || new Date().toISOString().split('T')[0],
        billingPeriod
      }).returning();
      generated.push(inv);
    }
    res.json({ message: `${generated.length} facturas generadas`, count: generated.length, invoices: generated });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// PUT /:id/status - Actualizar estado
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
