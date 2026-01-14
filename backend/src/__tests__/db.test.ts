import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getDb, closeDb, initDb, mapProjectRow, mapChatMessageRow } from '../db/index.js';

// Use in-memory database for tests
process.env.DATABASE_PATH = ':memory:';

describe('Database', () => {
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

  describe('getDb', () => {
    it('returns a database instance', () => {
      const db = getDb();
      expect(db).toBeDefined();
    });

    it('returns the same instance on subsequent calls', () => {
      const db1 = getDb();
      const db2 = getDb();
      expect(db1).toBe(db2);
    });
  });

  describe('initDb', () => {
    it('creates projects table', () => {
      const db = getDb();
      const result = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='projects'"
      ).get();
      expect(result).toBeDefined();
    });

    it('creates chat_messages table', () => {
      const db = getDb();
      const result = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'"
      ).get();
      expect(result).toBeDefined();
    });

    it('can be called multiple times without error', () => {
      expect(() => {
        initDb();
        initDb();
      }).not.toThrow();
    });
  });

  describe('mapProjectRow', () => {
    it('maps database row to Project type', () => {
      const row = {
        id: 'test-id',
        name: 'Test Project',
        description: 'A description',
        github_repo: 'https://github.com/test/repo',
        status: 'draft',
        editor_content: '# Content',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      };

      const result = mapProjectRow(row);

      expect(result).toEqual({
        id: 'test-id',
        name: 'Test Project',
        description: 'A description',
        githubRepo: 'https://github.com/test/repo',
        status: 'draft',
        editorContent: '# Content',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
    });

    it('handles null values', () => {
      const row = {
        id: 'test-id',
        name: 'Test',
        description: null,
        github_repo: null,
        status: 'draft',
        editor_content: '',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      };

      const result = mapProjectRow(row);

      expect(result.description).toBeNull();
      expect(result.githubRepo).toBeNull();
    });
  });

  describe('mapChatMessageRow', () => {
    it('maps database row to ChatMessage type', () => {
      const row = {
        id: 'msg-id',
        project_id: 'proj-id',
        role: 'user',
        content: 'Hello',
        created_at: '2024-01-01T00:00:00.000Z',
      };

      const result = mapChatMessageRow(row);

      expect(result).toEqual({
        id: 'msg-id',
        projectId: 'proj-id',
        role: 'user',
        content: 'Hello',
        createdAt: '2024-01-01T00:00:00.000Z',
      });
    });
  });

  describe('closeDb', () => {
    it('closes the database connection', () => {
      closeDb();
      // After closing, getDb should create a new instance
      const db = getDb();
      expect(db).toBeDefined();
    });

    it('can be called multiple times without error', () => {
      expect(() => {
        closeDb();
        closeDb();
      }).not.toThrow();
    });
  });
});
