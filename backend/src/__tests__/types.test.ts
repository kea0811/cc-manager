import { describe, it, expect } from 'vitest';
import {
  ProjectStatusSchema,
  CreateProjectSchema,
  UpdateProjectSchema,
  ProjectSchema,
  ChatRoleSchema,
  CreateChatMessageSchema,
  ChatMessageSchema,
  UpdateEditorSchema,
} from '../types/index.js';

describe('Type Schemas', () => {
  describe('ProjectStatusSchema', () => {
    it('accepts valid statuses', () => {
      expect(ProjectStatusSchema.parse('draft')).toBe('draft');
      expect(ProjectStatusSchema.parse('development')).toBe('development');
    });

    it('rejects invalid statuses', () => {
      expect(() => ProjectStatusSchema.parse('invalid')).toThrow();
    });
  });

  describe('CreateProjectSchema', () => {
    it('validates valid project creation data', () => {
      const result = CreateProjectSchema.parse({ name: 'Test Project' });
      expect(result).toEqual({ name: 'Test Project' });
    });

    it('accepts optional description', () => {
      const result = CreateProjectSchema.parse({
        name: 'Test',
        description: 'A description',
      });
      expect(result.description).toBe('A description');
    });

    it('rejects empty name', () => {
      expect(() => CreateProjectSchema.parse({ name: '' })).toThrow();
    });

    it('rejects name exceeding 255 characters', () => {
      expect(() => CreateProjectSchema.parse({ name: 'a'.repeat(256) })).toThrow();
    });
  });

  describe('UpdateProjectSchema', () => {
    it('accepts partial updates', () => {
      expect(UpdateProjectSchema.parse({ name: 'New Name' })).toEqual({ name: 'New Name' });
      expect(UpdateProjectSchema.parse({ description: 'New desc' })).toEqual({ description: 'New desc' });
      expect(UpdateProjectSchema.parse({ status: 'development' })).toEqual({ status: 'development' });
    });

    it('validates github repo as URL', () => {
      const result = UpdateProjectSchema.parse({ githubRepo: 'https://github.com/test/repo' });
      expect(result.githubRepo).toBe('https://github.com/test/repo');
    });

    it('rejects invalid github repo URL', () => {
      expect(() => UpdateProjectSchema.parse({ githubRepo: 'not-a-url' })).toThrow();
    });
  });

  describe('ProjectSchema', () => {
    it('validates full project object', () => {
      const project = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test',
        description: null,
        githubRepo: null,
        status: 'draft' as const,
        editorContent: '',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      expect(ProjectSchema.parse(project)).toEqual(project);
    });
  });

  describe('ChatRoleSchema', () => {
    it('accepts valid roles', () => {
      expect(ChatRoleSchema.parse('user')).toBe('user');
      expect(ChatRoleSchema.parse('assistant')).toBe('assistant');
    });

    it('rejects invalid roles', () => {
      expect(() => ChatRoleSchema.parse('system')).toThrow();
    });
  });

  describe('CreateChatMessageSchema', () => {
    it('validates valid message', () => {
      const result = CreateChatMessageSchema.parse({ role: 'user', content: 'Hello' });
      expect(result).toEqual({ role: 'user', content: 'Hello' });
    });

    it('rejects empty content', () => {
      expect(() => CreateChatMessageSchema.parse({ role: 'user', content: '' })).toThrow();
    });
  });

  describe('ChatMessageSchema', () => {
    it('validates full chat message', () => {
      const message = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        projectId: '550e8400-e29b-41d4-a716-446655440001',
        role: 'user' as const,
        content: 'Hello',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(ChatMessageSchema.parse(message)).toEqual(message);
    });
  });

  describe('UpdateEditorSchema', () => {
    it('validates editor content', () => {
      expect(UpdateEditorSchema.parse({ content: '# Markdown' })).toEqual({ content: '# Markdown' });
    });

    it('accepts empty content', () => {
      expect(UpdateEditorSchema.parse({ content: '' })).toEqual({ content: '' });
    });
  });
});
