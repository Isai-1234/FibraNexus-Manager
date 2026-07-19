/**
 * Factory DTE por organización — selecciona adapter según settings.dteProvider.
 * Interfaz común: emitirDTE(datos), consultarEstado(dteId), anularDTE(dteId).
 *
 * Decisión de emisión (orden estricto, antes de cualquier adapter):
 *  a) dteHabilitado === false → no emitir
 *  b) dteHabilitado === true:
 *     - pago Flow + flowDelegacionBoletaActiva → no emitir (Flow ya hizo boleta);
 *       marcar dteEmitidoPor = 'flow'
 *     - resto → emitir vía adapter
 */
import { createStubDteProvider } from './dteProviders/stub.js';
import { createSimpleFacturaDteProvider } from './dteProviders/simpleFactura.js';

export function resolveDteProviderName(settings = {}) {
  const preferred = String(settings.dteProvider || 'stub').toLowerCase();
  if (preferred === 'simplefactura' && settings.dteApiKey) return 'simplefactura';
  return 'stub';
}

export function getDteProviderStatusFromSettings(settings = {}) {
  const provider = resolveDteProviderName(settings);
  return {
    provider,
    mode: provider === 'stub' ? 'stub' : 'live',
    configured: provider !== 'stub',
    dteProvider: ['stub', 'simplefactura'].includes(String(settings.dteProvider || '').toLowerCase())
      ? String(settings.dteProvider).toLowerCase()
      : (provider === 'stub' ? 'stub' : provider),
    hasDteApiKey: Boolean(settings.dteApiKey || settings._hasDteApiKey),
    dteAmbiente: settings.dteAmbiente === 'produccion' ? 'produccion' : 'certificacion',
    dteRutEmisor: settings.dteRutEmisor || '',
    dteRazonSocial: settings.dteRazonSocial || '',
    flowDelegacionBoletaActiva: settings.flowDelegacionBoletaActiva !== false,
  };
}

/**
 * @param {object} ctx
 * @param {boolean} ctx.dteHabilitado
 * @param {boolean} [ctx.paidViaFlow]
 * @param {boolean} [ctx.flowDelegacionBoletaActiva]
 * @param {string|null} [ctx.dteEmitidoPor]
 */
export function decideDteEmission(ctx = {}) {
  if (ctx.dteEmitidoPor) {
    return {
      emit: false,
      skip: true,
      reason: 'already_emitted',
      markAs: null,
      message: `DTE ya registrado como emitido por ${ctx.dteEmitidoPor}`,
    };
  }

  if (!ctx.dteHabilitado) {
    return {
      emit: false,
      skip: true,
      reason: 'client_disabled',
      markAs: null,
      message: 'Cliente sin facturación electrónica habilitada (dteHabilitado=false)',
    };
  }

  const paidViaFlow = Boolean(ctx.paidViaFlow);
  const flowDelegacion = ctx.flowDelegacionBoletaActiva !== false;

  if (paidViaFlow && flowDelegacion) {
    return {
      emit: false,
      skip: true,
      reason: 'flow_delegation',
      markAs: 'flow',
      message:
        'Pago Flow con delegación de boleta activa en SII — no se emite DTE desde FibraNexus (evita duplicar boleta).',
    };
  }

  return {
    emit: true,
    skip: false,
    reason: 'emit_adapter',
    markAs: null,
    message: 'Emitir vía proveedor DTE configurado',
  };
}

/**
 * @param {object|string} settingsOrName — settings de org (con dteApiKey descifrada) o nombre
 */
export function createDteProvider(settingsOrName = 'stub') {
  if (settingsOrName && typeof settingsOrName === 'object') {
    const provider = resolveDteProviderName(settingsOrName);
    if (provider === 'simplefactura') {
      return createSimpleFacturaDteProvider(settingsOrName);
    }
    return createStubDteProvider({ ambiente: settingsOrName.dteAmbiente });
  }
  return createStubDteProvider();
}

/** Atajos de interfaz común (mismo contrato que los adapters). */
export async function emitirDTE(settingsOrProvider, datos, decisionContext = null) {
  if (decisionContext) {
    const decision = decideDteEmission(decisionContext);
    if (!decision.emit) {
      return {
        ok: true,
        skipped: true,
        ...decision,
        provider: decision.markAs || 'none',
      };
    }
  }

  const p = typeof settingsOrProvider?.emitirDTE === 'function'
    ? settingsOrProvider
    : createDteProvider(settingsOrProvider);
  return p.emitirDTE(datos);
}

export async function consultarEstado(settingsOrProvider, dteId, extras) {
  const p = typeof settingsOrProvider?.consultarEstado === 'function'
    ? settingsOrProvider
    : createDteProvider(settingsOrProvider);
  return p.consultarEstado(dteId, extras);
}

export async function anularDTE(settingsOrProvider, dteId, motivo) {
  const p = typeof settingsOrProvider?.anularDTE === 'function'
    ? settingsOrProvider
    : createDteProvider(settingsOrProvider);
  return p.anularDTE(dteId, motivo);
}
