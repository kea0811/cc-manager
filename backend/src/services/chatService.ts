import { v4 as uuidv4 } from 'uuid';
import { getDb, mapChatMessageRow } from '../db/index.js';
import type { ChatMessage, CreateChatMessage } from '../types/index.js';

const now = (): string => new Date().toISOString();

export const getChatHistory = (projectId: string): ChatMessage[] => {
  const rows = getDb()
    .prepare('SELECT * FROM chat_messages WHERE project_id = ? ORDER BY created_at ASC')
    .all(projectId) as Record<string, unknown>[];
  return rows.map(mapChatMessageRow);
};

export const addChatMessage = (projectId: string, data: CreateChatMessage): ChatMessage => {
  const id = uuidv4();
  const timestamp = now();

  getDb().prepare(`
    INSERT INTO chat_messages (id, project_id, role, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, projectId, data.role, data.content, timestamp);

  return {
    id,
    projectId,
    role: data.role,
    content: data.content,
    createdAt: timestamp,
  };
};

export const deleteChatHistory = (projectId: string): number => {
  const result = getDb()
    .prepare('DELETE FROM chat_messages WHERE project_id = ?')
    .run(projectId);
  return result.changes;
};

export const getChatMessageById = (id: string): ChatMessage | null => {
  const row = getDb()
    .prepare('SELECT * FROM chat_messages WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapChatMessageRow(row) : null;
};
