import Database from 'better-sqlite3';
import type { Project, ChatMessage, KanbanTask, TaskComment } from '../types/index.js';

const DB_PATH = process.env.DATABASE_PATH || './cc-manager.db';

let db: Database.Database | null = null;

export const getDb = (): Database.Database => {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  return db;
};

export const closeDb = (): void => {
  if (db) {
    db.close();
    db = null;
  }
};

export const initDb = (): void => {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      github_repo TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      editor_content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_project_id
    ON chat_messages(project_id);

    CREATE TABLE IF NOT EXISTS kanban_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_kanban_tasks_project_id
    ON kanban_tasks(project_id);

    CREATE INDEX IF NOT EXISTS idx_kanban_tasks_status
    ON kanban_tasks(project_id, status);

    CREATE TABLE IF NOT EXISTS task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES kanban_tasks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_task_comments_task_id
    ON task_comments(task_id);
  `);

  // Migration: Add deployed_url column if it doesn't exist
  const projectColumns = database.pragma('table_info(projects)') as { name: string }[];
  if (!projectColumns.some(col => col.name === 'deployed_url')) {
    database.exec('ALTER TABLE projects ADD COLUMN deployed_url TEXT');
  }

  // Migration: Add commit_url column to kanban_tasks if it doesn't exist
  const taskColumns = database.pragma('table_info(kanban_tasks)') as { name: string }[];
  if (!taskColumns.some(col => col.name === 'commit_url')) {
    database.exec('ALTER TABLE kanban_tasks ADD COLUMN commit_url TEXT');
  }
};

// Row mappers - compact functions for transforming DB rows to domain types
export const mapProjectRow = (row: Record<string, unknown>): Project => ({
  id: row.id as string,
  name: row.name as string,
  description: row.description as string | null,
  githubRepo: row.github_repo as string | null,
  status: row.status as 'draft' | 'development' | 'deployed',
  editorContent: row.editor_content as string,
  deployedUrl: row.deployed_url as string | null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

export const mapChatMessageRow = (row: Record<string, unknown>): ChatMessage => ({
  id: row.id as string,
  projectId: row.project_id as string,
  role: row.role as 'user' | 'assistant',
  content: row.content as string,
  createdAt: row.created_at as string,
});

export const mapKanbanTaskRow = (row: Record<string, unknown>): KanbanTask => ({
  id: row.id as string,
  projectId: row.project_id as string,
  title: row.title as string,
  description: row.description as string | null,
  status: row.status as KanbanTask['status'],
  position: row.position as number,
  commitUrl: row.commit_url as string | null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

export const mapTaskCommentRow = (row: Record<string, unknown>): TaskComment => ({
  id: row.id as string,
  taskId: row.task_id as string,
  content: row.content as string,
  createdAt: row.created_at as string,
});
