/** Utilidades de facturación ISP — ciclos aniversario y mes calendario proporcional */

export function formatDateISO(date) {
  const d = date instanceof Date ? date : parseDateInput(date);
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDateInput(value) {
  if (!value) return null;
  const s = String(value).split('T')[0];
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function billingDayFromInstall(installationDate) {
  const d = parseDateInput(installationDate);
  return d ? d.getDate() : 1;
}

/**
 * @param {'anniversary'|'calendar_prorate'} billingCycleType
 */
export function computeNextBillingDate(installationDate, billingCycleType, billingDay, fromDate = new Date()) {
  const install = parseDateInput(installationDate) || fromDate;
  const day = billingDay || install.getDate();

  if (billingCycleType === 'calendar_prorate') {
    const installEnd = new Date(install.getFullYear(), install.getMonth() + 1, 0);
    if (fromDate <= installEnd) {
      return formatDateISO(new Date(install.getFullYear(), install.getMonth() + 1, 1));
    }
    const next = new Date(fromDate.getFullYear(), fromDate.getMonth() + 1, 1);
    return formatDateISO(next);
  }

  let next = new Date(fromDate.getFullYear(), fromDate.getMonth(), day);
  if (next <= fromDate) {
    next = new Date(fromDate.getFullYear(), fromDate.getMonth() + 1, day);
  }
  return formatDateISO(next);
}

export function getBillingWindow(service, asOf = new Date()) {
  const install = parseDateInput(service.installationDate) || asOf;
  const cycle = service.billingCycleType || 'anniversary';
  const billingDay = service.billingDay || install.getDate();

  if (cycle === 'calendar_prorate') {
    const monthEnd = new Date(install.getFullYear(), install.getMonth() + 1, 0);
    if (asOf <= monthEnd) {
      return {
        periodStart: formatDateISO(install),
        periodEnd: formatDateISO(monthEnd),
        isProrated: true,
        billingPeriod: `${install.getFullYear()}-${String(install.getMonth() + 1).padStart(2, '0')}-pro`,
        label: `Proporcional ${formatDateISO(install)} al ${formatDateISO(monthEnd)}`,
      };
    }
    const start = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
    const end = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0);
    return {
      periodStart: formatDateISO(start),
      periodEnd: formatDateISO(end),
      isProrated: false,
      billingPeriod: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      label: `Mes ${String(start.getMonth() + 1).padStart(2, '0')}/${start.getFullYear()}`,
    };
  }

  let periodEnd = new Date(asOf.getFullYear(), asOf.getMonth(), billingDay);
  if (periodEnd > asOf) {
    periodEnd = new Date(asOf.getFullYear(), asOf.getMonth() - 1, billingDay);
  }
  let periodStart = new Date(periodEnd);
  periodStart.setMonth(periodStart.getMonth() - 1);
  if (periodStart < install) periodStart = install;

  const ym = `${periodEnd.getFullYear()}-${String(periodEnd.getMonth() + 1).padStart(2, '0')}`;
  return {
    periodStart: formatDateISO(periodStart),
    periodEnd: formatDateISO(periodEnd),
    isProrated: false,
    billingPeriod: `${ym}-d${billingDay}`,
    label: `Ciclo ${formatDateISO(periodStart)} al ${formatDateISO(periodEnd)}`,
  };
}

export function computeDueDate(service, window) {
  const cycle = service.billingCycleType || 'anniversary';
  const dueDay = service.billingDueDay ?? 5;
  const periodEnd = parseDateInput(window.periodEnd);

  if (cycle === 'calendar_prorate') {
    if (window.isProrated) {
      if (dueDay === 0) {
        return window.periodEnd;
      }
      const due = new Date(periodEnd.getFullYear(), periodEnd.getMonth() + 1, dueDay);
      return formatDateISO(due);
    }
    const due = new Date(periodEnd.getFullYear(), periodEnd.getMonth() + 1, dueDay);
    return formatDateISO(due);
  }

  const billingDay = service.billingDay || dueDay;
  let due = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), billingDay);
  if (due < periodEnd) {
    due = new Date(periodEnd.getFullYear(), periodEnd.getMonth() + 1, billingDay);
  }
  return formatDateISO(due);
}

export function computeInvoiceAmount(fullPrice, window) {
  const price = Number(fullPrice) || 0;
  if (!window.isProrated) {
    return { amount: Math.round(price), days: null, totalDays: null };
  }
  const start = parseDateInput(window.periodStart);
  const end = parseDateInput(window.periodEnd);
  const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const totalDays = daysInMonth(start.getFullYear(), start.getMonth());
  const amount = Math.round(price * days / totalDays);
  return { amount, days, totalDays };
}

export function billingCycleDescription(service) {
  const cycle = service.billingCycleType || 'anniversary';
  const day = service.billingDay || billingDayFromInstall(service.installationDate);
  const dueDay = service.billingDueDay ?? 5;

  if (cycle === 'calendar_prorate') {
    const dueText = dueDay === 0
      ? 'último día del mes de instalación'
      : `día ${dueDay} del mes siguiente`;
    return `Proporcional desde instalación hasta fin de mes · vence ${dueText}`;
  }
  return `Aniversario día ${day} al ${day} · vence día ${dueDay || day} de cada ciclo`;
}
