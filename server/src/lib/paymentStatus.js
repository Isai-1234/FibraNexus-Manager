export function computeInvoiceStatus({ total, paidSum, dueDate, currentStatus }) {
  if (currentStatus === 'cancelled') return 'cancelled';
  const t = Number(total);
  const p = Number(paidSum);
  if (p <= 0) {
    if (currentStatus === 'overdue') return 'overdue';
    if (dueDate && new Date(dueDate) < new Date() && ['pending', 'partial', 'overdue'].includes(currentStatus || 'pending')) {
      return 'overdue';
    }
    return 'pending';
  }
  if (p + 0.009 >= t) return 'paid';
  return 'partial';
}
