/**
 * Facturación de servicios estilo UISP: preview de próximas facturas
 * + helpers de descuento/impuesto/etiqueta usados por invoiceService.
 */
import { db } from '../db/index.js';
import { clientServices, clients, plans, invoices } from '../db/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import { orgFilter } from './tenant.js';
import {
  billingPrice,
  daysInMonth,
  formatDateISO,
  parseDateInput,
} from './billing.js';

const DEFAULT_TAX_RATE = 0.19;

export function periodStartDay(service) {
  const d = service.diaComienzoPeriodo ?? service.billingDay;
  if (d != null && d >= 1 && d <= 31) return d;
  const install = parseDateInput(service.installationDate);
  return install ? install.getDate() : 1;
}

export function taxRate(service) {
  if (service.impuestoOverride != null && service.impuestoOverride !== '') {
    const n = Number(service.impuestoOverride);
    if (Number.isFinite(n) && n >= 0) return n > 1 ? n / 100 : n;
  }
  return DEFAULT_TAX_RATE;
}

export function invoiceLabel(service, plan) {
  const tag = service.etiquetaFactura != null ? String(service.etiquetaFactura).trim() : '';
  if (tag) return tag;
  return plan?.name || 'Servicio internet';
}

/** Aplica descuento sobre neto (antes de IVA). */
export function applyDiscount(neto, service) {
  const base = Math.max(0, Number(neto) || 0);
  const tipo = service.tipoDescuento || 'sin_descuento';
  const valor = Number(service.valorDescuento);
  if (tipo === 'porcentaje' && Number.isFinite(valor) && valor > 0) {
    const pct = Math.min(100, valor);
    return Math.round(base * (1 - pct / 100));
  }
  if (tipo === 'monto_fijo' && Number.isFinite(valor) && valor > 0) {
    return Math.max(0, Math.round(base - valor));
  }
  return Math.round(base);
}

export function buildInvoiceAmounts(netoBase, service) {
  const neto = applyDiscount(netoBase, service);
  const rate = taxRate(service);
  const tax = Math.round(neto * rate);
  return { amount: neto, tax, total: neto + tax, taxRate: rate };
}

function clampDay(year, monthIndex, day) {
  const max = daysInMonth(year, monthIndex);
  return Math.min(Math.max(1, day), max);
}

function dateWithDay(year, monthIndex, day) {
  return new Date(year, monthIndex, clampDay(year, monthIndex, day));
}

/**
 * Ventana de periodo i (0 = próximo/actual según tipo_facturacion).
 * Retroactiva: cobra el periodo que termina en el próximo día de ciclo.
 * Anticipada: cobra el periodo que empieza en el próximo día de ciclo.
 */
export function getPeriodWindow(service, periodIndex = 0, asOf = new Date()) {
  const day = periodStartDay(service);
  const install = parseDateInput(service.installationDate) || asOf;
  const tipo = service.tipoFacturacion || 'retroactiva';

  // Próximo día de ciclo >= asOf (o el siguiente si hoy ya pasó)
  let anchor = dateWithDay(asOf.getFullYear(), asOf.getMonth(), day);
  if (anchor < asOf) {
    anchor = dateWithDay(asOf.getFullYear(), asOf.getMonth() + 1, day);
  }
  // Avanzar periodIndex meses
  const cycleEnd = dateWithDay(anchor.getFullYear(), anchor.getMonth() + periodIndex, day);
  const cycleStart = dateWithDay(cycleEnd.getFullYear(), cycleEnd.getMonth() - 1, day);

  let periodStart = cycleStart;
  let periodEnd = new Date(cycleEnd);
  periodEnd.setDate(periodEnd.getDate() - 1); // inclusive end day before next cycle day
  // Simpler UISP-like: period is [startDay month N, startDay month N+1)
  periodStart = cycleStart;
  periodEnd = new Date(cycleEnd.getFullYear(), cycleEnd.getMonth(), cycleEnd.getDate());
  periodEnd.setDate(periodEnd.getDate() - 1);

  if (tipo === 'anticipada') {
    // Periodo futuro: desde cycleEnd (día comienzo) un mes adelante
    periodStart = cycleEnd;
    const next = dateWithDay(cycleEnd.getFullYear(), cycleEnd.getMonth() + 1, day);
    periodEnd = new Date(next);
    periodEnd.setDate(periodEnd.getDate() - 1);
  }

  if (periodStart < install) periodStart = install;

  const ym = `${periodEnd.getFullYear()}-${String(periodEnd.getMonth() + 1).padStart(2, '0')}`;
  return {
    periodStart: formatDateISO(periodStart),
    periodEnd: formatDateISO(periodEnd),
    cycleDay: formatDateISO(tipo === 'anticipada' ? periodStart : cycleEnd),
    isProrated: false,
    billingPeriod: `${ym}-d${day}-p${periodIndex}`,
    label: `${formatDateISO(periodStart)} → ${formatDateISO(periodEnd)}`,
  };
}

/**
 * Primera factura puede prorratearse si prorratearPrimeraFactura y aún no hay facturas.
 */
export function maybeProrateFirst(service, window, hasPriorInvoices, fullPrice) {
  if (!service.prorratearPrimeraFactura || hasPriorInvoices) {
    return { ...window, isProrated: false, neto: Math.round(fullPrice) };
  }
  const start = parseDateInput(window.periodStart);
  const end = parseDateInput(window.periodEnd);
  if (!start || !end) return { ...window, isProrated: false, neto: Math.round(fullPrice) };
  const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const totalDays = daysInMonth(start.getFullYear(), start.getMonth());
  if (days >= totalDays) {
    return { ...window, isProrated: false, neto: Math.round(fullPrice), days, totalDays };
  }
  const neto = Math.round(fullPrice * days / totalDays);
  return {
    ...window,
    isProrated: true,
    billingPeriod: `${window.billingPeriod}-pro`,
    label: `Proporcional ${window.periodStart} → ${window.periodEnd}`,
    neto,
    days,
    totalDays,
  };
}

function creationDateForPeriod(service, window, asOf) {
  const daysBefore = Number(service.crearFacturaDiasAntes) || 0;
  // Retroactiva: se crea cerca del fin del periodo; anticipada: al inicio
  const tipo = service.tipoFacturacion || 'retroactiva';
  const base = parseDateInput(tipo === 'anticipada' ? window.periodStart : window.periodEnd) || asOf;
  const created = new Date(base);
  created.setDate(created.getDate() - daysBefore);
  return formatDateISO(created);
}

function dueDateForPeriod(service, window) {
  const dueDay = service.billingDueDay ?? periodStartDay(service);
  const end = parseDateInput(window.periodEnd) || new Date();
  // Vence el día dueDay del mes del fin de periodo (o siguiente si ya pasó)
  let due = dateWithDay(end.getFullYear(), end.getMonth(), dueDay);
  if (due < end) {
    due = dateWithDay(end.getFullYear(), end.getMonth() + 1, dueDay);
  }
  return formatDateISO(due);
}

async function loadServiceBundle(serviceId, orgId) {
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

/**
 * Vista previa UISP: N próximas facturas (periodo, creación, vencimiento, monto).
 */
export async function calcularProximasFacturas(orgId, serviceId, cantidad = 3) {
  const row = await loadServiceBundle(serviceId, orgId);
  if (!row) throw new Error('Servicio no encontrado');

  const n = Math.min(12, Math.max(1, Number(cantidad) || 3));
  const service = row.service;
  const plan = row.plan;
  const price = billingPrice(service, plan);
  const asOf = new Date();

  const [{ count }] = await db.select({
    count: sql`count(*)::int`,
  }).from(invoices).where(eq(invoices.clientServiceId, service.id));
  const hasPrior = Number(count) > 0;

  const items = [];
  for (let i = 0; i < n; i++) {
    let window = getPeriodWindow(service, i, asOf);
    const priced = i === 0
      ? maybeProrateFirst(service, window, hasPrior, price)
      : { ...window, neto: Math.round(price) };
    const amounts = buildInvoiceAmounts(priced.neto, service);
    // Cargo instalación solo en la primera si aplica y no hay facturas previas
    let installFee = 0;
    if (i === 0 && !hasPrior && service.costoInstalacion != null && service.costoInstalacion !== '') {
      installFee = Math.round(Number(service.costoInstalacion) || 0);
    }
    const amount = amounts.amount + installFee;
    const tax = Math.round(amount * taxRate(service));
    const total = amount + tax;

    items.push({
      index: i,
      periodo: priced.label || window.label,
      periodStart: priced.periodStart || window.periodStart,
      periodEnd: priced.periodEnd || window.periodEnd,
      billingPeriod: priced.billingPeriod || window.billingPeriod,
      isProrated: Boolean(priced.isProrated),
      fechaCreacion: creationDateForPeriod(service, window, asOf),
      fechaVencimiento: dueDateForPeriod(service, window),
      neto: amount,
      impuesto: tax,
      monto: total,
      etiqueta: invoiceLabel(service, plan),
      installFee: installFee || undefined,
    });
  }

  return {
    serviceId: service.id,
    planName: plan.name,
    precioBase: price,
    items,
  };
}

export { loadServiceBundle };
