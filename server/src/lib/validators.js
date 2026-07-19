import { z } from 'zod';

export const passwordSchema = z.string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .regex(/[A-Za-z]/, 'Debe incluir letras')
  .regex(/[0-9]/, 'Debe incluir números');

export const loginSchema = z.object({
  email: z.string().email('Email inválido').max(255),
  password: z.string().min(1, 'Contraseña requerida').max(200),
});

export const registerSchema = z.object({
  companyName: z.string().min(2).max(255),
  email: z.string().email().max(255),
  password: passwordSchema,
  fullName: z.string().min(2).max(255),
  phone: z.string().max(20).optional().nullable(),
});

export const paymentCreateSchema = z.object({
  invoiceId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive('El monto debe ser mayor a 0'),
  method: z.enum(['cash', 'transfer', 'card', 'flow', 'other']),
  reference: z.string().max(255).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  currency: z.string().max(3).default('CLP').optional(),
  idempotencyKey: z.string().min(8).max(64).optional().nullable(),
  /** Override puntual: emitir DTE en este pago sin cambiar dteHabilitado del cliente. */
  emitirDte: z.boolean().optional().nullable(),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

/** Body vacío u opcional — test de conexión DTE usa settings guardados de la org. */
export const dteTestConnectionSchema = z.object({}).passthrough();

const dteItemSchema = z.object({
  nombre: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(80).optional(),
  cantidad: z.coerce.number().positive().optional(),
  qty: z.coerce.number().positive().optional(),
  precio: z.coerce.number().nonnegative().optional(),
  price: z.coerce.number().nonnegative().optional(),
  monto: z.coerce.number().nonnegative().optional(),
  total: z.coerce.number().nonnegative().optional(),
  descripcion: z.string().max(1000).optional(),
}).passthrough();

/** Emitir DTE ligado a una factura interna (aplica reglas dteHabilitado / Flow). */
export const dteEmitirSchema = z.object({
  invoiceId: z.coerce.number().int().positive(),
  paymentMethod: z.enum(['cash', 'transfer', 'card', 'flow', 'other']).optional().nullable(),
  emitirOverride: z.boolean().optional().nullable(),
  tipoDte: z.coerce.number().int().positive().optional(),
  folio: z.coerce.number().int().positive().optional().nullable(),
  receptor: z.object({
    rut: z.string().min(3).max(20).optional(),
    razonSocial: z.string().max(100).optional(),
    nombre: z.string().max(100).optional(),
  }).passthrough().optional(),
  certificadoPfxBase64: z.string().min(20).optional(),
  certificadoPassword: z.string().max(200).optional(),
  cafXml: z.string().min(20).optional(),
  cafXmlBase64: z.string().min(20).optional(),
  items: z.array(dteItemSchema).max(200).optional(),
}).passthrough();

/** Body vacío — importa con credenciales guardadas en settings de la org. */
export const wisphubImportSchema = z.object({}).passthrough();

const optionalMoney = z.union([
  z.null(),
  z.literal(''),
  z.coerce.number().nonnegative(),
]).optional();

export const serviceBillingUpdateSchema = z.object({
  status: z.enum(['active', 'suspended', 'pending', 'cancelled', 'cut']).optional(),
  pppProfile: z.string().max(64).optional().nullable(),
  ipAddress: z.string().max(45).optional().nullable(),
  macAddress: z.string().max(17).optional().nullable(),
  customPrice: optionalMoney,
  contratoTipo: z.enum(['abierto', 'cerrado']).optional(),
  contratoId: z.string().max(64).optional().nullable(),
  costoInstalacion: optionalMoney,
  cargoCancelacionAnticipada: optionalMoney,
  duracionMinimaMeses: z.union([z.null(), z.coerce.number().int().min(0).max(120)]).optional(),
  diaComienzoPeriodo: z.coerce.number().int().min(1).max(31).optional(),
  facturarDesde: z.union([
    z.null(),
    z.literal(''),
    z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Fecha inválida (YYYY-MM o YYYY-MM-DD)'),
  ]).optional(),
  tipoFacturacion: z.enum(['retroactiva', 'anticipada']).optional(),
  prorratearPrimeraFactura: z.boolean().optional(),
  crearFacturaDiasAntes: z.coerce.number().int().min(0).max(60).optional(),
  facturarPorSeparado: z.boolean().optional(),
  aprobarEnviarAutomaticamente: z.boolean().optional(),
  usarCreditoAutomaticamente: z.boolean().optional(),
  tipoDescuento: z.enum(['sin_descuento', 'porcentaje', 'monto_fijo']).optional(),
  valorDescuento: optionalMoney,
  impuestoOverride: z.union([
    z.null(),
    z.literal(''),
    z.coerce.number().min(0).max(100),
  ]).optional(),
  atributosPersonalizados: z.record(z.string().max(120), z.string().max(500)).optional(),
  etiquetaFactura: z.string().max(255).optional().nullable(),
  billingDueDay: z.coerce.number().int().min(0).max(31).optional(),
  notes: z.string().max(4000).optional().nullable(),
}).strict();

export function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const msg = result.error.errors.map((e) => e.message).join('; ');
    return { error: msg, data: null };
  }
  return { error: null, data: result.data };
}
