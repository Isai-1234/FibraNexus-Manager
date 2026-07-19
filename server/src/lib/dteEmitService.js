/**
 * Orquestación DTE post-pago / emitir manual.
 * Aplica decideDteEmission antes de llamar al adapter.
 * No toca paymentGateway.js / orgPayment.js.
 */
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { invoices, clients, users } from '../db/schema.js';
import { orgFilter } from './tenant.js';
import { loadOrgDteSettings, createOrgDteProvider } from './orgDte.js';
import {
  decideDteEmission,
  emitirDTE,
  resolveDteProviderName,
} from './dteProvider.js';

function isFlowMethod(method) {
  return String(method || '').toLowerCase() === 'flow';
}

/** Construye payload mínimo DTE desde factura + cliente. */
export function buildDteDatosFromInvoice({ invoice, client, user, settings, extras = {} }) {
  const total = Number(invoice.total || 0);
  const neto = Math.round(total / 1.19);
  const iva = total - neto;
  const receptorRut = String(client?.rut || extras.receptorRut || '').trim();
  const receptorNombre = String(
    user?.fullName || client?.razonSocial || extras.receptorNombre || 'Cliente',
  ).slice(0, 100);

  return {
    tipoDte: extras.tipoDte || 33,
    folio: extras.folio || undefined,
    fechaEmision: new Date().toISOString().slice(0, 10),
    emisorRut: settings.dteRutEmisor,
    emisorRazonSocial: settings.dteRazonSocial,
    receptor: {
      rut: receptorRut || '66666666-6',
      razonSocial: receptorNombre,
      nombre: receptorNombre,
      direccion: String(client?.address || 'Sin dirección').slice(0, 70),
      comuna: String(client?.city || 'Santiago').slice(0, 20),
    },
    items: [{
      nombre: invoice.invoiceNumber
        ? `Servicio ISP ${invoice.invoiceNumber}`
        : `Factura #${invoice.id}`,
      cantidad: 1,
      precio: neto,
      monto: neto,
    }],
    neto,
    iva,
    total,
    certificadoPfxBase64: extras.certificadoPfxBase64,
    certificadoPassword: extras.certificadoPassword,
    cafXml: extras.cafXml,
    cafXmlBase64: extras.cafXmlBase64,
  };
}

/**
 * Evalúa reglas y emite (o marca Flow) tras pago completo / llamada admin.
 *
 * @param {object} opts
 * @param {number} opts.orgId
 * @param {number} opts.invoiceId
 * @param {string} [opts.paymentMethod]
 * @param {boolean|null|undefined} [opts.emitirOverride] — override puntual sin persistir en cliente
 * @param {object} [opts.extras] — cert/CAF u overrides de payload
 */
export async function maybeEmitDteForPaidInvoice(opts = {}) {
  const {
    orgId,
    invoiceId,
    paymentMethod = null,
    emitirOverride = undefined,
    extras = {},
  } = opts;

  if (!orgId || !invoiceId) {
    return { ok: false, skipped: true, reason: 'missing_ids', message: 'orgId e invoiceId requeridos' };
  }

  const [inv] = await db.select().from(invoices)
    .where(and(eq(invoices.id, invoiceId), orgFilter(invoices, orgId)))
    .limit(1);
  if (!inv) {
    return { ok: false, skipped: true, reason: 'invoice_not_found', message: 'Factura no encontrada' };
  }

  const [client] = await db.select().from(clients)
    .where(and(eq(clients.id, inv.clientId), orgFilter(clients, orgId)))
    .limit(1);
  if (!client) {
    return { ok: false, skipped: true, reason: 'client_not_found', message: 'Cliente no encontrado' };
  }

  let user = null;
  if (client.userId) {
    const rows = await db.select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
    }).from(users).where(eq(users.id, client.userId)).limit(1);
    user = rows[0] || null;
  }

  const loaded = await loadOrgDteSettings(orgId);
  const settings = loaded?.settings || {};

  const dteHabilitado = emitirOverride === undefined || emitirOverride === null
    ? Boolean(client.dteHabilitado)
    : Boolean(emitirOverride);

  const decision = decideDteEmission({
    dteHabilitado,
    paidViaFlow: isFlowMethod(paymentMethod),
    flowDelegacionBoletaActiva: settings.flowDelegacionBoletaActiva !== false,
    dteEmitidoPor: inv.dteEmitidoPor || null,
  });

  // Marcar trazabilidad Flow sin llamar adapter
  if (decision.markAs === 'flow') {
    await db.update(invoices).set({
      dteEmitidoPor: 'flow',
      updatedAt: new Date(),
    }).where(eq(invoices.id, invoiceId));
    return {
      ok: true,
      skipped: true,
      ...decision,
      invoiceId,
      dteEmitidoPor: 'flow',
    };
  }

  if (!decision.emit) {
    return {
      ok: true,
      skipped: true,
      ...decision,
      invoiceId,
      dteEmitidoPor: inv.dteEmitidoPor || null,
    };
  }

  const provider = await createOrgDteProvider(orgId);
  const datos = buildDteDatosFromInvoice({
    invoice: inv,
    client,
    user,
    settings,
    extras,
  });

  if (!client.rut && !extras.receptorRut) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing_rut',
      message: 'El cliente no tiene RUT — no se puede emitir DTE',
      invoiceId,
    };
  }

  const result = await emitirDTE(provider, datos);
  const providerName = resolveDteProviderName(settings);

  if (result.ok && !result.skipped) {
    // Solo persistimos 'simplefactura' cuando el adapter live emitió;
    // stub deja null para no confundir con emisión real SII.
    const mark = providerName === 'simplefactura' ? 'simplefactura' : null;
    if (mark) {
      await db.update(invoices).set({
        dteEmitidoPor: mark,
        updatedAt: new Date(),
      }).where(eq(invoices.id, invoiceId));
    }
    return {
      ...result,
      skipped: false,
      invoiceId,
      dteEmitidoPor: mark,
      decisionReason: decision.reason,
    };
  }

  return {
    ...result,
    invoiceId,
    decisionReason: decision.reason,
  };
}
