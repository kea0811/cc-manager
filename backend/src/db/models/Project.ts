import mongoose, { Schema } from 'mongoose';

export type DevPhase = 'idle' | 'setup' | 'development' | 'code_review' | 'unit_tests' | 'e2e_tests' | 'deploy' | 'complete' | 'error';

export interface IDevelopmentStatus {
  isRunning: boolean;
  phase: DevPhase;
  message: string;
  startedAt: Date | null;
  logs: string[];
  error: string | null;
}

export interface IProject {
  _id: string;
  name: string;
  description: string | null;
  githubRepo: string | null;
  status: 'draft' | 'development' | 'deployed';
  editorContent: string;
  deployedUrl: string | null;
  webUrl: string | null;
  developmentStatus: IDevelopmentStatus;
  createdAt: Date;
  updatedAt: Date;
}

const DevelopmentStatusSchema = new Schema<IDevelopmentStatus>(
  {
    isRunning: { type: Boolean, default: false },
    phase: {
      type: String,
      enum: ['idle', 'setup', 'development', 'code_review', 'unit_tests', 'e2e_tests', 'deploy', 'complete', 'error'],
      default: 'idle',
    },
    message: { type: String, default: '' },
    startedAt: { type: Date, default: null },
    logs: { type: [String], default: [] },
    error: { type: String, default: null },
  },
  { _id: false }
);

const ProjectSchema = new Schema<IProject>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: null },
    githubRepo: { type: String, default: null },
    status: {
      type: String,
      enum: ['draft', 'development', 'deployed'],
      default: 'draft',
    },
    editorContent: { type: String, default: '' },
    deployedUrl: { type: String, default: null },
    webUrl: { type: String, default: null },
    developmentStatus: {
      type: DevelopmentStatusSchema,
      default: () => ({
        isRunning: false,
        phase: 'idle',
        message: '',
        startedAt: null,
        logs: [],
        error: null,
      }),
    },
  },
  {
    timestamps: true,
    _id: false,
  }
);

export const Project = mongoose.model<IProject>('Project', ProjectSchema);
