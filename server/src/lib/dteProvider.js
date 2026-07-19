/**
 * Factory DTE por organización — selecciona adapter según settings.dteProvider.
 * Interfaz común de cada adapter: emitirDTE(datos), consultarEstado(dteId), anularDTE(dteId).
 * No mezcla lógica de Flow/paymentGateway.
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
  };
}

/**
 * @param {object|string} settingsOrName — settings de org (con dteApiKey descifrada) o nombre
 * @returns {{ name, emitirDTE, consultarEstado, anularDTE, testConnection? }}
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
export async function emitirDTE(settingsOrProvider, datos) {
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
