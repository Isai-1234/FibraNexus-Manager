/**
 * Envío de correo desacoplado.
 * - Con RESEND_API_KEY → Resend (gratis con dominio/verificación).
 * - Sin key → solo log en consola (útil en Render Logs para lab).
 */

export function getMailFrom() {
  return process.env.MAIL_FROM || 'FibraNexus <onboarding@resend.dev>';
}

export async function sendMail({ to, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: getMailFrom(),
        to: [to],
        subject,
        text,
        html: html || undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend error ${res.status}: ${body}`);
    }
    return { provider: 'resend', ok: true };
  }

  console.log('[mail:console]', { to, subject, text });
  return { provider: 'console', ok: true };
}

export function appPublicBaseUrl() {
  const base = (
    process.env.FRONTEND_URL
    || process.env.PUBLIC_URL
    || process.env.RENDER_EXTERNAL_URL
    || 'http://localhost:5173'
  ).split(',')[0].trim().replace(/\/$/, '');
  return base;
}

/**
 * Resuelve la configuración de correo de una org: remitente y API key propios
 * (settings del ISP) con fallback a las variables de la plataforma.
 * Retorna { from, apiKey | null, replyTo }.
 */
export async function getOrgMailConfig(orgId) {
  try {
    const { db } = await import('../db/index.js');
    const { organizations } = await import('../db/schema.js');
    const { eq } = await import('drizzle-orm');
    const { mergeOrgSettings } = await import('./orgSettings.js');
    const { decryptSecret } = await import('./secrets.js');
    const [org] = await db.select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (org) {
      const merged = mergeOrgSettings(org.settings);
      let apiKey = null;
      if (merged.mailApiKey) {
        try { apiKey = decryptSecret(merged.mailApiKey); } catch { /* legacy */ }
      }
      let from = getMailFrom();
      if (merged.mailFromName && merged.mailFromEmail) {
        from = `${merged.mailFromName} <${merged.mailFromEmail}>`;
      } else if (merged.mailFromEmail) {
        from = merged.mailFromEmail;
      }
      return { from, apiKey, replyTo: merged.mailReplyTo || null };
    }
  } catch (err) {
    console.error('[mailer] getOrgMailConfig fallo, usando default:', err.message);
  }
  return { from: getMailFrom(), apiKey: null, replyTo: null };
}

/** Envía correo con la identidad del ISP (o la de la plataforma si no configuro nada). */
export async function sendMailForOrg(orgId, { to, subject, text, html }) {
  const cfg = await getOrgMailConfig(orgId);
  const apiKey = cfg.apiKey || process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('[mail:console]', { to, subject, text });
    return { provider: 'console', ok: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: cfg.from,
      to: [to],
      reply_to: cfg.replyTo || undefined,
      subject,
      text,
      html: html || undefined,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }
  return { provider: 'resend', ok: true };
}
