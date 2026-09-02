/**
 * Proveedores de avisos de deuda — desacoplados.
 * - console: solo log (lab).
 * - email: envío real vía Resend (RESEND_API_KEY) con fallback a log.
 */

export function getMessagingProvider() {
  const mode = (process.env.DEBT_NOTICE_PROVIDER || 'console').toLowerCase();
  if (mode === 'email') return emailProvider();
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

function emailProvider() {
  return {
    name: 'email',
    async sendDebtNotice({ organizationId, to, invoiceId, total, daysOverdue: days }) {
      if (!to) {
        return { ok: false, provider: 'email', message: 'Abonado sin email registrado' };
      }
      const { sendMailForOrg, appPublicBaseUrl } = await import('./mailer.js');
      const pesos = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(total);
      const portalUrl = `${appPublicBaseUrl()}`;
      const subject = `Aviso: factura pendiente (${pesos}, ${days} días de atraso)`;
      const text = `Tienes una factura pendiente de ${pesos} con ${days} días de atraso.\n\nPuedes pagarla desde tu portal: ${portalUrl}\n\nSi ya pagaste, ignora este mensaje.`;
      const html = `<p>Tienes una <strong>factura pendiente de ${pesos}</strong> con ${days} días de atraso.</p><p>Puedes pagarla desde tu <a href="${portalUrl}">portal de abonado</a>.</p><p style="color:#64748b">Si ya pagaste, ignora este mensaje.</p>`;
      try {
        await sendMailForOrg(organizationId, { to, subject, text, html });
        return { ok: true, provider: 'email', message: `Enviado a ${to} (factura ${invoiceId})` };
      } catch (err) {
        console.error(`[debt-notice:email] fallo factura ${invoiceId}:`, err.message);
        return { ok: false, provider: 'email', message: err.message };
      }
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
