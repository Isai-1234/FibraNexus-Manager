/**
 * Adapter SimpleFactura / SimpleAPI (ChileSystems).
 * REST: https://api.simpleapi.cl/api/v1/
 * Auth: Authorization Basic base64("api:" + apiKey) — según SimpleSDK oficial.
 *
 * Nota: emitir/consultar/anular reales suelen requerir certificado digital (.pfx)
 * y CAF además del API key. testConnection valida la key sin archivos.
 */
import { createStubDteProvider } from './stub.js';

const DEFAULT_BASE = 'https://api.simpleapi.cl/api/v1';

function basicAuthHeader(apiKey) {
  const token = Buffer.from(`api:${apiKey}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function resolveBaseUrl(settings = {}) {
  const custom = String(settings.dteApiUrl || '').trim().replace(/\/+$/, '');
  if (custom) return custom.endsWith('/api/v1') ? custom : `${custom}/api/v1`;
  return DEFAULT_BASE;
}

function ambienteToCodigo(ambiente) {
  // SimpleSDK / SII: 0 = certificación, 1 = producción
  return ambiente === 'produccion' ? 1 : 0;
}

/** Construye payload DTE JSON compatible con SimpleAPI (subset). */
export function buildSimpleApiDtePayload(datos, settings) {
  const tipoDte = Number(datos.tipoDte || 33);
  const folio = Number(datos.folio || 0);
  const emisorRut = String(datos.emisorRut || settings.dteRutEmisor || '').trim();
  const emisorRazon = String(datos.emisorRazonSocial || settings.dteRazonSocial || '').trim();
  const receptor = datos.receptor || {};
  const items = Array.isArray(datos.items) ? datos.items : [];

  const detalles = items.map((it, idx) => ({
    NroLinDet: idx + 1,
    NmbItem: String(it.nombre || it.name || `Item ${idx + 1}`).slice(0, 80),
    QtyItem: Number(it.cantidad ?? it.qty ?? 1),
    PrcItem: Number(it.precio ?? it.price ?? 0),
    MontoItem: Number(it.monto ?? it.total ?? ((it.cantidad ?? 1) * (it.precio ?? 0))),
    ...(it.descripcion ? { DscItem: String(it.descripcion).slice(0, 1000) } : {}),
  }));

  const neto = Number(datos.neto ?? detalles.reduce((s, d) => s + Number(d.MontoItem || 0), 0));
  const iva = Number(datos.iva ?? Math.round(neto * 0.19));
  const total = Number(datos.total ?? (neto + iva));

  return {
    Documento: {
      Encabezado: {
        IdDoc: {
          TipoDTE: tipoDte,
          Folio: folio || undefined,
          FchEmis: datos.fechaEmision || new Date().toISOString().slice(0, 10),
        },
        Emisor: {
          RUTEmisor: emisorRut,
          RznSoc: emisorRazon,
          GiroEmis: String(datos.emisorGiro || 'Servicios de telecomunicaciones').slice(0, 80),
          DirOrigen: String(datos.emisorDireccion || 'Chile').slice(0, 70),
          CmnaOrigen: String(datos.emisorComuna || 'Santiago').slice(0, 20),
        },
        Receptor: {
          RUTRecep: String(receptor.rut || '').trim(),
          RznSocRecep: String(receptor.razonSocial || receptor.nombre || '').trim().slice(0, 100),
          DirRecep: String(receptor.direccion || 'Sin dirección').slice(0, 70),
          CmnaRecep: String(receptor.comuna || 'Santiago').slice(0, 20),
        },
        Totales: {
          MntNeto: neto,
          TasaIVA: 19,
          IVA: iva,
          MntTotal: total,
        },
      },
      Detalle: detalles,
    },
    ...(datos.certificadoPassword
      ? {
          Certificado: {
            Password: String(datos.certificadoPassword),
          },
        }
      : {}),
  };
}

export function createSimpleFacturaDteProvider(settings = {}) {
  const apiKey = String(settings.dteApiKey || '').trim();
  if (!apiKey) {
    return createStubDteProvider({ ambiente: settings.dteAmbiente });
  }

  const baseUrl = resolveBaseUrl(settings);
  const ambiente = settings.dteAmbiente === 'produccion' ? 'produccion' : 'certificacion';

  async function request(path, { method = 'POST', body, formData } = {}) {
    const url = `${baseUrl.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
    const headers = {
      Authorization: basicAuthHeader(apiKey),
      Accept: 'application/json, text/plain, */*',
    };
    let payload;
    if (formData) {
      payload = formData;
    } else if (body != null) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      payload = JSON.stringify(body);
    }
    const res = await fetch(url, { method, headers, body: payload });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* XML u otro */ }
    return { ok: res.ok, status: res.status, text, json };
  }

  return {
    name: 'simplefactura',
    mode: 'live',
    configured: true,
    ambiente,
    baseUrl,

    /**
     * Valida API key contra SimpleAPI sin certificado.
     * 401/403 → key inválida; otros códigos indican que el auth pasó o el endpoint respondió.
     */
    async testConnection() {
      const probe = await request('dte/generar', {
        method: 'POST',
        body: {
          Documento: {
            Encabezado: {
              IdDoc: { TipoDTE: 33, FchEmis: new Date().toISOString().slice(0, 10) },
              Emisor: {
                RUTEmisor: settings.dteRutEmisor || '11111111-1',
                RznSoc: settings.dteRazonSocial || 'FibraNexus Test',
              },
              Receptor: { RUTRecep: '66666666-6', RznSocRecep: 'Cliente Test' },
              Totales: { MntNeto: 1000, TasaIVA: 19, IVA: 190, MntTotal: 1190 },
            },
            Detalle: [{ NroLinDet: 1, NmbItem: 'Test', QtyItem: 1, PrcItem: 1000, MontoItem: 1000 }],
          },
          Ambiente: ambienteToCodigo(ambiente),
        },
      });

      if (probe.status === 401 || probe.status === 403) {
        return {
          ok: false,
          mode: 'live',
          provider: 'simplefactura',
          ambiente,
          message: 'API key rechazada por SimpleAPI (401/403). Verifica la key en simpleapi.cl.',
          httpStatus: probe.status,
          detail: (probe.text || '').slice(0, 400),
        };
      }

      // Key aceptada a nivel auth; falta cert/CAF es esperado en este probe
      const hint = (probe.text || '').toLowerCase();
      const expectsFiles = /cert|caf|file|archivo|multipart|pfx/.test(hint) || probe.status >= 400;

      return {
        ok: true,
        mode: 'live',
        provider: 'simplefactura',
        ambiente,
        message: expectsFiles
          ? 'Conexión OK: API key válida. La emisión real requiere certificado digital y CAF en el payload.'
          : 'Conexión OK con SimpleAPI.',
        httpStatus: probe.status,
        detail: (probe.text || '').slice(0, 400),
      };
    },

    async emitirDTE(datos = {}) {
      const hasCert = Boolean(datos.certificadoPfxBase64 || datos.certificadoPath);
      const hasCaf = Boolean(datos.cafXml || datos.cafXmlBase64 || datos.cafPath);

      if (!hasCert || !hasCaf) {
        return {
          ok: false,
          mode: 'live',
          provider: 'simplefactura',
          message:
            'SimpleAPI requiere certificado digital (.pfx) y archivo CAF además del API key. '
            + 'Envía certificadoPfxBase64 + certificadoPassword + cafXml (o cafXmlBase64) en el body de emitir.',
          code: 'MISSING_CERT_OR_CAF',
        };
      }

      const dteJson = buildSimpleApiDtePayload(datos, settings);
      dteJson.Ambiente = ambienteToCodigo(ambiente);

      // Multipart como SimpleSDK: input (JSON) + file cert + file CAF
      const form = new FormData();
      form.append('input', JSON.stringify(dteJson));

      const certBuf = Buffer.from(String(datos.certificadoPfxBase64), 'base64');
      form.append('file', new Blob([certBuf]), `cert_${Date.now()}.pfx`);

      const cafRaw = datos.cafXml
        ? Buffer.from(String(datos.cafXml), 'utf8')
        : Buffer.from(String(datos.cafXmlBase64), 'base64');
      form.append('file', new Blob([cafRaw]), `caf_${Date.now()}.xml`);

      const url = `${baseUrl.replace(/\/+$/, '')}/dte/generar`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: basicAuthHeader(apiKey) },
        body: form,
      });
      const text = await res.text();

      if (!res.ok) {
        return {
          ok: false,
          mode: 'live',
          provider: 'simplefactura',
          message: `SimpleAPI dte/generar falló (${res.status})`,
          httpStatus: res.status,
          detail: text.slice(0, 1000),
        };
      }

      return {
        ok: true,
        mode: 'live',
        provider: 'simplefactura',
        dteId: datos.folio ? `folio-${datos.folio}` : `sf-${Date.now()}`,
        folio: datos.folio || null,
        tipoDte: datos.tipoDte || 33,
        estado: 'generado',
        message: 'XML DTE generado por SimpleAPI. Siguiente paso: envío al SII (envio/enviar).',
        xml: text,
        raw: text.slice(0, 2000),
      };
    },

    async consultarEstado(dteId, extras = {}) {
      if (!extras.certificadoPfxBase64) {
        return {
          ok: false,
          mode: 'live',
          provider: 'simplefactura',
          message: 'consultarEstado en SimpleAPI requiere certificadoPfxBase64 (+ password) y datos del DTE.',
          code: 'MISSING_CERT',
          dteId: String(dteId),
        };
      }

      const consulta = {
        TrackId: String(dteId),
        Ambiente: ambienteToCodigo(ambiente),
        RutEmpresa: settings.dteRutEmisor || extras.rutEmpresa,
        Certificado: { Password: extras.certificadoPassword || '' },
        ...(extras.folio != null ? { Folio: Number(extras.folio) } : {}),
        ...(extras.tipoDte != null ? { TipoDTE: Number(extras.tipoDte) } : {}),
      };

      const form = new FormData();
      form.append('input', JSON.stringify(consulta));
      const certBuf = Buffer.from(String(extras.certificadoPfxBase64), 'base64');
      form.append('file', new Blob([certBuf]), `cert_${Date.now()}.pfx`);

      const url = `${baseUrl.replace(/\/+$/, '')}/estado/dte`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: basicAuthHeader(apiKey) },
        body: form,
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* ignore */ }

      return {
        ok: res.ok,
        mode: 'live',
        provider: 'simplefactura',
        dteId: String(dteId),
        estado: json?.Estado || (res.ok ? 'consultado' : 'error'),
        message: res.ok ? 'Consulta SII vía SimpleAPI' : `Error consulta (${res.status})`,
        raw: json || text.slice(0, 1000),
      };
    },

    async anularDTE(dteId, motivo = '') {
      // SimpleAPI no tiene “anular” directo: se emite Nota de Crédito (61).
      return {
        ok: false,
        mode: 'live',
        provider: 'simplefactura',
        dteId: String(dteId),
        code: 'USE_CREDIT_NOTE',
        message:
          'Para anular un DTE en Chile debes emitir una Nota de Crédito (tipo 61) referenciando el documento. '
          + (motivo ? `Motivo: ${motivo}` : 'Usa POST emitir con tipoDte=61 y referencias.'),
      };
    },
  };
}
