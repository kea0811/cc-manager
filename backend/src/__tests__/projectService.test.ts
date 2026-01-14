import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { initDb, getDb, closeDb } from '../db/index.js';
import * as projectService from '../services/projectService.js';

// Use unique in-memory database for this test file
process.env.DATABASE_PATH = ':memory:';

// Mock Date.now for consistent timestamps in tests
const originalDateNow = Date.now;
let mockTime = new Date('2024-01-01T00:00:00.000Z').getTime();

describe('ProjectService', () => {
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

  describe('createProject', () => {
    it('creates a project with required fields', () => {
      const project = projectService.createProject({ name: 'Test Project' });

      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.description).toBeNull();
      expect(project.status).toBe('draft');
      expect(project.editorContent).toBe('');
      expect(project.createdAt).toBeDefined();
      expect(project.updatedAt).toBeDefined();
    });

    it('creates a project with description', () => {
      const project = projectService.createProject({
        name: 'Test',
        description: 'A description',
      });

      expect(project.description).toBe('A description');
    });
  });

  describe('getAllProjects', () => {
    it('returns empty array when no projects', () => {
      const projects = projectService.getAllProjects();
      expect(projects).toEqual([]);
    });

    it('returns all projects sorted by updated_at desc', async () => {
      projectService.createProject({ name: 'First' });
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      projectService.createProject({ name: 'Second' });

      const projects = projectService.getAllProjects();

      expect(projects).toHaveLength(2);
      expect(projects[0].name).toBe('Second');
      expect(projects[1].name).toBe('First');
    });
  });

  describe('getProjectById', () => {
    it('returns project when found', () => {
      const created = projectService.createProject({ name: 'Test' });
      const found = projectService.getProjectById(created.id);

      expect(found).toEqual(created);
    });

    it('returns null when not found', () => {
      const found = projectService.getProjectById('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('updateProject', () => {
    it('updates project name', () => {
      const created = projectService.createProject({ name: 'Original' });
      const updated = projectService.updateProject(created.id, { name: 'Updated' });

      expect(updated?.name).toBe('Updated');
    });

    it('updates project description', () => {
      const created = projectService.createProject({ name: 'Test' });
      const updated = projectService.updateProject(created.id, { description: 'New desc' });

      expect(updated?.description).toBe('New desc');
    });

    it('updates github repo', () => {
      const created = projectService.createProject({ name: 'Test' });
      const updated = projectService.updateProject(created.id, {
        githubRepo: 'https://github.com/test/repo',
      });

      expect(updated?.githubRepo).toBe('https://github.com/test/repo');
    });

    it('updates status', () => {
      const created = projectService.createProject({ name: 'Test' });
      const updated = projectService.updateProject(created.id, { status: 'development' });

      expect(updated?.status).toBe('development');
    });

    it('updates multiple fields at once', () => {
      const created = projectService.createProject({ name: 'Test' });
      const updated = projectService.updateProject(created.id, {
        name: 'New Name',
        description: 'New desc',
        status: 'development',
      });

      expect(updated?.name).toBe('New Name');
      expect(updated?.description).toBe('New desc');
      expect(updated?.status).toBe('development');
    });

    it('returns null when project not found', () => {
      const updated = projectService.updateProject('non-existent', { name: 'Test' });
      expect(updated).toBeNull();
    });

    it('returns existing project when no updates provided', () => {
      const created = projectService.createProject({ name: 'Test' });
      const updated = projectService.updateProject(created.id, {});

      expect(updated?.name).toBe('Test');
    });

    it('updates updatedAt timestamp', async () => {
      const created = projectService.createProject({ name: 'Test' });
      const originalUpdatedAt = created.updatedAt;

      // Small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));
      const updated = projectService.updateProject(created.id, { name: 'New' });

      expect(updated?.updatedAt).not.toBe(originalUpdatedAt);
    });
  });

  describe('deleteProject', () => {
    it('deletes existing project', () => {
      const created = projectService.createProject({ name: 'Test' });
      const deleted = projectService.deleteProject(created.id);

      expect(deleted).toBe(true);
      expect(projectService.getProjectById(created.id)).toBeNull();
    });

    it('returns false when project not found', () => {
      const deleted = projectService.deleteProject('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('updateEditorContent', () => {
    it('updates editor content', () => {
      const created = projectService.createProject({ name: 'Test' });
      const updated = projectService.updateEditorContent(created.id, '# New Content');

      expect(updated?.editorContent).toBe('# New Content');
    });

    it('returns null when project not found', () => {
      const updated = projectService.updateEditorContent('non-existent', 'content');
      expect(updated).toBeNull();
    });

    it('updates updatedAt timestamp', async () => {
      const created = projectService.createProject({ name: 'Test' });
      const originalUpdatedAt = created.updatedAt;

      await new Promise(resolve => setTimeout(resolve, 10));
      const updated = projectService.updateEditorContent(created.id, 'new content');

      expect(updated?.updatedAt).not.toBe(originalUpdatedAt);
    });
  });
});
