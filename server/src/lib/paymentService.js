import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { payments, invoices } from '../db/schema.js';
import { orgFilter } from './tenant.js';
import { computeInvoiceStatus } from './paymentStatus.js';

export { computeInvoiceStatus };

const PAID_STATUSES = new Set(['paid']);
export const OPEN_INVOICE_STATUSES = ['pending', 'overdue', 'partial'];

export async function sumPaymentsForInvoice(invoiceId) {
  const [{ total }] = await db.select({
    total: sql`coalesce(sum(${payments.amount}::decimal), 0)`,
  }).from(payments).where(eq(payments.invoiceId, invoiceId));
  return Number(total || 0);
}

/** Suma de pagos por factura (una query). */
export async function sumPaymentsByInvoiceIds(invoiceIds) {
  const ids = [...new Set((invoiceIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return new Map();
  const rows = await db.select({
    invoiceId: payments.invoiceId,
    total: sql`coalesce(sum(${payments.amount}::decimal), 0)`,
  })
    .from(payments)
    .where(inArray(payments.invoiceId, ids))
    .groupBy(payments.invoiceId);
  return new Map(rows.map((r) => [Number(r.invoiceId), Number(r.total || 0)]));
}

/** Adjunta paidSum y balance a filas de factura (misma noción en todo el panel). */
export async function attachInvoiceBalances(invoiceRows) {
  const rows = Array.isArray(invoiceRows) ? invoiceRows : [];
  const paidMap = await sumPaymentsByInvoiceIds(rows.map((r) => r.id));
  return rows.map((inv) => {
    const paidSum = paidMap.get(Number(inv.id)) || 0;
    const total = Number(inv.total || 0);
    const balance = Math.max(0, Math.round((total - paidSum) * 100) / 100);
    return { ...inv, paidSum, balance };
  });
}

export function invoiceOpenBalance(inv) {
  if (!inv || inv.status === 'cancelled' || inv.status === 'paid') return 0;
  if (inv.balance != null) return Math.max(0, Number(inv.balance) || 0);
  const paid = Number(inv.paidSum || 0);
  return Math.max(0, Number(inv.total || 0) - paid);
}

/**
 * Registra un pago con saldo e idempotencia.
 * No marca paid si el monto es parcial.
 */
export async function registerPayment({
  orgId,
  invoiceId,
  amount,
  method,
  reference,
  notes,
  currency = 'CLP',
  idempotencyKey,
}) {
  const invRows = await db.select().from(invoices)
    .where(and(eq(invoices.id, invoiceId), orgFilter(invoices, orgId)))
    .limit(1);
  const inv = invRows[0];
  if (!inv) return { error: 'Factura no encontrada', status: 404 };
  if (inv.status === 'cancelled') {
    return { error: 'La factura está anulada', status: 400 };
  }
  if (PAID_STATUSES.has(inv.status)) {
    return { error: 'La factura ya está pagada', status: 400 };
  }

  if (currency && currency !== 'CLP') {
    return { error: 'Moneda no soportada (solo CLP)', status: 400 };
  }

  if (idempotencyKey) {
    const existing = await db.select().from(payments)
      .where(and(
        eq(payments.invoiceId, inv.id),
        eq(payments.reference, `idem:${idempotencyKey}`),
      ))
      .limit(1);
    if (existing.length) {
      const paidSum = await sumPaymentsForInvoice(inv.id);
      const balance = Math.max(0, Number(inv.total) - paidSum);
      return {
        payment: existing[0],
        invoiceStatus: inv.status,
        balance,
        paidSum,
        idempotent: true,
      };
    }
  }

  const payAmount = Number(amount);
  if (!Number.isFinite(payAmount) || payAmount <= 0) {
    return { error: 'Monto inválido', status: 400 };
  }

  const paidBefore = await sumPaymentsForInvoice(inv.id);
  const balanceBefore = Number(inv.total) - paidBefore;
  if (payAmount > balanceBefore + 0.01) {
    return {
      error: `El monto excede el saldo pendiente (${balanceBefore.toFixed(2)})`,
      status: 400,
    };
  }

  const ref = idempotencyKey
    ? `idem:${idempotencyKey}`
    : (reference || null);

  const [payment] = await db.insert(payments).values({
    invoiceId: inv.id,
    clientId: inv.clientId,
    amount: String(payAmount.toFixed(2)),
    method,
    reference: ref,
    notes: notes || null,
  }).returning();

  const paidSum = paidBefore + payAmount;
  const newStatus = computeInvoiceStatus({
    total: inv.total,
    paidSum,
    dueDate: inv.dueDate,
    currentStatus: inv.status,
  });

  const patch = {
    status: newStatus,
    updatedAt: new Date(),
  };
  if (newStatus === 'paid') {
    patch.paidDate = new Date();
  }

  await db.update(invoices)
    .set(patch)
    .where(and(eq(invoices.id, inv.id), orgFilter(invoices, orgId)));

  const balance = Math.max(0, Number(inv.total) - paidSum);
  return {
    payment,
    invoiceStatus: newStatus,
    balance,
    paidSum,
    fullyPaid: newStatus === 'paid',
    idempotent: false,
  };
}
