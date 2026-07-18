/**
 * Proveedor de avisos de deuda — desacoplado (console / email stub).
 * No envía SMS/WhatsApp reales en MVP.
 */

export function getMessagingProvider() {
  const mode = (process.env.DEBT_NOTICE_PROVIDER || 'console').toLowerCase();
  if (mode === 'email') return emailStubProvider();
  return consoleProvider();
}

function consoleProvider() {
  return {
    name: 'console',
    async sendDebtNotice({ organizationId, clientId, to, invoiceId, total, daysOverdue: days, channel = 'debt' }) {
      const line = `[debt-notice:${channel}] org=${organizationId} client=${clientId} to=${to || 'n/a'} invoice=${invoiceId} total=${total} overdueDays=${days}`;
      console.log(line);
      return { ok: true, provider: 'console', message: line };
    },
  };
}

function emailStubProvider() {
  return {
    name: 'email-stub',
    async sendDebtNotice(payload) {
      const line = `[debt-notice:email-stub] would-email ${payload.to || 'sin-email'} invoice=${payload.invoiceId} total=${payload.total}`;
      console.log(line);
      return { ok: true, provider: 'email-stub', message: line };
    },
  };
}

/**
 * Emite avisos para facturas overdue de una org (máx 50 por corrida).
 */
export async function sendOverdueDebtNotices(orgId, deps) {
  const {
    db, invoices, clients, users, orgFilter, eq, and, daysOverdue,
  } = deps;
  const provider = getMessagingProvider();
  const overdue = await db.select({
    id: invoices.id,
    clientId: invoices.clientId,
    total: invoices.total,
    dueDate: invoices.dueDate,
    email: users.email,
  })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .leftJoin(users, eq(clients.userId, users.id))
    .where(and(orgFilter(invoices, orgId), eq(invoices.status, 'overdue')))
    .limit(50);

  const results = [];
  for (const inv of overdue) {
    const days = daysOverdue(inv.dueDate);
    const sent = await provider.sendDebtNotice({
      organizationId: orgId,
      clientId: inv.clientId,
      to: inv.email,
      invoiceId: inv.id,
      total: Number(inv.total),
      daysOverdue: days,
    });
    results.push({ invoiceId: inv.id, ...sent });
  }
  return { sent: results.length, provider: provider.name, results };
}
