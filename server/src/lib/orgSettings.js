/** Ajustes ISP por organización (estilo UISP / Wisphub) */

export const DEFAULT_ORG_SETTINGS = {
  billingAutoEnabled: false,
  billingHour: 8,
  graceDaysBeforeSuspend: 5,
  autoSuspendEnabled: true,
  stopBillingWhenSuspended: true,
  autoMarkOverdue: true,
  autoReactivateOnPayment: true,
  debtNoticesEnabled: false,
  suspendPortalUrl: '',
  // Fase 5 — marca del ISP en portal
  brandLogoUrl: '',
  brandPrimaryColor: '#2563eb',
  brandAccentColor: '#0ea5e9',
  brandPortalTitle: '',
  // Pasarela por ISP (Flow / stub)
  paymentProvider: 'stub',
  flowApiKey: '',
  flowSecretKey: '',
  flowApiUrl: '',
  webpayCommerceCode: '',
  webpayApiKey: '',
  webpayEnv: 'integration',
  // Facturación electrónica DTE / SII (SimpleFactura · SimpleAPI)
  dteProvider: 'stub',
  dteApiKey: '',
  dteApiUrl: '',
  dteRutEmisor: '',
  dteRazonSocial: '',
  dteAmbiente: 'certificacion',
  /**
   * Flow tiene delegación SII de boleta (voucher = boleta legal).
   * Mientras sea true, pagos Flow NUNCA emiten DTE desde FibraNexus.
   * Pasar a false solo el día que se retire la delegación en el portal SII (manual).
   */
  flowDelegacionBoletaActiva: true,
  // Importación WispHub (solo lectura sobre su API)
  wisphubApiKey: '',
  wisphubBaseUrl: '',
  // Correo del ISP: remitente y API key propios (Resend). Vacío = usa el de la plataforma.
  mailFromName: '',
  mailFromEmail: '',
  mailReplyTo: '',
  mailApiKey: '',
};

/**
 * Desenvuelve settings guardados por error como JSON string dentro de jsonb
 * (doble serialización). Sin esto, mergeOrgSettings veía un string y perdía
 * wisphubApiKey / flow / DTE al leer o al PATCH.
 */
export function normalizeOrgSettingsRaw(raw) {
  let v = raw;
  for (let i = 0; i < 3; i++) {
    if (typeof v === 'string') {
      const t = v.trim();
      if (!t) return {};
      try {
        v = JSON.parse(t);
      } catch {
        return {};
      }
      continue;
    }
    break;
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  return {};
}

export function mergeOrgSettings(raw) {
  const s = normalizeOrgSettingsRaw(raw);
  const primary = sanitizeHexColor(s.brandPrimaryColor, DEFAULT_ORG_SETTINGS.brandPrimaryColor);
  const accent = sanitizeHexColor(s.brandAccentColor, DEFAULT_ORG_SETTINGS.brandAccentColor);
  const paymentProvider = ['stub', 'flow', 'webpay'].includes(String(s.paymentProvider || '').toLowerCase())
    ? String(s.paymentProvider).toLowerCase()
    : 'stub';
  const dteProvider = ['stub', 'simplefactura'].includes(String(s.dteProvider || '').toLowerCase())
    ? String(s.dteProvider).toLowerCase()
    : 'stub';
  return {
    ...DEFAULT_ORG_SETTINGS,
    ...s,
    billingHour: Math.min(23, Math.max(0, parseInt(s.billingHour, 10) || DEFAULT_ORG_SETTINGS.billingHour)),
    graceDaysBeforeSuspend: Math.min(90, Math.max(0, parseInt(s.graceDaysBeforeSuspend, 10) ?? DEFAULT_ORG_SETTINGS.graceDaysBeforeSuspend)),
    brandLogoUrl: String(s.brandLogoUrl || '').trim().slice(0, 500),
    brandPrimaryColor: primary,
    brandAccentColor: accent,
    brandPortalTitle: String(s.brandPortalTitle || '').trim().slice(0, 80),
    paymentProvider,
    flowApiKey: s.flowApiKey != null ? String(s.flowApiKey) : '',
    flowSecretKey: s.flowSecretKey != null ? String(s.flowSecretKey) : '',
    flowApiUrl: String(s.flowApiUrl || '').trim().slice(0, 200),
    webpayCommerceCode: s.webpayCommerceCode != null ? String(s.webpayCommerceCode) : '',
    webpayApiKey: s.webpayApiKey != null ? String(s.webpayApiKey) : '',
    webpayEnv: s.webpayEnv === 'production' ? 'production' : 'integration',
    dteProvider,
    dteApiKey: s.dteApiKey != null ? String(s.dteApiKey) : '',
    dteApiUrl: String(s.dteApiUrl || '').trim().slice(0, 200),
    dteRutEmisor: String(s.dteRutEmisor || '').trim().slice(0, 20),
    dteRazonSocial: String(s.dteRazonSocial || '').trim().slice(0, 120),
    dteAmbiente: s.dteAmbiente === 'produccion' ? 'produccion' : 'certificacion',
    flowDelegacionBoletaActiva: s.flowDelegacionBoletaActiva === false ? false : true,
    wisphubApiKey: s.wisphubApiKey != null ? String(s.wisphubApiKey) : '',
    wisphubBaseUrl: String(s.wisphubBaseUrl || '').trim().replace(/\/+$/, '').slice(0, 200),
  };
}

function sanitizeHexColor(value, fallback) {
  const v = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const r = v[1];
    const g = v[2];
    const b = v[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

export function daysOverdue(dueDate, asOf = new Date()) {
  const due = parseDateOnly(dueDate);
  if (!due) return 0;
  const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const diff = Math.floor((today - due) / 86400000);
  return diff > 0 ? diff : 0;
}

function parseDateOnly(value) {
  if (!value) return null;
  // pg devuelve columnas `date` como objeto Date; String(Date) no tiene formato YYYY-MM-DD
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const s = String(value).split('T')[0];
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
