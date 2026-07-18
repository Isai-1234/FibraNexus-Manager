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

export function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const msg = result.error.errors.map((e) => e.message).join('; ');
    return { error: msg, data: null };
  }
  return { error: null, data: result.data };
}
