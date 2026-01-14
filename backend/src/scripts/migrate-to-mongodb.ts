/**
 * Migration script: SQLite -> MongoDB
 *
 * Usage:
 *   npx tsx src/scripts/migrate-to-mongodb.ts [sqlite-path]
 *
 * Environment variables:
 *   MONGODB_URI - MongoDB connection string (default: mongodb://localhost:27017/cc_manager)
 *   SQLITE_PATH - Path to SQLite database (default: ./cc-manager.db)
 */

import Database from 'better-sqlite3';
import mongoose from 'mongoose';
import { Project } from '../db/models/Project.js';
import { ChatMessage } from '../db/models/ChatMessage.js';
import { KanbanTask } from '../db/models/KanbanTask.js';
import { TaskComment } from '../db/models/TaskComment.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cc_manager';
const SQLITE_PATH = process.argv[2] || process.env.SQLITE_PATH || './cc-manager.db';

interface SqliteProject {
  id: string;
  name: string;
  description: string | null;
  github_repo: string | null;
  status: string;
  editor_content: string;
  deployed_url: string | null;
  created_at: string;
  updated_at: string;
}

interface SqliteChatMessage {
  id: string;
  project_id: string;
  role: string;
  content: string;
  created_at: string;
}

interface SqliteKanbanTask {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  position: number;
  commit_url: string | null;
  created_at: string;
  updated_at: string;
}

interface SqliteTaskComment {
  id: string;
  task_id: string;
  content: string;
  created_at: string;
}

async function migrate(): Promise<void> {
  console.log('=== SQLite to MongoDB Migration ===\n');
  console.log(`SQLite path: ${SQLITE_PATH}`);
  console.log(`MongoDB URI: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}\n`);

  // Connect to SQLite
  console.log('Connecting to SQLite...');
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  console.log('Connected to SQLite\n');

  // Connect to MongoDB
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB\n');

  try {
    // Migrate Projects
    console.log('--- Migrating Projects ---');
    const projects = sqlite.prepare('SELECT * FROM projects').all() as SqliteProject[];
    console.log(`Found ${projects.length} projects`);

    for (const p of projects) {
      await Project.findOneAndUpdate(
        { _id: p.id },
        {
          _id: p.id,
          name: p.name,
          description: p.description,
          githubRepo: p.github_repo,
          status: p.status,
          editorContent: p.editor_content,
          deployedUrl: p.deployed_url,
          createdAt: new Date(p.created_at),
          updatedAt: new Date(p.updated_at),
        },
        { upsert: true, new: true }
      );
    }
    console.log(`Migrated ${projects.length} projects\n`);

    // Migrate Chat Messages
    console.log('--- Migrating Chat Messages ---');
    const messages = sqlite.prepare('SELECT * FROM chat_messages').all() as SqliteChatMessage[];
    console.log(`Found ${messages.length} chat messages`);

    for (const m of messages) {
      await ChatMessage.findOneAndUpdate(
        { _id: m.id },
        {
          _id: m.id,
          projectId: m.project_id,
          role: m.role,
          content: m.content,
          createdAt: new Date(m.created_at),
        },
        { upsert: true, new: true }
      );
    }
    console.log(`Migrated ${messages.length} chat messages\n`);

    // Migrate Kanban Tasks
    console.log('--- Migrating Kanban Tasks ---');
    const tasks = sqlite.prepare('SELECT * FROM kanban_tasks').all() as SqliteKanbanTask[];
    console.log(`Found ${tasks.length} kanban tasks`);

    for (const t of tasks) {
      await KanbanTask.findOneAndUpdate(
        { _id: t.id },
        {
          _id: t.id,
          projectId: t.project_id,
          title: t.title,
          description: t.description,
          status: t.status,
          position: t.position,
          commitUrl: t.commit_url,
          createdAt: new Date(t.created_at),
          updatedAt: new Date(t.updated_at),
        },
        { upsert: true, new: true }
      );
    }
    console.log(`Migrated ${tasks.length} kanban tasks\n`);

    // Migrate Task Comments
    console.log('--- Migrating Task Comments ---');
    const comments = sqlite.prepare('SELECT * FROM task_comments').all() as SqliteTaskComment[];
    console.log(`Found ${comments.length} task comments`);

    for (const c of comments) {
      await TaskComment.findOneAndUpdate(
        { _id: c.id },
        {
          _id: c.id,
          taskId: c.task_id,
          content: c.content,
          createdAt: new Date(c.created_at),
        },
        { upsert: true, new: true }
      );
    }
    console.log(`Migrated ${comments.length} task comments\n`);

    console.log('=== Migration Complete ===');
    console.log(`
Summary:
  - Projects: ${projects.length}
  - Chat Messages: ${messages.length}
  - Kanban Tasks: ${tasks.length}
  - Task Comments: ${comments.length}
`);

  } finally {
    sqlite.close();
    await mongoose.connection.close();
  }
}

migrate().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
