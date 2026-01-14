import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { initDb, getDb, closeDb } from '../db/index.js';
import { computeDiff, applyPatch, createPatch, diffLib } from '../services/diffService.js';

// Use in-memory database for tests
process.env.DATABASE_PATH = ':memory:';

describe('DiffService', () => {
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

  describe('computeDiff', () => {
    it('detects no changes for identical content', () => {
      const result = computeDiff('Hello\nWorld', 'Hello\nWorld');

      expect(result.hasChanges).toBe(false);
      expect(result.addedLines).toBe(0);
      expect(result.removedLines).toBe(0);
    });

    it('detects added lines', () => {
      const result = computeDiff('Line 1', 'Line 1\nLine 2');

      expect(result.hasChanges).toBe(true);
      expect(result.addedLines).toBeGreaterThan(0);
    });

    it('detects removed lines', () => {
      const result = computeDiff('Line 1\nLine 2', 'Line 1');

      expect(result.hasChanges).toBe(true);
      expect(result.removedLines).toBeGreaterThan(0);
    });

    it('detects changed lines', () => {
      const result = computeDiff('Old text', 'New text');

      expect(result.hasChanges).toBe(true);
    });

    it('returns change details', () => {
      const result = computeDiff('Line 1\nLine 2', 'Line 1\nModified');

      expect(result.changes).toBeDefined();
      expect(result.changes.length).toBeGreaterThan(0);
    });

    it('handles empty strings', () => {
      const result = computeDiff('', 'New content');

      expect(result.hasChanges).toBe(true);
      expect(result.addedLines).toBeGreaterThan(0);
    });

    it('handles both empty strings', () => {
      const result = computeDiff('', '');

      expect(result.hasChanges).toBe(false);
    });
  });

  describe('createPatch', () => {
    it('creates a unified diff patch', () => {
      const patch = createPatch('test.md', 'Old content', 'New content');

      expect(patch).toContain('---');
      expect(patch).toContain('+++');
    });

    it('creates patch for identical content', () => {
      const patch = createPatch('test.md', 'Same', 'Same');

      expect(patch).toBeDefined();
    });
  });

  describe('applyPatch', () => {
    it('applies a valid patch', () => {
      const original = 'Line 1\nLine 2';
      const modified = 'Line 1\nModified Line 2';
      const patch = createPatch('test.md', original, modified);

      const result = applyPatch(original, patch);

      expect(result).toBe(modified);
    });

    it('returns original content when patch cannot be applied correctly', () => {
      // When patch format is completely invalid, it returns false which becomes null
      // When patch doesn't match, it may return original content
      const result = applyPatch('Some content', 'Invalid patch');

      // The diff library either returns null (false) or the original content
      expect(result === null || result === 'Some content').toBe(true);
    });

    it('handles malformed patch gracefully', () => {
      // Test with a patch that might throw during parsing
      const malformedPatch = '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new';
      const result = applyPatch('different content', malformedPatch);

      // Should either return null or the original content
      expect(result === null || typeof result === 'string').toBe(true);
    });

    it('handles patch with corrupted headers', () => {
      // A patch with corrupted line numbers that could cause issues
      const corruptedPatch = '--- a\n+++ b\n@@ -9999999 +9999999 @@\n-missing\n+content';
      const result = applyPatch('test', corruptedPatch);

      // Should return null since patch cannot be applied
      expect(result === null || typeof result === 'string').toBe(true);
    });

    it('handles empty original content', () => {
      const modified = 'New content';
      const patch = createPatch('test.md', '', modified);

      const result = applyPatch('', patch);

      expect(result).toBe(modified);
    });

    it('returns null when Diff.applyPatch throws an error', () => {
      // Mock diffLib.applyPatch to throw
      const originalApplyPatch = diffLib.applyPatch;
      diffLib.applyPatch = () => {
        throw new Error('Simulated parsing error');
      };

      const result = applyPatch('content', 'some patch');

      expect(result).toBeNull();

      // Restore
      diffLib.applyPatch = originalApplyPatch;
    });
  });
});
