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

const SMTP_BY_DOMAIN = [
  { suffix: 'gmail.com', host: 'smtp.gmail.com', port: 465, secure: 'ssl' },
  { suffix: 'googlemail.com', host: 'smtp.gmail.com', port: 465, secure: 'ssl' },
  { suffix: 'outlook.com', host: 'smtp-mail.outlook.com', port: 587, secure: 'starttls' },
  { suffix: 'hotmail.com', host: 'smtp-mail.outlook.com', port: 587, secure: 'starttls' },
  { suffix: 'live.com', host: 'smtp-mail.outlook.com', port: 587, secure: 'starttls' },
  { suffix: 'yahoo.com', host: 'smtp.mail.yahoo.com', port: 465, secure: 'ssl' },
  { suffix: 'yahoo.es', host: 'smtp.mail.yahoo.com', port: 465, secure: 'ssl' },
  { suffix: 'icloud.com', host: 'smtp.mail.me.com', port: 587, secure: 'starttls' },
];

/** Servidor SMTP por defecto segun el dominio del correo (Gmail/Outlook/etc). */
export function inferSmtpForEmail(email) {
  const domain = String(email || '').split('@')[1]?.toLowerCase();
  if (!domain) return null;
  return SMTP_BY_DOMAIN.find((d) => domain.endsWith(d.suffix)) || null;
}

/**
 * Resuelve la configuración de correo de una org: SMTP propio del ISP,
 * API key Resend propia, o fallback a la plataforma.
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
      let smtpPassword = null;
      if (merged.mailSmtpPassword) {
        try { smtpPassword = decryptSecret(merged.mailSmtpPassword); } catch { /* legacy */ }
      }
      // Host vacio: autodetectar por dominio del correo (Gmail/Outlook/...).
      let smtpHost = merged.mailSmtpHost;
      let smtpPort = Number(merged.mailSmtpPort) || 587;
      let smtpSecure = merged.mailSmtpSecure || 'starttls';
      if (!smtpHost && merged.mailSmtpUser) {
        const inferred = inferSmtpForEmail(merged.mailSmtpUser);
        if (inferred) {
          smtpHost = inferred.host;
          smtpPort = inferred.port;
          smtpSecure = inferred.secure;
        }
      }
      const smtp = smtpHost && merged.mailSmtpUser && smtpPassword
        ? {
          host: smtpHost,
          port: smtpPort,
          secure: smtpSecure === 'ssl',
          requireTLS: smtpSecure !== 'none',
          auth: { user: merged.mailSmtpUser, pass: smtpPassword },
        }
        : null;
      let from = getMailFrom();
      if (merged.mailFromName && merged.mailFromEmail) {
        from = `${merged.mailFromName} <${merged.mailFromEmail}>`;
      } else if (merged.mailFromEmail) {
        from = merged.mailFromEmail;
      } else if (smtp) {
        // Sin remitente explicito, el usuario SMTP es remitente por defecto.
        from = smtp.auth.user;
      }
      return { from, apiKey, smtp, replyTo: merged.mailReplyTo || null };
    }
  } catch (err) {
    console.error('[mailer] getOrgMailConfig fallo, usando default:', err.message);
  }
  return { from: getMailFrom(), apiKey: null, smtp: null, replyTo: null };
}

/** Envía correo con la identidad del ISP (SMTP propio, Resend propio o plataforma). */
export async function sendMailForOrg(orgId, { to, subject, text, html }) {
  const cfg = await getOrgMailConfig(orgId);

  if (cfg.smtp) {
    const nodemailer = (await import('nodemailer')).default;
    const transport = nodemailer.createTransport({
      ...cfg.smtp,
      from: cfg.from,
    });
    await transport.sendMail({
      from: cfg.from,
      to,
      replyTo: cfg.replyTo || undefined,
      subject,
      text,
      html: html || undefined,
    });
    return { provider: 'smtp', ok: true };
  }

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
