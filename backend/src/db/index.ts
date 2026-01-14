import mongoose from 'mongoose';
import type { Project, ChatMessage, KanbanTask, TaskComment } from '../types/index.js';
import { IProject } from './models/Project.js';
import { IChatMessage } from './models/ChatMessage.js';
import { IKanbanTask } from './models/KanbanTask.js';
import { ITaskComment } from './models/TaskComment.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cc_manager';

let isConnected = false;

export const connectDb = async (): Promise<void> => {
  if (isConnected) return;

  try {
    await mongoose.connect(MONGODB_URI);
    isConnected = true;
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
};

export const closeDb = async (): Promise<void> => {
  if (!isConnected) return;

  try {
    await mongoose.connection.close();
    isConnected = false;
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('MongoDB disconnect error:', error);
    throw error;
  }
};

export const initDb = async (): Promise<void> => {
  await connectDb();
  // MongoDB doesn't need explicit table creation - schemas handle this
  console.log('Database initialized');
};

// Row mappers - convert Mongoose documents to domain types
export const mapProjectDoc = (doc: IProject): Project => ({
  id: doc._id,
  name: doc.name,
  description: doc.description,
  githubRepo: doc.githubRepo,
  status: doc.status,
  editorContent: doc.editorContent,
  deployedUrl: doc.deployedUrl,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

export const mapChatMessageDoc = (doc: IChatMessage): ChatMessage => ({
  id: doc._id,
  projectId: doc.projectId,
  role: doc.role,
  content: doc.content,
  createdAt: doc.createdAt.toISOString(),
});

export const mapKanbanTaskDoc = (doc: IKanbanTask): KanbanTask => ({
  id: doc._id,
  projectId: doc.projectId,
  title: doc.title,
  description: doc.description,
  status: doc.status,
  position: doc.position,
  commitUrl: doc.commitUrl,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

export const mapTaskCommentDoc = (doc: ITaskComment): TaskComment => ({
  id: doc._id,
  taskId: doc.taskId,
  content: doc.content,
  createdAt: doc.createdAt.toISOString(),
});

// Re-export models for convenience
export { Project as ProjectModel } from './models/Project.js';
export { ChatMessage as ChatMessageModel } from './models/ChatMessage.js';
export { KanbanTask as KanbanTaskModel } from './models/KanbanTask.js';
export { TaskComment as TaskCommentModel } from './models/TaskComment.js';
