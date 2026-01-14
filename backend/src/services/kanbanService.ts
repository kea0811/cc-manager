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

export const moveTask = async (id: string, newStatus: KanbanStatus, newPosition: number): Promise<KanbanTask | null> => {
  const task = await getTaskById(id);
  if (!task) return null;

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

  return doc ? mapKanbanTaskDoc(doc) : null;
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
