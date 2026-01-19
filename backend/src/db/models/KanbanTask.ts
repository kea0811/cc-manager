import mongoose, { Schema } from 'mongoose';

// Test execution status
export type TestStatus = 'pending' | 'running' | 'passed' | 'failed';

// Branch merge status
export type MergeStatus = 'pending' | 'merged' | 'conflict';

export interface IKanbanTask {
  _id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: 'todo' | 'wip' | 'done' | 'code_review' | 'done_unit_test' | 'done_e2e_testing' | 'deploy';
  position: number;
  commitUrl: string | null;
  // Parallel development fields
  dependencies: string[];           // Task IDs this task depends on
  branchName: string | null;        // Feature branch name (e.g., "feature/task-abc123")
  testCoverage: number | null;      // Test coverage percentage (0-100)
  testStatus: TestStatus | null;    // Unit test execution status
  mergeStatus: MergeStatus | null;  // Branch merge status
  executionGroupId: string | null;  // Groups tasks that run in parallel together
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
    // Parallel development fields
    dependencies: { type: [String], default: [] },
    branchName: { type: String, default: null },
    testCoverage: { type: Number, default: null, min: 0, max: 100 },
    testStatus: {
      type: String,
      enum: ['pending', 'running', 'passed', 'failed', null],
      default: null,
    },
    mergeStatus: {
      type: String,
      enum: ['pending', 'merged', 'conflict', null],
      default: null,
    },
    executionGroupId: { type: String, default: null },
  },
  {
    timestamps: true,
    _id: false,
  }
);

// Compound index for efficient querying by project and status
KanbanTaskSchema.index({ projectId: 1, status: 1 });

export const KanbanTask = mongoose.model<IKanbanTask>('KanbanTask', KanbanTaskSchema);
