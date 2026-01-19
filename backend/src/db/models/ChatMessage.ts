import mongoose, { Schema } from 'mongoose';

export interface IChatMessage {
  _id: string;
  projectId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

const ChatMessageSchema = new Schema<IChatMessage>(
  {
    _id: { type: String, required: true },
    projectId: { type: String, required: true, index: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    _id: false,
  }
);

// Index for efficient querying by project
ChatMessageSchema.index({ projectId: 1, createdAt: 1 });

export const ChatMessage = mongoose.model<IChatMessage>('ChatMessage', ChatMessageSchema);
