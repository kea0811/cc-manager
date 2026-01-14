import { v4 as uuidv4 } from 'uuid';
import { getDb, mapProjectRow } from '../db/index.js';
import type { Project, CreateProject, UpdateProject } from '../types/index.js';

const now = (): string => new Date().toISOString();

export const getAllProjects = (): Project[] => {
  const rows = getDb()
    .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
    .all() as Record<string, unknown>[];
  return rows.map(mapProjectRow);
};

export const getProjectById = (id: string): Project | null => {
  const row = getDb()
    .prepare('SELECT * FROM projects WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapProjectRow(row) : null;
};

export const createProject = (data: CreateProject): Project => {
  const id = uuidv4();
  const timestamp = now();

  getDb().prepare(`
    INSERT INTO projects (id, name, description, status, editor_content, created_at, updated_at)
    VALUES (?, ?, ?, 'draft', '', ?, ?)
  `).run(id, data.name, data.description || null, timestamp, timestamp);

  return getProjectById(id)!;
};

export const updateProject = (id: string, data: UpdateProject): Project | null => {
  const existing = getProjectById(id);
  if (!existing) return null;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (data.name !== undefined) {
    updates.push('name = ?');
    values.push(data.name);
  }
  if (data.description !== undefined) {
    updates.push('description = ?');
    values.push(data.description);
  }
  if (data.githubRepo !== undefined) {
    updates.push('github_repo = ?');
    values.push(data.githubRepo);
  }
  if (data.status !== undefined) {
    updates.push('status = ?');
    values.push(data.status);
  }
  if (data.deployedUrl !== undefined) {
    updates.push('deployed_url = ?');
    values.push(data.deployedUrl);
  }

  if (updates.length === 0) return existing;

  updates.push('updated_at = ?');
  values.push(now());
  values.push(id);

  getDb().prepare(`
    UPDATE projects SET ${updates.join(', ')} WHERE id = ?
  `).run(...values);

  return getProjectById(id);
};

export const deleteProject = (id: string): boolean => {
  const result = getDb()
    .prepare('DELETE FROM projects WHERE id = ?')
    .run(id);
  return result.changes > 0;
};

export const updateEditorContent = (id: string, content: string): Project | null => {
  const existing = getProjectById(id);
  if (!existing) return null;

  getDb().prepare(`
    UPDATE projects SET editor_content = ?, updated_at = ? WHERE id = ?
  `).run(content, now(), id);

  return getProjectById(id);
};
