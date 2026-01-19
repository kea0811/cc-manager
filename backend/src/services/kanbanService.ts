import { randomUUID } from 'crypto';
import { KanbanTaskModel, TaskCommentModel, mapKanbanTaskDoc, mapTaskCommentDoc } from '../db/index.js';
import type { KanbanTask, CreateKanbanTask, UpdateKanbanTask, KanbanStatus, TaskComment, CreateTaskComment } from '../types/index.js';

export const getTasksByProject = async (projectId: string): Promise<KanbanTask[]> => {
  const docs = await KanbanTaskModel.find({ projectId }).sort({ status: 1, position: 1 });
  return docs.map(mapKanbanTaskDoc);
};

export const getTaskById = async (id: string): Promise<KanbanTask | null> => {
  const doc = await KanbanTaskModel.findById(id);
  return doc ? mapKanbanTaskDoc(doc) : null;
};

export const createTask = async (projectId: string, data: CreateKanbanTask): Promise<KanbanTask> => {
  const id = randomUUID();
  const status = data.status || 'todo';

  // Get next position for this status column
  const maxPosDoc = await KanbanTaskModel.findOne({ projectId, status })
    .sort({ position: -1 })
    .select('position');

  const position = (maxPosDoc?.position ?? -1) + 1;

  const doc = await KanbanTaskModel.create({
    _id: id,
    projectId,
    title: data.title,
    description: data.description || null,
    status,
    position,
  });

  return mapKanbanTaskDoc(doc);
};

export const updateTask = async (id: string, data: UpdateKanbanTask): Promise<KanbanTask | null> => {
  const task = await getTaskById(id);
  if (!task) return null;

  const doc = await KanbanTaskModel.findByIdAndUpdate(
    id,
    {
      title: data.title ?? task.title,
      description: data.description ?? task.description,
      status: data.status ?? task.status,
      position: data.position ?? task.position,
    },
    { new: true }
  );

  return doc ? mapKanbanTaskDoc(doc) : null;
};

export const moveTask = async (id: string, newStatus: KanbanStatus, newPosition: number): Promise<KanbanTask | undefined> => {
  const task = await getTaskById(id);
  if (!task) return undefined;

  // Reorder tasks in target column to make room
  await KanbanTaskModel.updateMany(
    { projectId: task.projectId, status: newStatus, position: { $gte: newPosition } },
    { $inc: { position: 1 } }
  );

  // Move the task
  const doc = await KanbanTaskModel.findByIdAndUpdate(
    id,
    { status: newStatus, position: newPosition },
    { new: true }
  );

  return doc ? mapKanbanTaskDoc(doc) : undefined;
};

export const deleteTask = async (id: string): Promise<boolean> => {
  // Also delete associated comments
  await TaskCommentModel.deleteMany({ taskId: id });
  const result = await KanbanTaskModel.deleteOne({ _id: id });
  return result.deletedCount > 0;
};

export const deleteAllTasksByProject = async (projectId: string): Promise<void> => {
  // Get all task IDs for this project
  const tasks = await KanbanTaskModel.find({ projectId }).select('_id');
  const taskIds = tasks.map(t => t._id);

  // Delete all comments for these tasks
  await TaskCommentModel.deleteMany({ taskId: { $in: taskIds } });

  // Delete all tasks
  await KanbanTaskModel.deleteMany({ projectId });
};

// Task Comment functions
export const getCommentsByTask = async (taskId: string): Promise<TaskComment[]> => {
  const docs = await TaskCommentModel.find({ taskId }).sort({ createdAt: 1 });
  return docs.map(mapTaskCommentDoc);
};

export const createComment = async (taskId: string, data: CreateTaskComment): Promise<TaskComment> => {
  const id = randomUUID();

  const doc = await TaskCommentModel.create({
    _id: id,
    taskId,
    content: data.content,
  });

  return mapTaskCommentDoc(doc);
};

export const deleteComment = async (commentId: string): Promise<boolean> => {
  const result = await TaskCommentModel.deleteOne({ _id: commentId });
  return result.deletedCount > 0;
};

export const updateTaskCommitUrl = async (taskId: string, commitUrl: string): Promise<KanbanTask | null> => {
  const doc = await KanbanTaskModel.findByIdAndUpdate(
    taskId,
    { commitUrl },
    { new: true }
  );

  return doc ? mapKanbanTaskDoc(doc) : null;
};

export interface CommitSummary {
  totalCommits: number;
  commits: Array<{
    taskId: string;
    taskTitle: string;
    commitUrl: string;
  }>;
}

export const getProjectCommitSummary = async (projectId: string): Promise<CommitSummary> => {
  const tasks = await KanbanTaskModel.find({
    projectId,
    commitUrl: { $ne: null, $exists: true }
  }).select('_id title commitUrl');

  return {
    totalCommits: tasks.length,
    commits: tasks.map(t => ({
      taskId: t._id,
      taskTitle: t.title,
      commitUrl: t.commitUrl!,
    })),
  };
};

// Parallel development functions

export const updateTaskDependencies = async (taskId: string, dependencies: string[]): Promise<KanbanTask | null> => {
  const doc = await KanbanTaskModel.findByIdAndUpdate(
    taskId,
    { dependencies },
    { new: true }
  );

  return doc ? mapKanbanTaskDoc(doc) : null;
};

export const updateTaskBranch = async (taskId: string, branchName: string): Promise<KanbanTask | null> => {
  const doc = await KanbanTaskModel.findByIdAndUpdate(
    taskId,
    { branchName },
    { new: true }
  );

  return doc ? mapKanbanTaskDoc(doc) : null;
};

export const updateTaskTestStatus = async (
  taskId: string,
  testStatus: 'pending' | 'running' | 'passed' | 'failed',
  testCoverage?: number
): Promise<KanbanTask | null> => {
  const update: Record<string, unknown> = { testStatus };
  if (testCoverage !== undefined) {
    update.testCoverage = testCoverage;
  }

  const doc = await KanbanTaskModel.findByIdAndUpdate(
    taskId,
    update,
    { new: true }
  );

  return doc ? mapKanbanTaskDoc(doc) : null;
};

export const updateTaskMergeStatus = async (
  taskId: string,
  mergeStatus: 'pending' | 'merged' | 'conflict' | null
): Promise<KanbanTask | null> => {
  const doc = await KanbanTaskModel.findByIdAndUpdate(
    taskId,
    { mergeStatus },
    { new: true }
  );

  return doc ? mapKanbanTaskDoc(doc) : null;
};

export const clearAllMergeConflicts = async (projectId: string): Promise<number> => {
  const result = await KanbanTaskModel.updateMany(
    { projectId, mergeStatus: 'conflict' },
    { mergeStatus: null }
  );
  return result.modifiedCount;
};

export const updateTaskExecutionGroup = async (
  taskId: string,
  executionGroupId: string | null
): Promise<KanbanTask | null> => {
  const doc = await KanbanTaskModel.findByIdAndUpdate(
    taskId,
    { executionGroupId },
    { new: true }
  );

  return doc ? mapKanbanTaskDoc(doc) : null;
};
