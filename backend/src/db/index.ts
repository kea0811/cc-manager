import mongoose from 'mongoose';
import type { Project, ChatMessage, KanbanTask, TaskComment, ExecutionGroup } from '../types/index.js';
import { IProject } from './models/Project.js';
import { IChatMessage } from './models/ChatMessage.js';
import { IKanbanTask } from './models/KanbanTask.js';
import { ITaskComment } from './models/TaskComment.js';
import { IExecutionGroup } from './models/ExecutionGroup.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cc_manager';

let isConnected = false;

export const connectDb = async (): Promise<void> => {
  if (isConnected) return;

  try {
    // Connection options to prevent stale connections
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,    // Timeout after 5s if can't connect
      heartbeatFrequencyMS: 10000,       // Check connection every 10s
      socketTimeoutMS: 45000,            // Close sockets after 45s of inactivity
      maxIdleTimeMS: 30000,              // Close idle connections after 30s
    });

    isConnected = true;
    console.log('Connected to MongoDB');

    // Handle connection events
    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected - will attempt to reconnect');
      isConnected = false;
    });

    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected');
      isConnected = true;
    });

    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });
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
  webUrl: doc.webUrl,
  developmentStatus: doc.developmentStatus ? {
    isRunning: doc.developmentStatus.isRunning,
    phase: doc.developmentStatus.phase,
    message: doc.developmentStatus.message,
    startedAt: doc.developmentStatus.startedAt?.toISOString() || null,
    logs: doc.developmentStatus.logs || [],
    error: doc.developmentStatus.error,
  } : undefined,
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
  // Parallel development fields
  dependencies: doc.dependencies,
  branchName: doc.branchName,
  testCoverage: doc.testCoverage,
  testStatus: doc.testStatus,
  mergeStatus: doc.mergeStatus,
  executionGroupId: doc.executionGroupId,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

export const mapTaskCommentDoc = (doc: ITaskComment): TaskComment => ({
  id: doc._id,
  taskId: doc.taskId,
  content: doc.content,
  createdAt: doc.createdAt.toISOString(),
});

export const mapExecutionGroupDoc = (doc: IExecutionGroup): ExecutionGroup => ({
  id: doc._id,
  projectId: doc.projectId,
  status: doc.status,
  taskIds: doc.taskIds,
  containerIds: doc.containerIds,
  batchNumber: doc.batchNumber,
  totalBatches: doc.totalBatches,
  startedAt: doc.startedAt?.toISOString() || null,
  completedAt: doc.completedAt?.toISOString() || null,
  errorMessage: doc.errorMessage,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

// Re-export models for convenience
export { Project as ProjectModel } from './models/Project.js';
export { ChatMessage as ChatMessageModel } from './models/ChatMessage.js';
export { KanbanTask as KanbanTaskModel } from './models/KanbanTask.js';
export { TaskComment as TaskCommentModel } from './models/TaskComment.js';
export { ExecutionGroup as ExecutionGroupModel } from './models/ExecutionGroup.js';
