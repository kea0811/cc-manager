import mongoose, { Schema } from 'mongoose';

// Execution group status
export type ExecutionGroupStatus = 'pending' | 'running' | 'completed' | 'failed' | 'aborted';

export interface IExecutionGroup {
  _id: string;
  projectId: string;
  status: ExecutionGroupStatus;
  taskIds: string[];              // Task IDs in this parallel batch
  containerIds: string[];         // Active Docker container IDs
  batchNumber: number;            // Which batch in the execution order (1, 2, 3...)
  totalBatches: number;           // Total number of batches
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ExecutionGroupSchema = new Schema<IExecutionGroup>(
  {
    _id: { type: String, required: true },
    projectId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed', 'aborted'],
      default: 'pending',
    },
    taskIds: { type: [String], default: [] },
    containerIds: { type: [String], default: [] },
    batchNumber: { type: Number, required: true },
    totalBatches: { type: Number, required: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    errorMessage: { type: String, default: null },
  },
  {
    timestamps: true,
    _id: false,
  }
);

// Index for finding active execution groups
ExecutionGroupSchema.index({ projectId: 1, status: 1 });

export const ExecutionGroup = mongoose.model<IExecutionGroup>('ExecutionGroup', ExecutionGroupSchema);
