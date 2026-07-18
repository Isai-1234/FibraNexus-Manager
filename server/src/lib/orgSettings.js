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
};

export function mergeOrgSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const primary = sanitizeHexColor(s.brandPrimaryColor, DEFAULT_ORG_SETTINGS.brandPrimaryColor);
  const accent = sanitizeHexColor(s.brandAccentColor, DEFAULT_ORG_SETTINGS.brandAccentColor);
  const paymentProvider = ['stub', 'flow', 'webpay'].includes(String(s.paymentProvider || '').toLowerCase())
    ? String(s.paymentProvider).toLowerCase()
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
  const s = String(value).split('T')[0];
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
