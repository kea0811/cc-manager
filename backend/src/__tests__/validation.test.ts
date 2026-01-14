import { describe, it, expect, vi } from 'vitest';
import { formatZodError, validateBody, validateParams } from '../middleware/validation.js';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

describe('Validation Middleware', () => {
  describe('formatZodError', () => {
    it('formats single error', () => {
      const schema = z.object({ name: z.string() });
      const result = schema.safeParse({ name: 123 });

      if (!result.success) {
        const formatted = formatZodError(result.error);
        expect(formatted).toContain('name');
      }
    });

    it('formats multiple errors', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });
      const result = schema.safeParse({ name: 123, age: 'invalid' });

      if (!result.success) {
        const formatted = formatZodError(result.error);
        expect(formatted).toContain('name');
        expect(formatted).toContain('age');
      }
    });

    it('formats nested path errors', () => {
      const schema = z.object({
        user: z.object({
          email: z.string().email(),
        }),
      });
      const result = schema.safeParse({ user: { email: 'invalid' } });

      if (!result.success) {
        const formatted = formatZodError(result.error);
        expect(formatted).toContain('user.email');
      }
    });
  });

  describe('validateBody', () => {
    const schema = z.object({ name: z.string() });

    it('passes valid data to next middleware', () => {
      const req = { body: { name: 'Test' } } as Request;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      validateBody(schema)(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body).toEqual({ name: 'Test' });
    });

    it('returns 400 for invalid data', () => {
      const req = { body: { name: 123 } } as Request;
      const json = vi.fn();
      const status = vi.fn().mockReturnValue({ json });
      const res = { status } as unknown as Response;
      const next = vi.fn() as NextFunction;

      validateBody(schema)(req, res, next);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
      expect(next).not.toHaveBeenCalled();
    });

    it('transforms and validates data', () => {
      const transformSchema = z.object({
        count: z.coerce.number(),
      });
      const req = { body: { count: '42' } } as Request;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      validateBody(transformSchema)(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body).toEqual({ count: 42 });
    });
  });

  describe('validateParams', () => {
    const schema = z.object({ id: z.string().uuid() });

    it('passes valid params to next middleware', () => {
      const req = { params: { id: '550e8400-e29b-41d4-a716-446655440000' } } as unknown as Request;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      validateParams(schema)(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('returns 400 for invalid params', () => {
      const req = { params: { id: 'invalid' } } as unknown as Request;
      const json = vi.fn();
      const status = vi.fn().mockReturnValue({ json });
      const res = { status } as unknown as Response;
      const next = vi.fn() as NextFunction;

      validateParams(schema)(req, res, next);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });
  });
});
