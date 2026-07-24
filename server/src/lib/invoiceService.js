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

const MANUAL_CONCEPT_LABELS = {
  plan: 'Mensualidad plan',
  installation: 'Instalación',
  tv: 'Servicio TV',
  cameras: 'Cámaras / seguridad',
  other: 'Cargo adicional',
};

/**
 * Boleta/factura manual (plan, instalación, TV, cámaras u otro).
 * totalIngresado = precio con IVA incluido (estilo Chile).
 */
export async function createManualInvoice(orgId, {
  clientId,
  clientServiceId = null,
  concept = 'other',
  description,
  totalIngresado,
  dueDate,
  notes,
}) {
  const totalBruto = Math.round(Number(totalIngresado));
  if (!Number.isFinite(totalBruto) || totalBruto <= 0) {
    throw new Error('Monto inválido');
  }

  const conceptKey = MANUAL_CONCEPT_LABELS[concept] ? concept : 'other';
  const label = (description && String(description).trim())
    || MANUAL_CONCEPT_LABELS[conceptKey];

  let service = null;
  if (clientServiceId) {
    const row = await loadServiceBundle(clientServiceId, orgId);
    if (!row || row.service.clientId !== clientId) {
      throw new Error('Servicio no pertenece al abonado');
    }
    service = row.service;
  }

  const amounts = buildInvoiceAmounts(totalBruto, service || {});
  const today = new Date();
  const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const billingPeriod = `manual-${ym}-${conceptKey}`;
  const due = dueDate || (() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 5);
    return d.toISOString().slice(0, 10);
  })();

  const stamp = Date.now().toString(36).slice(-6).toUpperCase();
  const invNumber = `M-${ym.replace('-', '')}-C${clientId}-${stamp}`;
  const noteParts = [label, `Concepto: ${MANUAL_CONCEPT_LABELS[conceptKey]}`];
  if (notes) noteParts.push(String(notes).trim());

  const [inv] = await db.insert(invoices).values({
    organizationId: orgId,
    invoiceNumber: invNumber,
    clientId,
    clientServiceId: clientServiceId || null,
    amount: String(amounts.amount),
    tax: String(amounts.tax),
    total: String(amounts.total),
    status: 'pending',
    dueDate: due,
    billingPeriod,
    notes: noteParts.join(' · '),
  }).returning();

  return {
    invoice: inv,
    amount: amounts.amount,
    tax: amounts.tax,
    total: amounts.total,
    concept: conceptKey,
    label,
  };
}
