import { beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectDb, closeDb } from '../db/index.js';
import { ProjectModel, ChatMessageModel, KanbanTaskModel, TaskCommentModel } from '../db/index.js';

// Use test database
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cc_manager_test';

beforeAll(async () => {
  await connectDb();
});

beforeEach(async () => {
  // Clear all data between tests
  await ChatMessageModel.deleteMany({});
  await TaskCommentModel.deleteMany({});
  await KanbanTaskModel.deleteMany({});
  await ProjectModel.deleteMany({});
});

afterAll(async () => {
  await closeDb();
});
