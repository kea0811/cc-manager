import { randomUUID } from 'crypto';
import { getDb, mapKanbanTaskRow, mapTaskCommentRow } from '../db/index.js';
import type { KanbanTask, CreateKanbanTask, UpdateKanbanTask, KanbanStatus, TaskComment, CreateTaskComment } from '../types/index.js';

export const getTasksByProject = (projectId: string): KanbanTask[] => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM kanban_tasks
    WHERE project_id = ?
    ORDER BY status, position
  `).all(projectId) as Record<string, unknown>[];
  return rows.map(mapKanbanTaskRow);
};

export const getTaskById = (id: string): KanbanTask | null => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapKanbanTaskRow(row) : null;
};

export const createTask = (projectId: string, data: CreateKanbanTask): KanbanTask => {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const status = data.status || 'todo';

  // Get next position for this status column
  const maxPos = db.prepare(`
    SELECT COALESCE(MAX(position), -1) as maxPos
    FROM kanban_tasks
    WHERE project_id = ? AND status = ?
  `).get(projectId, status) as { maxPos: number };

  const position = maxPos.maxPos + 1;

  db.prepare(`
    INSERT INTO kanban_tasks (id, project_id, title, description, status, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, projectId, data.title, data.description || null, status, position, now, now);

  return getTaskById(id)!;
};

export const updateTask = (id: string, data: UpdateKanbanTask): KanbanTask | null => {
  const task = getTaskById(id);
  if (!task) return null;

  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE kanban_tasks
    SET title = ?, description = ?, status = ?, position = ?, updated_at = ?
    WHERE id = ?
  `).run(
    data.title ?? task.title,
    data.description ?? task.description,
    data.status ?? task.status,
    data.position ?? task.position,
    now,
    id
  );

  return getTaskById(id);
};

export const moveTask = (id: string, newStatus: KanbanStatus, newPosition: number): KanbanTask | null => {
  const task = getTaskById(id);
  if (!task) return null;

  const db = getDb();
  const now = new Date().toISOString();

  // Reorder tasks in target column to make room
  db.prepare(`
    UPDATE kanban_tasks
    SET position = position + 1, updated_at = ?
    WHERE project_id = ? AND status = ? AND position >= ?
  `).run(now, task.projectId, newStatus, newPosition);

  // Move the task
  db.prepare(`
    UPDATE kanban_tasks
    SET status = ?, position = ?, updated_at = ?
    WHERE id = ?
  `).run(newStatus, newPosition, now, id);

  return getTaskById(id);
};

export const deleteTask = (id: string): boolean => {
  const db = getDb();
  const result = db.prepare('DELETE FROM kanban_tasks WHERE id = ?').run(id);
  return result.changes > 0;
};

export const deleteAllTasksByProject = (projectId: string): void => {
  const db = getDb();
  db.prepare('DELETE FROM kanban_tasks WHERE project_id = ?').run(projectId);
};

// Task Comment functions
export const getCommentsByTask = (taskId: string): TaskComment[] => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM task_comments
    WHERE task_id = ?
    ORDER BY created_at ASC
  `).all(taskId) as Record<string, unknown>[];
  return rows.map(mapTaskCommentRow);
};

export const createComment = (taskId: string, data: CreateTaskComment): TaskComment => {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO task_comments (id, task_id, content, created_at)
    VALUES (?, ?, ?, ?)
  `).run(id, taskId, data.content, now);

  const row = db.prepare('SELECT * FROM task_comments WHERE id = ?').get(id) as Record<string, unknown>;
  return mapTaskCommentRow(row);
};

export const deleteComment = (commentId: string): boolean => {
  const db = getDb();
  const result = db.prepare('DELETE FROM task_comments WHERE id = ?').run(commentId);
  return result.changes > 0;
};

export const updateTaskCommitUrl = (taskId: string, commitUrl: string): KanbanTask | null => {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE kanban_tasks
    SET commit_url = ?, updated_at = ?
    WHERE id = ?
  `).run(commitUrl, now, taskId);

  return getTaskById(taskId);
};
