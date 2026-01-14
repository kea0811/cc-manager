import mongoose, { Schema, Document } from 'mongoose';

export interface IProject extends Document {
  _id: string;
  name: string;
  description: string | null;
  githubRepo: string | null;
  status: 'draft' | 'development' | 'deployed';
  editorContent: string;
  deployedUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

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
  },
  {
    timestamps: true,
    _id: false,
  }
);

export const Project = mongoose.model<IProject>('Project', ProjectSchema);
