import { db } from '../db/index.js';
import { clientServices, invoices, payments, detectedDevices } from '../db/schema.js';
import { and, eq, inArray } from 'drizzle-orm';
import { orgFilter } from './tenant.js';

const DELETABLE_INVOICE_STATUSES = ['pending', 'overdue', 'cancelled'];

/**
 * Elimina una suscripción y limpia referencias (facturas pendientes, detected_devices).
 * Las facturas pagadas se conservan con client_service_id = null.
 */
export async function deleteClientServiceWithCleanup(serviceId, orgId) {
  const linkedInvoices = await db.select({
    id: invoices.id,
    status: invoices.status,
  })
    .from(invoices)
    .where(and(eq(invoices.clientServiceId, serviceId), orgFilter(invoices, orgId)));

  const invoiceIdsToDelete = linkedInvoices
    .filter((i) => DELETABLE_INVOICE_STATUSES.includes(i.status))
    .map((i) => i.id);
  const paidInvoiceIds = linkedInvoices
    .filter((i) => i.status === 'paid')
    .map((i) => i.id);

  if (invoiceIdsToDelete.length) {
    await db.delete(payments).where(inArray(payments.invoiceId, invoiceIdsToDelete));
    await db.delete(invoices).where(inArray(invoices.id, invoiceIdsToDelete));
  }

  if (paidInvoiceIds.length) {
    await db.update(invoices)
      .set({ clientServiceId: null, updatedAt: new Date() })
      .where(inArray(invoices.id, paidInvoiceIds));
  }

  await db.update(detectedDevices)
    .set({
      status: 'detected',
      adoptedAsClientServiceId: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(detectedDevices.adoptedAsClientServiceId, serviceId),
      orgFilter(detectedDevices, orgId),
    ));

  await db.delete(clientServices).where(eq(clientServices.id, serviceId));

  return {
    deletedInvoices: invoiceIdsToDelete.length,
    preservedPaidInvoices: paidInvoiceIds.length,
  };
}
