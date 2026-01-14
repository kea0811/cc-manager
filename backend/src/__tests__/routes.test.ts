import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { initDb, getDb, closeDb } from '../db/index.js';
import { setClaudeServiceFactory, resetClaudeServiceFactory, shouldUseMock, createDefaultFactory } from '../routes/projects.js';
import { ClaudeService, ClaudeResponse, MockClaudeService } from '../services/claudeService.js';

// Use in-memory database for tests
process.env.DATABASE_PATH = ':memory:';

describe('API Routes', () => {
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

  describe('GET /health', () => {
    it('returns health status', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('Projects API', () => {
    describe('GET /api/projects', () => {
      it('returns empty array when no projects', async () => {
        const res = await request(app).get('/api/projects');

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      });

      it('returns all projects', async () => {
        await request(app).post('/api/projects').send({ name: 'Project 1' });
        await request(app).post('/api/projects').send({ name: 'Project 2' });

        const res = await request(app).get('/api/projects');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
      });
    });

    describe('POST /api/projects', () => {
      it('creates a project', async () => {
        const res = await request(app)
          .post('/api/projects')
          .send({ name: 'New Project' });

        expect(res.status).toBe(201);
        expect(res.body.name).toBe('New Project');
        expect(res.body.id).toBeDefined();
        expect(res.body.status).toBe('draft');
      });

      it('creates project with description', async () => {
        const res = await request(app)
          .post('/api/projects')
          .send({ name: 'Test', description: 'A description' });

        expect(res.status).toBe(201);
        expect(res.body.description).toBe('A description');
      });

      it('returns 400 for missing name', async () => {
        const res = await request(app)
          .post('/api/projects')
          .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
      });

      it('returns 400 for empty name', async () => {
        const res = await request(app)
          .post('/api/projects')
          .send({ name: '' });

        expect(res.status).toBe(400);
      });
    });

    describe('GET /api/projects/:id', () => {
      it('returns project by id', async () => {
        const created = await request(app)
          .post('/api/projects')
          .send({ name: 'Test' });

        const res = await request(app).get(`/api/projects/${created.body.id}`);

        expect(res.status).toBe(200);
        expect(res.body.id).toBe(created.body.id);
        expect(res.body.name).toBe('Test');
      });

      it('returns 404 for non-existent project', async () => {
        const res = await request(app).get('/api/projects/non-existent');

        expect(res.status).toBe(404);
        expect(res.body.error).toBe('Project not found');
      });
    });

    describe('PATCH /api/projects/:id', () => {
      it('updates project name', async () => {
        const created = await request(app)
          .post('/api/projects')
          .send({ name: 'Original' });

        const res = await request(app)
          .patch(`/api/projects/${created.body.id}`)
          .send({ name: 'Updated' });

        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Updated');
      });

      it('updates project status', async () => {
        const created = await request(app)
          .post('/api/projects')
          .send({ name: 'Test' });

        const res = await request(app)
          .patch(`/api/projects/${created.body.id}`)
          .send({ status: 'development' });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('development');
      });

      it('updates github repo', async () => {
        const created = await request(app)
          .post('/api/projects')
          .send({ name: 'Test' });

        const res = await request(app)
          .patch(`/api/projects/${created.body.id}`)
          .send({ githubRepo: 'https://github.com/test/repo' });

        expect(res.status).toBe(200);
        expect(res.body.githubRepo).toBe('https://github.com/test/repo');
      });

      it('returns 404 for non-existent project', async () => {
        const res = await request(app)
          .patch('/api/projects/non-existent')
          .send({ name: 'Test' });

        expect(res.status).toBe(404);
      });

      it('returns 400 for invalid github repo URL', async () => {
        const created = await request(app)
          .post('/api/projects')
          .send({ name: 'Test' });

        const res = await request(app)
          .patch(`/api/projects/${created.body.id}`)
          .send({ githubRepo: 'not-a-url' });

        expect(res.status).toBe(400);
      });
    });

    describe('DELETE /api/projects/:id', () => {
      it('deletes project', async () => {
        const created = await request(app)
          .post('/api/projects')
          .send({ name: 'Test' });

        const res = await request(app).delete(`/api/projects/${created.body.id}`);

        expect(res.status).toBe(204);

        const getRes = await request(app).get(`/api/projects/${created.body.id}`);
        expect(getRes.status).toBe(404);
      });

      it('returns 404 for non-existent project', async () => {
        const res = await request(app).delete('/api/projects/non-existent');

        expect(res.status).toBe(404);
      });
    });

    describe('PUT /api/projects/:id/editor', () => {
      it('updates editor content', async () => {
        const created = await request(app)
          .post('/api/projects')
          .send({ name: 'Test' });

        const res = await request(app)
          .put(`/api/projects/${created.body.id}/editor`)
          .send({ content: '# New Content' });

        expect(res.status).toBe(200);
        expect(res.body.editorContent).toBe('# New Content');
      });

      it('returns 404 for non-existent project', async () => {
        const res = await request(app)
          .put('/api/projects/non-existent/editor')
          .send({ content: 'test' });

        expect(res.status).toBe(404);
      });

      it('returns 400 for missing content', async () => {
        const created = await request(app)
          .post('/api/projects')
          .send({ name: 'Test' });

        const res = await request(app)
          .put(`/api/projects/${created.body.id}/editor`)
          .send({});

        expect(res.status).toBe(400);
      });
    });
  });

  describe('Chat API', () => {
    let projectId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({ name: 'Test Project' });
      projectId = res.body.id;
    });

    describe('GET /api/projects/:id/chat', () => {
      it('returns empty chat history', async () => {
        const res = await request(app).get(`/api/projects/${projectId}/chat`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      });

      it('returns chat messages in order', async () => {
        await request(app)
          .post(`/api/projects/${projectId}/chat`)
          .send({ role: 'user', content: 'Hello' });
        await request(app)
          .post(`/api/projects/${projectId}/chat`)
          .send({ role: 'assistant', content: 'Hi!' });

        const res = await request(app).get(`/api/projects/${projectId}/chat`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        expect(res.body[0].content).toBe('Hello');
        expect(res.body[1].content).toBe('Hi!');
      });

      it('returns 404 for non-existent project', async () => {
        const res = await request(app).get('/api/projects/non-existent/chat');

        expect(res.status).toBe(404);
      });
    });

    describe('POST /api/projects/:id/chat', () => {
      it('adds user message', async () => {
        const res = await request(app)
          .post(`/api/projects/${projectId}/chat`)
          .send({ role: 'user', content: 'Hello' });

        expect(res.status).toBe(201);
        expect(res.body.role).toBe('user');
        expect(res.body.content).toBe('Hello');
        expect(res.body.projectId).toBe(projectId);
      });

      it('adds assistant message', async () => {
        const res = await request(app)
          .post(`/api/projects/${projectId}/chat`)
          .send({ role: 'assistant', content: 'Response' });

        expect(res.status).toBe(201);
        expect(res.body.role).toBe('assistant');
      });

      it('returns 404 for non-existent project', async () => {
        const res = await request(app)
          .post('/api/projects/non-existent/chat')
          .send({ role: 'user', content: 'Hello' });

        expect(res.status).toBe(404);
      });

      it('returns 400 for invalid role', async () => {
        const res = await request(app)
          .post(`/api/projects/${projectId}/chat`)
          .send({ role: 'invalid', content: 'Hello' });

        expect(res.status).toBe(400);
      });

      it('returns 400 for empty content', async () => {
        const res = await request(app)
          .post(`/api/projects/${projectId}/chat`)
          .send({ role: 'user', content: '' });

        expect(res.status).toBe(400);
      });

      it('returns 400 for missing fields', async () => {
        const res = await request(app)
          .post(`/api/projects/${projectId}/chat`)
          .send({});

        expect(res.status).toBe(400);
      });
    });

    describe('DELETE /api/projects/:id/chat', () => {
      it('clears chat history', async () => {
        await request(app)
          .post(`/api/projects/${projectId}/chat`)
          .send({ role: 'user', content: 'Hello' });

        const res = await request(app).delete(`/api/projects/${projectId}/chat`);

        expect(res.status).toBe(204);

        const getRes = await request(app).get(`/api/projects/${projectId}/chat`);
        expect(getRes.body).toEqual([]);
      });

      it('returns 404 for non-existent project', async () => {
        const res = await request(app).delete('/api/projects/non-existent/chat');

        expect(res.status).toBe(404);
      });
    });

    describe('POST /api/projects/:id/process', () => {
      it('processes user input and returns messages', async () => {
        const res = await request(app)
          .post(`/api/projects/${projectId}/process`)
          .send({ content: 'Add a new feature' });

        expect(res.status).toBe(200);
        expect(res.body.userMessage).toBeDefined();
        expect(res.body.userMessage.content).toBe('Add a new feature');
        expect(res.body.assistantMessage).toBeDefined();
      });

      it('returns 404 for non-existent project', async () => {
        const res = await request(app)
          .post('/api/projects/non-existent/process')
          .send({ content: 'Test' });

        expect(res.status).toBe(404);
      });

      it('returns 400 for missing content', async () => {
        const res = await request(app)
          .post(`/api/projects/${projectId}/process`)
          .send({});

        expect(res.status).toBe(400);
      });

      it('updates editor when Claude returns content', async () => {
        // First add some content
        await request(app)
          .put(`/api/projects/${projectId}/editor`)
          .send({ content: '# Existing Content' });

        const res = await request(app)
          .post(`/api/projects/${projectId}/process`)
          .send({ content: 'Add another section' });

        expect(res.status).toBe(200);
        // Mock service always updates content
        expect(res.body.editorUpdate).toBeDefined();
      });

      it('handles Claude service error response', async () => {
        // Create a mock service that returns an error
        class ErrorClaudeService extends ClaudeService {
          async processRequirement(): Promise<ClaudeResponse> {
            return { success: false, error: 'API rate limit exceeded' };
          }
        }
        setClaudeServiceFactory(() => new ErrorClaudeService({ token: '' }));

        const res = await request(app)
          .post(`/api/projects/${projectId}/process`)
          .send({ content: 'Test input' });

        expect(res.status).toBe(200);
        expect(res.body.userMessage).toBeDefined();
        expect(res.body.assistantMessage.content).toContain('Error: API rate limit exceeded');
        expect(res.body.editorUpdate).toBeNull();

        // Reset the factory
        resetClaudeServiceFactory();
      });

      it('returns no editor update when content unchanged', async () => {
        // Set up project with specific content
        const existingContent = '# Project\n\n- Item 1';
        await request(app)
          .put(`/api/projects/${projectId}/editor`)
          .send({ content: existingContent });

        // Create a mock service that returns the same content
        class SameContentClaudeService extends ClaudeService {
          async processRequirement(_userMessage: string, currentContent: string): Promise<ClaudeResponse> {
            return { success: true, content: currentContent };
          }
        }
        setClaudeServiceFactory(() => new SameContentClaudeService({ token: '' }));

        const res = await request(app)
          .post(`/api/projects/${projectId}/process`)
          .send({ content: 'Review the document' });

        expect(res.status).toBe(200);
        expect(res.body.userMessage).toBeDefined();
        expect(res.body.assistantMessage.content).toBe('No changes needed to the document.');
        expect(res.body.editorUpdate).toBeNull();

        // Reset the factory
        resetClaudeServiceFactory();
      });

      it('handles undefined content from Claude response', async () => {
        // Create a mock service that returns success without content
        class UndefinedContentClaudeService extends ClaudeService {
          async processRequirement(): Promise<ClaudeResponse> {
            return { success: true, content: undefined };
          }
        }
        setClaudeServiceFactory(() => new UndefinedContentClaudeService({ token: '' }));

        // Add some initial content so the diff shows changes
        await request(app)
          .put(`/api/projects/${projectId}/editor`)
          .send({ content: '# Initial content' });

        const res = await request(app)
          .post(`/api/projects/${projectId}/process`)
          .send({ content: 'Clear the document' });

        expect(res.status).toBe(200);
        expect(res.body.editorUpdate).toBeDefined();

        // Reset the factory
        resetClaudeServiceFactory();
      });
    });

    describe('POST /api/projects/:id/diff', () => {
      it('computes diff between two contents', async () => {
        const res = await request(app)
          .post(`/api/projects/${projectId}/diff`)
          .send({
            oldContent: 'Line 1\nLine 2',
            newContent: 'Line 1\nModified',
          });

        expect(res.status).toBe(200);
        expect(res.body.hasChanges).toBe(true);
      });

      it('returns 404 for non-existent project', async () => {
        const res = await request(app)
          .post('/api/projects/non-existent/diff')
          .send({
            oldContent: 'Old',
            newContent: 'New',
          });

        expect(res.status).toBe(404);
      });

      it('returns 400 for missing fields', async () => {
        const res = await request(app)
          .post(`/api/projects/${projectId}/diff`)
          .send({});

        expect(res.status).toBe(400);
      });
    });
  });

  describe('Factory Helpers', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
      resetClaudeServiceFactory();
    });

    describe('shouldUseMock', () => {
      it('returns true when NODE_ENV is not production', () => {
        process.env.NODE_ENV = 'development';
        process.env.CLAUDE_CODE_TOKEN = 'some-token';
        expect(shouldUseMock()).toBe(true);
      });

      it('returns true when CLAUDE_CODE_TOKEN is not set', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.CLAUDE_CODE_TOKEN;
        expect(shouldUseMock()).toBe(true);
      });

      it('returns false when in production with token', () => {
        process.env.NODE_ENV = 'production';
        process.env.CLAUDE_CODE_TOKEN = 'valid-token';
        expect(shouldUseMock()).toBe(false);
      });
    });

    describe('createDefaultFactory', () => {
      it('creates factory that returns MockClaudeService in test environment', () => {
        process.env.NODE_ENV = 'test';
        const factory = createDefaultFactory();
        const service = factory({ status: 'draft' });
        expect(service).toBeInstanceOf(MockClaudeService);
      });

      it('creates factory that uses ralphMode based on project status', () => {
        process.env.NODE_ENV = 'production';
        process.env.CLAUDE_CODE_TOKEN = 'valid-token';
        const factory = createDefaultFactory();
        // This will create a real ClaudeService, just verify it doesn't throw
        const service = factory({ status: 'development' });
        expect(service).toBeDefined();
      });
    });

    describe('resetClaudeServiceFactory', () => {
      it('resets the factory to default', () => {
        // Set a custom factory
        setClaudeServiceFactory(() => new MockClaudeService({ token: 'custom' }));

        // Reset it
        resetClaudeServiceFactory();

        // Verify it works (doesn't throw)
        const factory = createDefaultFactory();
        const service = factory({ status: 'draft' });
        expect(service).toBeDefined();
      });
    });
  });
});
