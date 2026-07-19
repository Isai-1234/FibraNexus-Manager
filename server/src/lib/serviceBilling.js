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

/** Aplica descuento sobre el precio de lista (con IVA incluido). */
export function applyDiscount(precioConIva, service) {
  const base = Math.max(0, Number(precioConIva) || 0);
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

/**
 * Precio del servicio/plan en Chile = con IVA incluido.
 * Parte el bruto en neto + IVA sin sumar IVA encima.
 */
export function buildInvoiceAmounts(precioConIva, service) {
  const bruto = applyDiscount(precioConIva, service);
  const rate = taxRate(service);
  if (!rate) {
    return { amount: bruto, tax: 0, total: bruto, taxRate: 0 };
  }
  const amount = Math.round(bruto / (1 + rate));
  const tax = bruto - amount;
  return { amount, tax, total: bruto, taxRate: rate };
}

function clampDay(year, monthIndex, day) {
  const max = daysInMonth(year, monthIndex);
  return Math.min(Math.max(1, day), max);
}

function dateWithDay(year, monthIndex, day) {
  return new Date(year, monthIndex, clampDay(year, monthIndex, day));
}

/**
 * Ventana de periodo i (0 = primero según tipo_facturacion / facturarDesde).
 * Retroactiva: cobra el periodo que termina en el día de ciclo.
 * Anticipada: cobra el periodo que empieza en el día de ciclo.
 * facturarDesde: permite anclar el primer periodo a un mes concreto (ej. julio).
 */
export function getPeriodWindow(service, periodIndex = 0, asOf = new Date()) {
  const day = periodStartDay(service);
  const install = parseDateInput(service.installationDate) || asOf;
  const tipo = service.tipoFacturacion || 'retroactiva';
  const facturarDesde = parseDateInput(service.facturarDesde);

  // Ancla del periodo 0: mes de facturarDesde, o próximo ciclo desde hoy
  let anchor;
  if (facturarDesde) {
    anchor = dateWithDay(facturarDesde.getFullYear(), facturarDesde.getMonth(), day);
  } else {
    anchor = dateWithDay(asOf.getFullYear(), asOf.getMonth(), day);
    if (anchor < asOf) {
      anchor = dateWithDay(asOf.getFullYear(), asOf.getMonth() + 1, day);
    }
  }

  const cyclePoint = dateWithDay(anchor.getFullYear(), anchor.getMonth() + periodIndex, day);

  let periodStart;
  let periodEnd;
  if (tipo === 'anticipada') {
    periodStart = cyclePoint;
    const next = dateWithDay(cyclePoint.getFullYear(), cyclePoint.getMonth() + 1, day);
    periodEnd = new Date(next);
    periodEnd.setDate(periodEnd.getDate() - 1);
  } else {
    // Retroactiva: periodo que termina el día anterior al cyclePoint
    periodEnd = new Date(cyclePoint);
    periodEnd.setDate(periodEnd.getDate() - 1);
    periodStart = dateWithDay(cyclePoint.getFullYear(), cyclePoint.getMonth() - 1, day);
  }

  if (periodStart < install) periodStart = install;

  const ym = `${periodEnd.getFullYear()}-${String(periodEnd.getMonth() + 1).padStart(2, '0')}`;
  return {
    periodStart: formatDateISO(periodStart),
    periodEnd: formatDateISO(periodEnd),
    cycleDay: formatDateISO(tipo === 'anticipada' ? periodStart : cyclePoint),
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
 * @param overrides — campos del formulario (sin guardar) para preview en vivo
 */
export async function calcularProximasFacturas(orgId, serviceId, cantidad = 3, overrides = null) {
  const row = await loadServiceBundle(serviceId, orgId);
  if (!row) throw new Error('Servicio no encontrado');

  const n = Math.min(12, Math.max(1, Number(cantidad) || 3));
  const service = { ...row.service };

  if (overrides && typeof overrides === 'object') {
    const o = { ...overrides };
    if (o.facturarDesde !== undefined) {
      if (o.facturarDesde === null || o.facturarDesde === '') {
        o.facturarDesde = null;
      } else {
        const raw = String(o.facturarDesde).trim();
        o.facturarDesde = /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : raw.slice(0, 10);
      }
    }
    if (o.diaComienzoPeriodo != null) {
      o.billingDay = Number(o.diaComienzoPeriodo);
    }
    if (o.customPrice !== undefined) {
      o.customPrice = o.customPrice === null || o.customPrice === '' ? null : String(o.customPrice);
    }
    Object.assign(service, o);
  }

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
    let installFee = 0;
    if (i === 0 && !hasPrior && service.costoInstalacion != null && service.costoInstalacion !== '') {
      installFee = Math.round(Number(service.costoInstalacion) || 0);
    }
    const amounts = buildInvoiceAmounts((priced.neto || 0) + installFee, service);

    items.push({
      index: i,
      periodo: priced.label || window.label,
      periodStart: priced.periodStart || window.periodStart,
      periodEnd: priced.periodEnd || window.periodEnd,
      billingPeriod: priced.billingPeriod || window.billingPeriod,
      isProrated: Boolean(priced.isProrated),
      fechaCreacion: creationDateForPeriod(service, window, asOf),
      fechaVencimiento: dueDateForPeriod(service, window),
      neto: amounts.amount,
      impuesto: amounts.tax,
      monto: amounts.total,
      etiqueta: invoiceLabel(service, plan),
      installFee: installFee || undefined,
    });
  }

  return {
    serviceId: service.id,
    planName: plan.name,
    precioBase: price,
    facturarDesde: service.facturarDesde || null,
    items,
  };
}

export { loadServiceBundle };
