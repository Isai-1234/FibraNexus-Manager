/**
 * Stub DTE — fallback Fase 3 (sin SII real).
 * Mantiene orgs sin proveedor configurado operando igual que antes.
 */
import crypto from 'crypto';

export function createStubDteProvider(meta = {}) {
  return {
    name: 'stub',
    mode: 'stub',
    configured: false,
    ambiente: meta.ambiente || 'certificacion',

    async testConnection() {
      return {
        ok: true,
        mode: 'stub',
        provider: 'stub',
        message: 'Modo stub: no hay proveedor DTE configurado. Emisión simulada localmente.',
      };
    },

    async emitirDTE(datos = {}) {
      const folio = datos.folio || Math.floor(1000 + Math.random() * 9000);
      const trackId = `STUB-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      return {
        ok: true,
        mode: 'stub',
        provider: 'stub',
        dteId: trackId,
        folio,
        tipoDte: datos.tipoDte || 33,
        trackId,
        estado: 'simulado',
        message: 'DTE simulado (stub). Configure SimpleFactura/SimpleAPI para emisión real.',
        raw: null,
      };
    },

    async consultarEstado(dteId) {
      return {
        ok: true,
        mode: 'stub',
        provider: 'stub',
        dteId: String(dteId),
        estado: 'simulado',
        message: 'Consulta simulada — stub no habla con el SII.',
        raw: null,
      };
    },

    async anularDTE(dteId, motivo = '') {
      return {
        ok: true,
        mode: 'stub',
        provider: 'stub',
        dteId: String(dteId),
        estado: 'anulado_simulado',
        message: motivo
          ? `Anulación simulada: ${motivo}`
          : 'Anulación simulada (stub). En producción use Nota de Crédito (tipo 61).',
        raw: null,
      };
    },
  };
}
