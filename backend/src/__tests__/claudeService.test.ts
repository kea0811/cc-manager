import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { initDb, getDb, closeDb } from '../db/index.js';
import {
  ClaudeService,
  MockClaudeService,
  createClaudeService,
} from '../services/claudeService.js';

// Use in-memory database for tests
process.env.DATABASE_PATH = ':memory:';

describe('ClaudeService', () => {
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

  describe('createClaudeService', () => {
    it('creates a ClaudeService instance', () => {
      const service = createClaudeService();

      expect(service).toBeInstanceOf(ClaudeService);
    });

    it('accepts configuration options', () => {
      const service = createClaudeService({
        token: 'test-token',
        projectPath: '/test/path',
        ralphMode: true,
      });

      expect(service).toBeInstanceOf(ClaudeService);
    });
  });

  describe('ClaudeService', () => {
    it('returns error when token is not configured', async () => {
      const service = new ClaudeService({ token: '' });

      const response = await service.sendMessage('test');

      expect(response.success).toBe(false);
      expect(response.error).toContain('token not configured');
    });

    it('stop method can be called safely', () => {
      const service = new ClaudeService({ token: '' });

      expect(() => service.stop()).not.toThrow();
    });
  });

  describe('MockClaudeService', () => {
    it('returns successful mock response for sendMessage', async () => {
      const service = new MockClaudeService({ token: '' });

      const response = await service.sendMessage('Hello Claude');

      expect(response.success).toBe(true);
      expect(response.content).toContain('Mock Response');
    });

    it('returns successful mock response for processRequirement', async () => {
      const service = new MockClaudeService({ token: '' });

      const response = await service.processRequirement(
        'Add a new feature',
        '# Existing Content'
      );

      expect(response.success).toBe(true);
      expect(response.content).toContain('Existing Content');
      expect(response.content).toContain('Add a new feature');
    });

    it('creates new content when currentContent is empty', async () => {
      const service = new MockClaudeService({ token: '' });

      const response = await service.processRequirement('First feature', '');

      expect(response.success).toBe(true);
      expect(response.content).toContain('# Project Requirements');
      expect(response.content).toContain('First feature');
    });

    it('truncates long messages in mock response', async () => {
      const service = new MockClaudeService({ token: '' });
      const longMessage = 'A'.repeat(100);

      const response = await service.sendMessage(longMessage);

      expect(response.success).toBe(true);
      expect(response.content).toContain('...');
    });
  });
});
