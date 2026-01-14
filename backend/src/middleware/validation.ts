import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema, ZodError } from 'zod';

export const formatZodError = (error: ZodError): string => {
  return error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
};

export const validateBody = <T>(schema: ZodSchema<T>) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: formatZodError(result.error) });
      return;
    }
    req.body = result.data;
    next();
  };
};

export const validateParams = <T>(schema: ZodSchema<T>) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      res.status(400).json({ error: formatZodError(result.error) });
      return;
    }
    next();
  };
};
