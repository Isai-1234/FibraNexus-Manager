/** Ajustes ISP por organización (estilo UISP / Wisphub) */

export const DEFAULT_ORG_SETTINGS = {
  billingAutoEnabled: false,
  billingHour: 8,
  graceDaysBeforeSuspend: 5,
  autoSuspendEnabled: true,
  stopBillingWhenSuspended: true,
  autoMarkOverdue: true,
  autoReactivateOnPayment: true,
  suspendPortalUrl: '',
};

export function mergeOrgSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    ...DEFAULT_ORG_SETTINGS,
    ...s,
    billingHour: Math.min(23, Math.max(0, parseInt(s.billingHour, 10) || DEFAULT_ORG_SETTINGS.billingHour)),
    graceDaysBeforeSuspend: Math.min(90, Math.max(0, parseInt(s.graceDaysBeforeSuspend, 10) ?? DEFAULT_ORG_SETTINGS.graceDaysBeforeSuspend)),
  };
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
