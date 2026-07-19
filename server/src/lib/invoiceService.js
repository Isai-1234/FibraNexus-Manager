import { db } from '../db/index.js';
import { invoices, clientServices } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import {
  computeNextBillingDate,
  billingCycleDescription,
  billingPrice,
} from './billing.js';
import {
  loadServiceBundle,
  getPeriodWindow,
  maybeProrateFirst,
  buildInvoiceAmounts,
  invoiceLabel,
  periodStartDay,
  calcularProximasFacturas,
} from './serviceBilling.js';
import { sql } from 'drizzle-orm';

export { calcularProximasFacturas };

export async function createInvoiceForService(orgId, serviceId, options = {}) {
  const row = await loadServiceBundle(serviceId, orgId);
  if (!row) throw new Error('Servicio no encontrado');

  const service = row.service;
  if (service.status !== 'active') throw new Error('El servicio no está activo');

  const asOf = options.asOf ? new Date(options.asOf) : new Date();
  const price = billingPrice(service, row.plan);

  const [{ count }] = await db.select({
    count: sql`count(*)::int`,
  }).from(invoices).where(eq(invoices.clientServiceId, service.id));
  const hasPrior = Number(count) > 0;

  let window = getPeriodWindow(service, 0, asOf);
  const priced = maybeProrateFirst(service, window, hasPrior, price);

  let installFee = 0;
  if (!hasPrior && service.costoInstalacion != null && service.costoInstalacion !== '') {
    installFee = Math.round(Number(service.costoInstalacion) || 0);
  }
  // Precio e instalación con IVA incluido → se desglosa, no se suma IVA encima
  const amounts = buildInvoiceAmounts((priced.neto || 0) + installFee, service);
  const amount = amounts.amount;
  const tax = amounts.tax;
  const total = amounts.total;

  const dueDate = options.dueDate || (() => {
    const dueDay = service.billingDueDay ?? periodStartDay(service);
    const end = new Date(priced.periodEnd || window.periodEnd);
    let due = new Date(end.getFullYear(), end.getMonth(), Math.min(dueDay, 28));
    if (due < end) due = new Date(end.getFullYear(), end.getMonth() + 1, Math.min(dueDay, 28));
    return due.toISOString().slice(0, 10);
  })();

  const billingPeriod = priced.billingPeriod || window.billingPeriod;
  const exists = await db.query.invoices.findFirst({
    where: and(
      eq(invoices.billingPeriod, billingPeriod),
      eq(invoices.clientServiceId, service.id),
    ),
  });
  if (exists) {
    return { skipped: true, reason: 'Ya existe factura para este período', invoice: exists, window: priced };
  }

  const label = invoiceLabel(service, row.plan);
  const noteParts = [label];
  if (priced.isProrated) noteParts.push(`Prorrateo ${priced.days}/${priced.totalDays} días`);
  if (installFee > 0) noteParts.push(`Instalación $${installFee}`);

  const invNumber = `F-${billingPeriod}-C${service.clientId}-S${service.id}`;
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
    billingPeriod,
    notes: noteParts.join(' · '),
  }).returning();

  const nextBillingDate = computeNextBillingDate(
    service.installationDate,
    service.billingCycleType || 'anniversary',
    periodStartDay(service),
    asOf,
  );

  await db.update(clientServices).set({
    nextBillingDate,
    updatedAt: new Date(),
  }).where(eq(clientServices.id, service.id));

  return {
    invoice: inv,
    window: priced,
    days: priced.days || null,
    totalDays: priced.totalDays || null,
    amount,
    tax,
    total,
    dueDate,
    cycleDescription: billingCycleDescription(service),
    etiqueta: label,
  };
}

export async function previewInvoiceForService(orgId, serviceId) {
  const preview = await calcularProximasFacturas(orgId, serviceId, 1);
  const first = preview.items[0];
  return {
    ...preview,
    amount: first?.neto,
    tax: first?.impuesto,
    total: first?.monto,
    dueDate: first?.fechaVencimiento,
    planPrice: preview.precioBase,
    billingPrice: preview.precioBase,
  };
}
