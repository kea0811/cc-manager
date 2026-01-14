import { describe, it, expect } from 'vitest';
import { apiClient, ApiError } from '@/api/client';
import { projectsApi } from '@/api/projects';
import { server } from './setup';
import { http, HttpResponse } from 'msw';

describe('API Client', () => {
  describe('apiClient.get', () => {
    it('fetches data successfully', async () => {
      const projects = await apiClient.get('/projects');
      expect(Array.isArray(projects)).toBe(true);
    });

    it('throws ApiError on failure', async () => {
      server.use(
        http.get('/api/projects', () => HttpResponse.json({ error: 'Server error' }, { status: 500 }))
      );

      await expect(apiClient.get('/projects')).rejects.toThrow(ApiError);
    });

    it('handles 404 errors', async () => {
      try {
        await apiClient.get('/projects/nonexistent');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(404);
      }
    });
  });

  describe('apiClient.post', () => {
    it('posts data successfully', async () => {
      const result = await apiClient.post('/projects', { name: 'New Project' });
      expect(result).toHaveProperty('id');
    });
  });

  describe('apiClient.patch', () => {
    it('patches data successfully', async () => {
      const result = await apiClient.patch('/projects/1', { name: 'Updated' });
      expect(result).toHaveProperty('name', 'Updated');
    });
  });

  describe('apiClient.put', () => {
    it('puts data successfully', async () => {
      const result = await apiClient.put('/projects/1/editor', { content: 'New content' });
      expect(result).toHaveProperty('editorContent', 'New content');
    });
  });

  describe('apiClient.delete', () => {
    it('deletes successfully', async () => {
      await expect(apiClient.delete('/projects/1')).resolves.toBeUndefined();
    });
  });
});

describe('Projects API', () => {
  describe('getAll', () => {
    it('returns all projects', async () => {
      const projects = await projectsApi.getAll();
      expect(projects).toHaveLength(2);
      expect(projects[0]).toHaveProperty('name');
    });
  });

  describe('getById', () => {
    it('returns a project by ID', async () => {
      const project = await projectsApi.getById('1');
      expect(project.id).toBe('1');
      expect(project.name).toBe('Test Project 1');
    });
  });

  describe('create', () => {
    it('creates a new project', async () => {
      const project = await projectsApi.create({ name: 'New Project' });
      expect(project.name).toBe('New Project');
      expect(project.status).toBe('draft');
    });
  });

  describe('update', () => {
    it('updates a project', async () => {
      const project = await projectsApi.update('1', { name: 'Updated Name' });
      expect(project.name).toBe('Updated Name');
    });
  });

  describe('delete', () => {
    it('deletes a project', async () => {
      await expect(projectsApi.delete('1')).resolves.toBeUndefined();
    });
  });

  describe('updateEditor', () => {
    it('updates editor content', async () => {
      const project = await projectsApi.updateEditor('1', '# New Content');
      expect(project.editorContent).toBe('# New Content');
    });
  });

  describe('getChatHistory', () => {
    it('returns chat history', async () => {
      const messages = await projectsApi.getChatHistory('1');
      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe('addChatMessage', () => {
    it('adds a chat message', async () => {
      const message = await projectsApi.addChatMessage('1', { role: 'user', content: 'Test' });
      expect(message.content).toBe('Test');
      expect(message.role).toBe('user');
    });
  });

  describe('clearChatHistory', () => {
    it('clears chat history', async () => {
      await expect(projectsApi.clearChatHistory('1')).resolves.toBeUndefined();
    });
  });
});
