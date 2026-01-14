import mongoose, { Schema, Document } from 'mongoose';

export interface ITaskComment extends Document {
  _id: string;
  taskId: string;
  content: string;
  createdAt: Date;
}

const TaskCommentSchema = new Schema<ITaskComment>(
  {
    _id: { type: String, required: true },
    taskId: { type: String, required: true, index: true },
    content: { type: String, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    _id: false,
  }
);

// Index for efficient querying by task
TaskCommentSchema.index({ taskId: 1, createdAt: 1 });

export const TaskComment = mongoose.model<ITaskComment>('TaskComment', TaskCommentSchema);
