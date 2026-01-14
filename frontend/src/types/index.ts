export type ProjectStatus = 'draft' | 'development' | 'deployed';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  githubRepo: string | null;
  status: ProjectStatus;
  editorContent: string;
  deployedUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectData {
  name: string;
  description?: string;
}

export interface UpdateProjectData {
  name?: string;
  description?: string;
  githubRepo?: string;
  status?: ProjectStatus;
  deployedUrl?: string;
}

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  projectId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

export interface CreateChatMessageData {
  role: ChatRole;
  content: string;
}

// Kanban types
export type KanbanStatus =
  | 'todo'
  | 'wip'
  | 'done'
  | 'code_review'
  | 'done_unit_test'
  | 'done_e2e_testing'
  | 'deploy';

export interface KanbanTask {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: KanbanStatus;
  position: number;
  commitUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskComment {
  id: string;
  taskId: string;
  content: string;
  createdAt: string;
}

export interface CreateTaskCommentData {
  content: string;
}

export interface CreateKanbanTaskData {
  title: string;
  description?: string;
  status?: KanbanStatus;
}

export interface UpdateKanbanTaskData {
  title?: string;
  description?: string;
  status?: KanbanStatus;
  position?: number;
}

export interface MoveTaskData {
  status: KanbanStatus;
  position: number;
}

// Kanban column configuration
export const KANBAN_COLUMNS: { id: KanbanStatus; title: string; color: string }[] = [
  { id: 'todo', title: 'Todo', color: 'bg-slate-500' },
  { id: 'wip', title: 'WIP', color: 'bg-blue-500' },
  { id: 'done', title: 'Done', color: 'bg-green-500' },
  { id: 'code_review', title: 'Code Review', color: 'bg-purple-500' },
  { id: 'done_unit_test', title: 'Unit Test', color: 'bg-emerald-500' },
  { id: 'done_e2e_testing', title: 'E2E Testing', color: 'bg-teal-500' },
  { id: 'deploy', title: 'Deploy', color: 'bg-orange-500' },
];

// ============ Streaming Types ============

export type StreamEventType =
  | 'assistant'      // Claude's text response (streaming)
  | 'tool_use'       // Claude is calling a tool
  | 'tool_result'    // Result from tool execution
  | 'result'         // Final result
  | 'error'          // Error occurred
  | 'system'         // System messages
  | 'text'           // Raw text
  | 'user_message'   // User message stored
  | 'assistant_message'  // Assistant message stored
  | 'editor_update'  // Editor content updated
  | 'done';          // Stream complete

export interface StreamEvent {
  type: StreamEventType;
  content?: string;
  message?: ChatMessage | { content: string };
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  subtype?: string;
  // For editor_update event
  diff?: {
    hasChanges: boolean;
    addedLines: number;
    removedLines: number;
  };
}

// Streaming state for UI
export type StreamingPhase =
  | 'idle'
  | 'connecting'
  | 'thinking'
  | 'writing'
  | 'tool_use'
  | 'complete'
  | 'error';

export interface StreamingState {
  phase: StreamingPhase;
  content: string;
  currentTool: string | null;
  error: string | null;
}

// ============ Development Streaming Types ============

export type DevPhase =
  | 'setup'
  | 'development'
  | 'code_review'
  | 'unit_tests'
  | 'e2e_tests'
  | 'deploy'
  | 'complete';

export type DevEventType =
  | 'init'
  | 'tasks'
  | 'phase'
  | 'task_start'
  | 'task_complete'
  | 'task_failed'
  | 'task_moved'
  | 'task_claude_complete'
  | 'setup'
  | 'claude'
  | 'commit'
  | 'test_complete'
  | 'deploy_complete'
  | 'error'
  | 'aborted'
  | 'done';

export interface DevStreamEvent {
  type: DevEventType;
  // Phase events
  phase?: DevPhase;
  message?: string;
  // Task events
  taskId?: string;
  taskTitle?: string;
  taskIndex?: number;
  totalTasks?: number;
  status?: KanbanStatus;
  commitUrl?: string;
  // Init events
  projectId?: string;
  projectName?: string;
  // Tasks list
  total?: number;
  tasks?: Array<{ id: string; title: string }>;
  // Claude events (nested)
  content?: string;
  tool_name?: string;
  // Done event
  success?: boolean;
}

export interface DevStreamState {
  isRunning: boolean;
  currentPhase: DevPhase | null;
  currentTask: { id: string; title: string; index: number; total: number } | null;
  claudeOutput: string;
  currentTool: string | null;
  setupMessage: string | null;
  completedTasks: string[];
  errors: string[];
}
