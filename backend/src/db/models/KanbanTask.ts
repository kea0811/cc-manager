import mongoose, { Schema, Document } from 'mongoose';

export interface IKanbanTask extends Document {
  _id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: 'todo' | 'wip' | 'done' | 'code_review' | 'done_unit_test' | 'done_e2e_testing' | 'deploy';
  position: number;
  commitUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const KanbanTaskSchema = new Schema<IKanbanTask>(
  {
    _id: { type: String, required: true },
    projectId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: null },
    status: {
      type: String,
      enum: ['todo', 'wip', 'done', 'code_review', 'done_unit_test', 'done_e2e_testing', 'deploy'],
      default: 'todo',
    },
    position: { type: Number, default: 0 },
    commitUrl: { type: String, default: null },
  },
  {
    timestamps: true,
    _id: false,
  }
);

// Compound index for efficient querying by project and status
KanbanTaskSchema.index({ projectId: 1, status: 1 });

export const KanbanTask = mongoose.model<IKanbanTask>('KanbanTask', KanbanTaskSchema);
