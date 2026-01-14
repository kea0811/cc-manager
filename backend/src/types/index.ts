import { z } from 'zod';

// Project schemas
export const ProjectStatusSchema = z.enum(['draft', 'development', 'deployed']);

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

// Accepts both HTTPS and SSH git URLs
const gitRepoSchema = z.string().refine(
  (val) => {
    if (!val) return true;
    // HTTPS: https://github.com/user/repo or https://github.com/user/repo.git
    const httpsPattern = /^https?:\/\/[^\s]+$/;
    // SSH: git@github.com:user/repo.git or git@gitlab.com:user/repo
    const sshPattern = /^git@[^:]+:[^\s]+$/;
    return httpsPattern.test(val) || sshPattern.test(val);
  },
  { message: 'Must be a valid HTTPS URL or SSH git URL (e.g., git@github.com:user/repo.git)' }
);

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  githubRepo: gitRepoSchema.optional(),
  status: ProjectStatusSchema.optional(),
  deployedUrl: z.string().optional(),
});

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  githubRepo: z.string().nullable(),
  status: ProjectStatusSchema,
  editorContent: z.string(),
  deployedUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Chat schemas
export const ChatRoleSchema = z.enum(['user', 'assistant']);

export const CreateChatMessageSchema = z.object({
  role: ChatRoleSchema,
  content: z.string().min(1),
});

export const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  role: ChatRoleSchema,
  content: z.string(),
  createdAt: z.string(),
});

// Editor update schema
export const UpdateEditorSchema = z.object({
  content: z.string(),
});

// Kanban schemas
export const KanbanStatusSchema = z.enum([
  'todo',
  'wip',
  'done',
  'code_review',
  'done_unit_test',
  'done_e2e_testing',
  'deploy',
]);

export const CreateKanbanTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  status: KanbanStatusSchema.optional().default('todo'),
});

export const UpdateKanbanTaskSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  status: KanbanStatusSchema.optional(),
  position: z.number().int().min(0).optional(),
});

export const KanbanTaskSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: KanbanStatusSchema,
  position: z.number(),
  commitUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Task Comment schemas
export const CreateTaskCommentSchema = z.object({
  content: z.string().min(1),
});

export const TaskCommentSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  content: z.string(),
  createdAt: z.string(),
});

export const MoveTaskSchema = z.object({
  status: KanbanStatusSchema,
  position: z.number().int().min(0),
});

// Types
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type CreateProject = z.infer<typeof CreateProjectSchema>;
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ChatRole = z.infer<typeof ChatRoleSchema>;
export type CreateChatMessage = z.infer<typeof CreateChatMessageSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type UpdateEditor = z.infer<typeof UpdateEditorSchema>;
export type KanbanStatus = z.infer<typeof KanbanStatusSchema>;
export type CreateKanbanTask = z.infer<typeof CreateKanbanTaskSchema>;
export type UpdateKanbanTask = z.infer<typeof UpdateKanbanTaskSchema>;
export type KanbanTask = z.infer<typeof KanbanTaskSchema>;
export type MoveTask = z.infer<typeof MoveTaskSchema>;
export type CreateTaskComment = z.infer<typeof CreateTaskCommentSchema>;
export type TaskComment = z.infer<typeof TaskCommentSchema>;
