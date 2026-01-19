import { v4 as uuidv4 } from 'uuid';
import { ProjectModel, mapProjectDoc } from '../db/index.js';
import type { Project, CreateProject, UpdateProject } from '../types/index.js';

export const getAllProjects = async (): Promise<Project[]> => {
  const docs = await ProjectModel.find().sort({ updatedAt: -1 });
  return docs.map(mapProjectDoc);
};

export const getProjectById = async (id: string): Promise<Project | null> => {
  const doc = await ProjectModel.findById(id);
  return doc ? mapProjectDoc(doc) : null;
};

export const createProject = async (data: CreateProject): Promise<Project> => {
  const id = uuidv4();

  const doc = await ProjectModel.create({
    _id: id,
    name: data.name,
    description: data.description || null,
    status: 'draft',
    editorContent: '',
  });

  return mapProjectDoc(doc);
};

export const updateProject = async (id: string, data: UpdateProject | Record<string, unknown>): Promise<Project | null> => {
  const updateData: Record<string, unknown> = {};

  // Handle known UpdateProject fields
  if ('name' in data && data.name !== undefined) updateData.name = data.name;
  if ('description' in data && data.description !== undefined) updateData.description = data.description;
  if ('githubRepo' in data && data.githubRepo !== undefined) updateData.githubRepo = data.githubRepo;
  if ('status' in data && data.status !== undefined) updateData.status = data.status;
  if ('deployedUrl' in data && data.deployedUrl !== undefined) updateData.deployedUrl = data.deployedUrl;
  if ('webUrl' in data && data.webUrl !== undefined) updateData.webUrl = data.webUrl || null;

  // Handle dot-notation updates (e.g., 'developmentStatus.phase')
  for (const [key, value] of Object.entries(data)) {
    if (key.includes('.')) {
      updateData[key] = value;
    }
  }

  if (Object.keys(updateData).length === 0) {
    return getProjectById(id);
  }

  const doc = await ProjectModel.findByIdAndUpdate(id, updateData, { new: true });
  return doc ? mapProjectDoc(doc) : null;
};

export const deleteProject = async (id: string): Promise<boolean> => {
  const result = await ProjectModel.deleteOne({ _id: id });
  return result.deletedCount > 0;
};

export const updateEditorContent = async (id: string, content: string): Promise<Project | null> => {
  const doc = await ProjectModel.findByIdAndUpdate(
    id,
    { editorContent: content },
    { new: true }
  );
  return doc ? mapProjectDoc(doc) : null;
};
