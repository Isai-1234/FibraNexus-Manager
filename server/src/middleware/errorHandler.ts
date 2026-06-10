import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.error('Error:', err);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (err.name === 'ZodError') {
    return res.status(400).json({ error: 'Error de validación', details: err.errors });
  }

  return res.status(500).json({ error: 'Error interno del servidor' });
}
