import { db } from '../db/index.js';
import { invoices, clients, clientServices, plans } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { orgFilter } from './tenant.js';
import {
  getBillingWindow,
  computeDueDate,
  computeInvoiceAmount,
  computeNextBillingDate,
  billingCycleDescription,
} from './billing.js';

async function loadServiceWithPlan(serviceId, orgId) {
  const rows = await db.select({
    service: clientServices,
    plan: plans,
    clientId: clients.id,
  })
    .from(clientServices)
    .innerJoin(clients, eq(clientServices.clientId, clients.id))
    .innerJoin(plans, eq(clientServices.planId, plans.id))
    .where(and(eq(clientServices.id, serviceId), orgFilter(clients, orgId)))
    .limit(1);
  return rows[0] || null;
}

export async function createInvoiceForService(orgId, serviceId, options = {}) {
  const row = await loadServiceWithPlan(serviceId, orgId);
  if (!row) throw new Error('Servicio no encontrado');

  const service = row.service;
  if (service.status !== 'active') throw new Error('El servicio no está activo');

  const asOf = options.asOf ? new Date(options.asOf) : new Date();
  const window = getBillingWindow(service, asOf);
  const { amount, days, totalDays } = computeInvoiceAmount(row.plan.price, window);
  const tax = Math.round(amount * 0.19);
  const total = amount + tax;
  const dueDate = options.dueDate || computeDueDate(service, window);

  const exists = await db.query.invoices.findFirst({
    where: and(
      eq(invoices.billingPeriod, window.billingPeriod),
      eq(invoices.clientServiceId, service.id),
    ),
  });
  if (exists) {
    return { skipped: true, reason: 'Ya existe factura para este período', invoice: exists, window };
  }

  const invNumber = `F-${window.billingPeriod}-C${service.clientId}-S${service.id}`;
  const [inv] = await db.insert(invoices).values({
    organizationId: orgId,
    invoiceNumber: invNumber,
    clientId: service.clientId,
    clientServiceId: service.id,
    amount: String(amount),
    tax: String(tax),
    total: String(total),
    status: 'pending',
    dueDate,
    billingPeriod: window.billingPeriod,
  }).returning();

  const nextBillingDate = computeNextBillingDate(
    service.installationDate,
    service.billingCycleType || 'anniversary',
    service.billingDay,
    asOf,
  );

  await db.update(clientServices).set({
    nextBillingDate,
    updatedAt: new Date(),
  }).where(eq(clientServices.id, service.id));

  return {
    invoice: inv,
    window,
    days,
    totalDays,
    amount,
    tax,
    total,
    dueDate,
    cycleDescription: billingCycleDescription(service),
  };
}

export async function previewInvoiceForService(orgId, serviceId) {
  const row = await loadServiceWithPlan(serviceId, orgId);
  if (!row) throw new Error('Servicio no encontrado');

  const window = getBillingWindow(row.service);
  const { amount, days, totalDays } = computeInvoiceAmount(row.plan.price, window);
  const tax = Math.round(amount * 0.19);
  return {
    window,
    amount,
    tax,
    total: amount + tax,
    dueDate: computeDueDate(row.service, window),
    cycleDescription: billingCycleDescription(row.service),
    planPrice: Number(row.plan.price),
    days,
    totalDays,
  };
}
