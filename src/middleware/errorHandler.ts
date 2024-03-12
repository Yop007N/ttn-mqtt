import { Request, Response, NextFunction } from 'express';

// Middleware para manejar errores en Express.
export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
  res.status(500).json({ error: err.message });
};
