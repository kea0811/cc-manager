import { beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDb, getDb, closeDb } from '../db/index.js';

// Use in-memory database for tests
process.env.DATABASE_PATH = ':memory:';

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  const db = getDb();
  // Clear all data between tests
  db.exec('DELETE FROM chat_messages');
  db.exec('DELETE FROM projects');
});

afterAll(() => {
  closeDb();
});
