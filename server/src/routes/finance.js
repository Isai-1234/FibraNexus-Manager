import { Router } from 'express';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.js';
import { requireOrganizationId, orgFilter } from '../lib/tenant.js';
import { db } from '../db/index.js';
import {
  invoices,
  payments,
  expenses,
  clientServices,
  clients,
  plans,
} from '../db/schema.js';
import { sumPaymentsByInvoiceIds } from '../lib/paymentService.js';

export const financeRouter = Router();

const EXPENSE_CATEGORIES = ['equipment', 'services', 'rent', 'salary', 'taxes', 'other'];

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function monthKey(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

function startOfMonthUTC(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
}

function addMonthsUTC(date, delta) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1));
}

/** Rangos de período actual / anterior según month|quarter|year */
function periodRanges(period = 'month', now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  if (period === 'year') {
    const currentStart = new Date(Date.UTC(y, 0, 1));
    const currentEnd = new Date(Date.UTC(y + 1, 0, 1));
    const previousStart = new Date(Date.UTC(y - 1, 0, 1));
    const previousEnd = currentStart;
    return { currentStart, currentEnd, previousStart, previousEnd, label: 'year' };
  }

  if (period === 'quarter') {
    const qStartMonth = Math.floor(m / 3) * 3;
    const currentStart = startOfMonthUTC(y, qStartMonth);
    const currentEnd = addMonthsUTC(currentStart, 3);
    const previousStart = addMonthsUTC(currentStart, -3);
    const previousEnd = currentStart;
    return { currentStart, currentEnd, previousStart, previousEnd, label: 'quarter' };
  }

  // month (default)
  const currentStart = startOfMonthUTC(y, m);
  const currentEnd = addMonthsUTC(currentStart, 1);
  const previousStart = addMonthsUTC(currentStart, -1);
  const previousEnd = currentStart;
  return { currentStart, currentEnd, previousStart, previousEnd, label: 'month' };
}

function emptyBucket() {
  return {
    payments: { count: 0, total: 0 },
    paidInvoices: { count: 0, total: 0 },
    unpaidInvoices: { count: 0, total: 0 },
    overdueInvoices: { count: 0, total: 0 },
  };
}

async function summarizeInvoicesAndPayments(orgId, rangeStart, rangeEnd) {
  const bucket = emptyBucket();

  const invRows = await db.select({
    id: invoices.id,
    total: invoices.total,
    status: invoices.status,
    dueDate: invoices.dueDate,
    paidDate: invoices.paidDate,
    createdAt: invoices.createdAt,
  }).from(invoices).where(and(
    orgFilter(invoices, orgId),
    gte(invoices.createdAt, rangeStart),
    lt(invoices.createdAt, rangeEnd),
    sql`${invoices.status} <> 'cancelled'`,
  ));

  const paidByInv = await sumPaymentsByInvoiceIds(
    invRows
      .filter((inv) => ['pending', 'overdue', 'partial'].includes(inv.status))
      .map((inv) => inv.id),
  );

  for (const inv of invRows) {
    const total = toNum(inv.total);
    const paidSum = paidByInv.get(Number(inv.id)) || 0;
    const balance = Math.max(0, total - paidSum);
    if (inv.status === 'paid') {
      bucket.paidInvoices.count += 1;
      bucket.paidInvoices.total += total;
    } else if (inv.status === 'overdue') {
      bucket.overdueInvoices.count += 1;
      bucket.overdueInvoices.total += balance;
    } else if (inv.status === 'pending' || inv.status === 'partial') {
      bucket.unpaidInvoices.count += 1;
      bucket.unpaidInvoices.total += balance;
    }
  }

  const payRows = await db.select({
    amount: payments.amount,
  }).from(payments)
    .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
    .where(and(
      orgFilter(invoices, orgId),
      gte(payments.paymentDate, rangeStart),
      lt(payments.paymentDate, rangeEnd),
    ));

  for (const p of payRows) {
    bucket.payments.count += 1;
    bucket.payments.total += toNum(p.amount);
  }

  // Redondear a 2 decimales
  for (const key of Object.keys(bucket)) {
    bucket[key].total = Math.round(bucket[key].total * 100) / 100;
  }
  return bucket;
}

async function projectNextPeriod(orgId) {
  const rows = await db.select({
    price: plans.price,
    customPrice: clientServices.customPrice,
  }).from(clientServices)
    .innerJoin(clients, eq(clientServices.clientId, clients.id))
    .innerJoin(plans, eq(clientServices.planId, plans.id))
    .where(and(
      orgFilter(clients, orgId),
      eq(clientServices.status, 'active'),
      sql`${clients.deletedAt} IS NULL`,
    ));

  let total = 0;
  for (const r of rows) {
    const p = r.customPrice != null && r.customPrice !== '' ? toNum(r.customPrice) : toNum(r.price);
    total += p;
  }
  total = Math.round(total * 100) / 100;

  return {
    payments: { count: rows.length, total },
    paidInvoices: { count: rows.length, total },
    unpaidInvoices: { count: 0, total: 0 },
    overdueInvoices: { count: 0, total: 0 },
    projectedFromActiveServices: true,
  };
}

function emptyMonthInvoicing() {
  return { paid: 0, unpaid: 0, onTime: 0, overdue: 0 };
}

function emptyMonthPayments() {
  return { cash: 0, transfer: 0, card: 0, flow: 0, other: 0 };
}

async function buildChartInvoicing(orgId, monthsBack = 12) {
  const now = new Date();
  const start = startOfMonthUTC(now.getUTCFullYear(), now.getUTCMonth() - (monthsBack - 1));
  const end = addMonthsUTC(startOfMonthUTC(now.getUTCFullYear(), now.getUTCMonth()), 1);

  const map = {};
  for (let i = 0; i < monthsBack; i++) {
    const d = addMonthsUTC(start, i);
    map[monthKey(d)] = { month: monthKey(d), ...emptyMonthInvoicing() };
  }

  const invRows = await db.select({
    total: invoices.total,
    status: invoices.status,
    dueDate: invoices.dueDate,
    paidDate: invoices.paidDate,
    createdAt: invoices.createdAt,
  }).from(invoices).where(and(
    orgFilter(invoices, orgId),
    gte(invoices.createdAt, start),
    lt(invoices.createdAt, end),
    sql`${invoices.status} <> 'cancelled'`,
  ));

  for (const inv of invRows) {
    const key = monthKey(new Date(inv.createdAt));
    if (!map[key]) continue;
    const total = toNum(inv.total);
    if (inv.status === 'overdue') {
      map[key].overdue += total;
    } else if (inv.status === 'pending' || inv.status === 'partial') {
      map[key].unpaid += total;
    } else if (inv.status === 'paid') {
      const due = inv.dueDate ? new Date(inv.dueDate) : null;
      const paidAt = inv.paidDate ? new Date(inv.paidDate) : null;
      const paidOnTime = !due || !paidAt || paidAt.getTime() <= due.getTime() + 86400000;
      if (paidOnTime) map[key].onTime += total;
      else map[key].paid += total;
    }
  }

  return Object.keys(map).sort().map((k) => {
    const row = map[k];
    return {
      month: row.month,
      paid: Math.round(row.paid * 100) / 100,
      unpaid: Math.round(row.unpaid * 100) / 100,
      onTime: Math.round(row.onTime * 100) / 100,
      overdue: Math.round(row.overdue * 100) / 100,
    };
  });
}

async function buildChartPayments(orgId, monthsBack = 12) {
  const now = new Date();
  const start = startOfMonthUTC(now.getUTCFullYear(), now.getUTCMonth() - (monthsBack - 1));
  const end = addMonthsUTC(startOfMonthUTC(now.getUTCFullYear(), now.getUTCMonth()), 1);

  const map = {};
  for (let i = 0; i < monthsBack; i++) {
    const d = addMonthsUTC(start, i);
    map[monthKey(d)] = { month: monthKey(d), ...emptyMonthPayments() };
  }

  const payRows = await db.select({
    amount: payments.amount,
    method: payments.method,
    paymentDate: payments.paymentDate,
  }).from(payments)
    .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
    .where(and(
      orgFilter(invoices, orgId),
      gte(payments.paymentDate, start),
      lt(payments.paymentDate, end),
    ));

  for (const p of payRows) {
    const key = monthKey(new Date(p.paymentDate));
    if (!map[key]) continue;
    const method = ['cash', 'transfer', 'card', 'flow'].includes(p.method) ? p.method : 'other';
    map[key][method] += toNum(p.amount);
  }

  return Object.keys(map).sort().map((k) => {
    const row = map[k];
    return {
      month: row.month,
      cash: Math.round(row.cash * 100) / 100,
      transfer: Math.round(row.transfer * 100) / 100,
      card: Math.round(row.card * 100) / 100,
      flow: Math.round(row.flow * 100) / 100,
    };
  });
}

/** Desglose tipo resumen para un mes calendario (fila 2 del dashboard) */
async function monthBreakdown(orgId, year, monthIndex) {
  const start = startOfMonthUTC(year, monthIndex);
  const end = addMonthsUTC(start, 1);
  const summary = await summarizeInvoicesAndPayments(orgId, start, end);
  return {
    month: monthKey(start),
    label: start.toLocaleDateString('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    ...summary,
  };
}

// GET /api/finance/summary?period=month|quarter|year
financeRouter.get('/summary', requireRole('admin', 'office'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;

    const period = ['month', 'quarter', 'year'].includes(req.query.period)
      ? req.query.period
      : 'month';
    const ranges = periodRanges(period);
    const now = new Date();

    const [current, previous, next, chartInvoicing, chartPayments, monthPrev, monthCurr, monthNext] = await Promise.all([
      summarizeInvoicesAndPayments(orgId, ranges.currentStart, ranges.currentEnd),
      summarizeInvoicesAndPayments(orgId, ranges.previousStart, ranges.previousEnd),
      projectNextPeriod(orgId),
      buildChartInvoicing(orgId, 12),
      buildChartPayments(orgId, 12),
      monthBreakdown(orgId, now.getUTCFullYear(), now.getUTCMonth() - 1),
      monthBreakdown(orgId, now.getUTCFullYear(), now.getUTCMonth()),
      (async () => {
        const proj = await projectNextPeriod(orgId);
        const d = addMonthsUTC(startOfMonthUTC(now.getUTCFullYear(), now.getUTCMonth()), 1);
        return {
          month: monthKey(d),
          label: d.toLocaleDateString('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
          ...proj,
        };
      })(),
    ]);

    res.json({
      period,
      current,
      previous,
      next,
      months: { previous: monthPrev, current: monthCurr, next: monthNext },
      chartInvoicing,
      chartPayments,
    });
  } catch (error) {
    console.error('[finance/summary]', error);
    res.status(500).json({ error: error.message || 'Error al obtener resumen financiero' });
  }
});

// GET /api/finance/expenses?month=YYYY-MM
financeRouter.get('/expenses', requireRole('admin', 'office'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;

    const month = String(req.query.month || '').trim();
    const conditions = [orgFilter(expenses, orgId)];

    if (/^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-').map(Number);
      const start = startOfMonthUTC(y, m - 1);
      const startStr = `${y}-${pad2(m)}-01`;
      const endDate = addMonthsUTC(start, 1);
      const endStr = `${endDate.getUTCFullYear()}-${pad2(endDate.getUTCMonth() + 1)}-01`;
      conditions.push(gte(expenses.date, startStr));
      conditions.push(lt(expenses.date, endStr));
    }

    const rows = await db.select().from(expenses)
      .where(and(...conditions))
      .orderBy(sql`${expenses.date} DESC`, sql`${expenses.id} DESC`);

    res.json(rows);
  } catch (error) {
    console.error('[finance/expenses GET]', error);
    res.status(500).json({ error: error.message || 'Error al listar egresos' });
  }
});

financeRouter.post('/expenses', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;

    const { date, amount, category, description, provider, invoiceNumber } = req.body || {};
    if (!date || amount == null || amount === '') {
      return res.status(400).json({ error: 'date y amount son requeridos' });
    }
    const cat = EXPENSE_CATEGORIES.includes(category) ? category : 'other';
    const amt = toNum(amount);
    if (amt <= 0) return res.status(400).json({ error: 'amount debe ser mayor a 0' });

    const [row] = await db.insert(expenses).values({
      organizationId: orgId,
      date: String(date).slice(0, 10),
      amount: String(amt),
      category: cat,
      description: description || null,
      provider: provider || null,
      invoiceNumber: invoiceNumber || null,
    }).returning();

    res.status(201).json(row);
  } catch (error) {
    console.error('[finance/expenses POST]', error);
    res.status(500).json({ error: error.message || 'Error al crear egreso' });
  }
});

financeRouter.put('/expenses/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'id inválido' });

    const [existing] = await db.select().from(expenses)
      .where(and(eq(expenses.id, id), orgFilter(expenses, orgId)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: 'Egreso no encontrado' });

    const { date, amount, category, description, provider, invoiceNumber } = req.body || {};
    const patch = { updatedAt: new Date() };
    if (date != null) patch.date = String(date).slice(0, 10);
    if (amount != null && amount !== '') {
      const amt = toNum(amount);
      if (amt <= 0) return res.status(400).json({ error: 'amount debe ser mayor a 0' });
      patch.amount = String(amt);
    }
    if (category != null) {
      if (!EXPENSE_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: 'categoría inválida' });
      }
      patch.category = category;
    }
    if (description !== undefined) patch.description = description || null;
    if (provider !== undefined) patch.provider = provider || null;
    if (invoiceNumber !== undefined) patch.invoiceNumber = invoiceNumber || null;

    const [row] = await db.update(expenses).set(patch)
      .where(and(eq(expenses.id, id), orgFilter(expenses, orgId)))
      .returning();

    res.json(row);
  } catch (error) {
    console.error('[finance/expenses PUT]', error);
    res.status(500).json({ error: error.message || 'Error al actualizar egreso' });
  }
});

financeRouter.delete('/expenses/:id', requireRole('admin'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'id inválido' });

    const deleted = await db.delete(expenses)
      .where(and(eq(expenses.id, id), orgFilter(expenses, orgId)))
      .returning({ id: expenses.id });

    if (!deleted.length) return res.status(404).json({ error: 'Egreso no encontrado' });
    res.json({ message: 'Egreso eliminado', id });
  } catch (error) {
    console.error('[finance/expenses DELETE]', error);
    res.status(500).json({ error: error.message || 'Error al eliminar egreso' });
  }
});

// GET /api/finance/export.csv?period=month|quarter|year
financeRouter.get('/export.csv', requireRole('admin', 'office'), async (req, res) => {
  try {
    const orgId = requireOrganizationId(req, res);
    if (!orgId) return;

    const period = ['month', 'quarter', 'year'].includes(req.query.period)
      ? req.query.period
      : 'month';
    const { currentStart, currentEnd } = periodRanges(period);

    const payRows = await db.select({
      id: payments.id,
      amount: payments.amount,
      method: payments.method,
      paymentDate: payments.paymentDate,
      reference: payments.reference,
      invoiceNumber: invoices.invoiceNumber,
    }).from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(and(
        orgFilter(invoices, orgId),
        gte(payments.paymentDate, currentStart),
        lt(payments.paymentDate, currentEnd),
      ));

    const startStr = currentStart.toISOString().slice(0, 10);
    const endStr = currentEnd.toISOString().slice(0, 10);

    const expRows = await db.select().from(expenses).where(and(
      orgFilter(expenses, orgId),
      gte(expenses.date, startStr),
      lt(expenses.date, endStr),
    ));

    const esc = (v) => {
      const s = v == null ? '' : String(v);
      if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const lines = ['tipo;fecha;referencia;detalle;metodo_categoria;monto'];
    for (const p of payRows) {
      lines.push([
        'ingreso',
        p.paymentDate ? new Date(p.paymentDate).toISOString().slice(0, 10) : '',
        p.invoiceNumber || '',
        p.reference || 'Pago',
        p.method || '',
        toNum(p.amount),
      ].map(esc).join(';'));
    }
    for (const e of expRows) {
      lines.push([
        'egreso',
        e.date || '',
        e.invoiceNumber || '',
        e.description || e.provider || '',
        e.category || '',
        toNum(e.amount),
      ].map(esc).join(';'));
    }

    const csv = '\uFEFF' + lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="finanzas-${period}-${startStr}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('[finance/export]', error);
    res.status(500).json({ error: error.message || 'Error al exportar' });
  }
});
