import { v4 as uuidv4 } from 'uuid';
import { ChatMessageModel, mapChatMessageDoc } from '../db/index.js';
import type { ChatMessage, CreateChatMessage } from '../types/index.js';

export const getChatHistory = async (projectId: string): Promise<ChatMessage[]> => {
  const docs = await ChatMessageModel.find({ projectId }).sort({ createdAt: 1 });
  return docs.map(mapChatMessageDoc);
};

export const addChatMessage = async (projectId: string, data: CreateChatMessage): Promise<ChatMessage> => {
  const id = uuidv4();

  const doc = await ChatMessageModel.create({
    _id: id,
    projectId,
    role: data.role,
    content: data.content,
  });

  return mapChatMessageDoc(doc);
};

export const deleteChatHistory = async (projectId: string): Promise<number> => {
  const result = await ChatMessageModel.deleteMany({ projectId });
  return result.deletedCount;
};

export const getChatMessageById = async (id: string): Promise<ChatMessage | null> => {
  const doc = await ChatMessageModel.findById(id);
  return doc ? mapChatMessageDoc(doc) : null;
};
