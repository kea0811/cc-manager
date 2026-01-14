import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initDb, getDb, closeDb } from '../db/index.js';
import * as projectService from '../services/projectService.js';
import * as chatService from '../services/chatService.js';

// Use in-memory database for tests
process.env.DATABASE_PATH = ':memory:';

describe('ChatService', () => {
  let projectId: string;

  beforeAll(() => {
    initDb();
  });

  beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM chat_messages');
    db.exec('DELETE FROM projects');

    // Create a project for chat tests
    const project = projectService.createProject({ name: 'Test Project' });
    projectId = project.id;
  });

  afterAll(() => {
    closeDb();
  });

  describe('addChatMessage', () => {
    it('adds a user message', () => {
      const message = chatService.addChatMessage(projectId, {
        role: 'user',
        content: 'Hello',
      });

      expect(message.id).toBeDefined();
      expect(message.projectId).toBe(projectId);
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello');
      expect(message.createdAt).toBeDefined();
    });

    it('adds an assistant message', () => {
      const message = chatService.addChatMessage(projectId, {
        role: 'assistant',
        content: 'Hi there!',
      });

      expect(message.role).toBe('assistant');
      expect(message.content).toBe('Hi there!');
    });
  });

  describe('getChatHistory', () => {
    it('returns empty array when no messages', () => {
      const history = chatService.getChatHistory(projectId);
      expect(history).toEqual([]);
    });

    it('returns messages in chronological order', () => {
      chatService.addChatMessage(projectId, { role: 'user', content: 'First' });
      chatService.addChatMessage(projectId, { role: 'assistant', content: 'Second' });
      chatService.addChatMessage(projectId, { role: 'user', content: 'Third' });

      const history = chatService.getChatHistory(projectId);

      expect(history).toHaveLength(3);
      expect(history[0].content).toBe('First');
      expect(history[1].content).toBe('Second');
      expect(history[2].content).toBe('Third');
    });

    it('only returns messages for specified project', () => {
      const otherProject = projectService.createProject({ name: 'Other' });

      chatService.addChatMessage(projectId, { role: 'user', content: 'Project 1' });
      chatService.addChatMessage(otherProject.id, { role: 'user', content: 'Project 2' });

      const history = chatService.getChatHistory(projectId);

      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Project 1');
    });
  });

  describe('deleteChatHistory', () => {
    it('deletes all messages for a project', () => {
      chatService.addChatMessage(projectId, { role: 'user', content: 'Message 1' });
      chatService.addChatMessage(projectId, { role: 'assistant', content: 'Message 2' });

      const deleted = chatService.deleteChatHistory(projectId);

      expect(deleted).toBe(2);
      expect(chatService.getChatHistory(projectId)).toEqual([]);
    });

    it('returns 0 when no messages to delete', () => {
      const deleted = chatService.deleteChatHistory(projectId);
      expect(deleted).toBe(0);
    });

    it('only deletes messages for specified project', () => {
      const otherProject = projectService.createProject({ name: 'Other' });

      chatService.addChatMessage(projectId, { role: 'user', content: 'Project 1' });
      chatService.addChatMessage(otherProject.id, { role: 'user', content: 'Project 2' });

      chatService.deleteChatHistory(projectId);

      expect(chatService.getChatHistory(projectId)).toHaveLength(0);
      expect(chatService.getChatHistory(otherProject.id)).toHaveLength(1);
    });
  });

  describe('getChatMessageById', () => {
    it('returns message when found', () => {
      const created = chatService.addChatMessage(projectId, {
        role: 'user',
        content: 'Test',
      });

      const found = chatService.getChatMessageById(created.id);

      expect(found).toEqual(created);
    });

    it('returns null when not found', () => {
      const found = chatService.getChatMessageById('non-existent-id');
      expect(found).toBeNull();
    });
  });
});
