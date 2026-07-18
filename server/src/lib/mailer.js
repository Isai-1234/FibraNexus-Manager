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
