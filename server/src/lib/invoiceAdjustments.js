import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { invoices, invoiceAdjustments } from '../db/schema.js';
import { orgFilter } from './tenant.js';
import { sumPaymentsForInvoice } from './paymentService.js';
import { computeInvoiceStatus } from './paymentStatus.js';

/**
 * Anula factura interna con motivo y auditoría de ajuste.
 * No elimina pagos históricos; rechaza si ya hay pagos registrados.
 */
export async function voidInvoice({ orgId, invoiceId, reason, userId }) {
  if (!reason || String(reason).trim().length < 3) {
    return { error: 'Indica un motivo de anulación (mín. 3 caracteres)', status: 400 };
  }
  const [inv] = await db.select().from(invoices)
    .where(and(eq(invoices.id, invoiceId), orgFilter(invoices, orgId)))
    .limit(1);
  if (!inv) return { error: 'Factura no encontrada', status: 404 };
  if (inv.status === 'cancelled') {
    return { error: 'La factura ya está anulada', status: 400 };
  }
  if (inv.status === 'paid') {
    return { error: 'No se puede anular una factura pagada', status: 400 };
  }
  const paidSum = await sumPaymentsForInvoice(invoiceId);
  if (paidSum > 0.01) {
    return { error: 'Hay pagos registrados; no se puede anular sin conciliar', status: 400 };
  }

  const previousTotal = Number(inv.total);
  const [updated] = await db.update(invoices).set({
    status: 'cancelled',
    notes: `${inv.notes || ''}\n[Anulación] ${String(reason).trim()}`.trim(),
    updatedAt: new Date(),
  }).where(eq(invoices.id, invoiceId)).returning();

  const [adj] = await db.insert(invoiceAdjustments).values({
    organizationId: orgId,
    invoiceId,
    type: 'void',
    amountDelta: '0',
    reason: String(reason).trim(),
    createdBy: userId || null,
    previousTotal: String(previousTotal.toFixed(2)),
    newTotal: String(previousTotal.toFixed(2)),
  }).returning();

  return { invoice: updated, adjustment: adj };
}

/**
 * Ajusta el total de una factura interna (crédito negativo / débito positivo).
 * Recalcula estado según pagos existentes. No es DTE.
 */
export async function adjustInvoice({ orgId, invoiceId, amountDelta, reason, userId }) {
  if (!reason || String(reason).trim().length < 3) {
    return { error: 'Indica un motivo del ajuste (mín. 3 caracteres)', status: 400 };
  }
  const delta = Number(amountDelta);
  if (!Number.isFinite(delta) || delta === 0) {
    return { error: 'amountDelta debe ser un número distinto de 0', status: 400 };
  }

  const [inv] = await db.select().from(invoices)
    .where(and(eq(invoices.id, invoiceId), orgFilter(invoices, orgId)))
    .limit(1);
  if (!inv) return { error: 'Factura no encontrada', status: 404 };
  if (inv.status === 'cancelled') {
    return { error: 'No se puede ajustar una factura anulada', status: 400 };
  }

  const previousTotal = Number(inv.total);
  const newTotal = Math.round((previousTotal + delta) * 100) / 100;
  if (newTotal < 0) {
    return { error: 'El total no puede quedar negativo', status: 400 };
  }

  const paidSum = await sumPaymentsForInvoice(invoiceId);
  if (newTotal + 0.01 < paidSum) {
    return { error: `El nuevo total (${newTotal}) es menor a lo ya pagado (${paidSum})`, status: 400 };
  }

  // Proporcional neto/IVA 19% sobre el nuevo total
  const net = Math.round((newTotal / 1.19) * 100) / 100;
  const tax = Math.round((newTotal - net) * 100) / 100;
  const newStatus = computeInvoiceStatus({
    total: newTotal,
    paidSum,
    dueDate: inv.dueDate,
    currentStatus: inv.status === 'paid' ? 'paid' : 'pending',
  });

  const [updated] = await db.update(invoices).set({
    amount: String(net.toFixed(2)),
    tax: String(tax.toFixed(2)),
    total: String(newTotal.toFixed(2)),
    status: newStatus,
    paidDate: newStatus === 'paid' ? (inv.paidDate || new Date()) : null,
    notes: `${inv.notes || ''}\n[Ajuste ${delta > 0 ? '+' : ''}${delta}] ${String(reason).trim()}`.trim(),
    updatedAt: new Date(),
  }).where(eq(invoices.id, invoiceId)).returning();

  const [adj] = await db.insert(invoiceAdjustments).values({
    organizationId: orgId,
    invoiceId,
    type: delta < 0 ? 'credit' : 'debit',
    amountDelta: String(delta.toFixed(2)),
    reason: String(reason).trim(),
    createdBy: userId || null,
    previousTotal: String(previousTotal.toFixed(2)),
    newTotal: String(newTotal.toFixed(2)),
  }).returning();

  return {
    invoice: updated,
    adjustment: adj,
    paidSum,
    balance: Math.max(0, newTotal - paidSum),
  };
}
