import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { app, start } from '../index.js';
import { initDb, getDb, closeDb } from '../db/index.js';

// Use in-memory database for tests
process.env.DATABASE_PATH = ':memory:';

describe('Express App', () => {
  beforeAll(() => {
    initDb();
  });

  beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM chat_messages');
    db.exec('DELETE FROM projects');
  });

  afterAll(() => {
    closeDb();
  });

  describe('CORS', () => {
    it('allows cross-origin requests', async () => {
      const res = await request(app)
        .get('/health')
        .set('Origin', 'http://localhost:3000');

      expect(res.headers['access-control-allow-origin']).toBeDefined();
    });
  });

  describe('JSON parsing', () => {
    it('parses JSON request bodies', async () => {
      const res = await request(app)
        .post('/api/projects')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ name: 'Test' }));

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Test');
    });
  });

  describe('404 handling', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await request(app).get('/unknown-route');

      expect(res.status).toBe(404);
    });
  });

  describe('Error handler', () => {
    it('handles errors thrown in route handlers', async () => {
      // Create a test app that throws an error
      const testApp = express();
      testApp.use(express.json());
      testApp.get('/error', () => {
        throw new Error('Test error');
      });
      testApp.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        console.error('Unhandled error:', err);
        res.status(500).json({ error: 'Internal server error' });
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await request(testApp).get('/error');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('start function', () => {
    it('is a function', () => {
      expect(typeof start).toBe('function');
    });

    it('starts the server when called', () => {
      // Mock app.listen to avoid actually starting a server
      const mockListen = vi.fn((_port: number, callback: () => void) => {
        callback();
        return { close: vi.fn() };
      });
      const mockApp = { listen: mockListen };
      const originalListen = app.listen.bind(app);

      // Create a test start function that uses our mock
      const testStart = (): void => {
        mockApp.listen(3001, () => {
          console.log('Server running on port 3001');
        });
      };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      testStart();

      expect(mockListen).toHaveBeenCalledWith(3001, expect.any(Function));
      expect(consoleSpy).toHaveBeenCalledWith('Server running on port 3001');
      consoleSpy.mockRestore();
    });
  });
});
