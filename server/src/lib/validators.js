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

export const dteEmitirSchema = z.object({
  tipoDte: z.coerce.number().int().positive().default(33),
  folio: z.coerce.number().int().positive().optional().nullable(),
  fechaEmision: z.string().max(20).optional(),
  emisorRut: z.string().max(20).optional(),
  emisorRazonSocial: z.string().max(120).optional(),
  emisorGiro: z.string().max(80).optional(),
  emisorDireccion: z.string().max(70).optional(),
  emisorComuna: z.string().max(20).optional(),
  receptor: z.object({
    rut: z.string().min(3).max(20),
    razonSocial: z.string().max(100).optional(),
    nombre: z.string().max(100).optional(),
    direccion: z.string().max(70).optional(),
    comuna: z.string().max(20).optional(),
  }).passthrough(),
  items: z.array(dteItemSchema).min(1).max(200),
  neto: z.coerce.number().nonnegative().optional(),
  iva: z.coerce.number().nonnegative().optional(),
  total: z.coerce.number().nonnegative().optional(),
  certificadoPfxBase64: z.string().min(20).optional(),
  certificadoPassword: z.string().max(200).optional(),
  cafXml: z.string().min(20).optional(),
  cafXmlBase64: z.string().min(20).optional(),
  referencias: z.array(z.record(z.any())).optional(),
}).passthrough();

export function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const msg = result.error.errors.map((e) => e.message).join('; ');
    return { error: msg, data: null };
  }
  return { error: null, data: result.data };
}
