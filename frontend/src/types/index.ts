export type ProjectStatus = 'draft' | 'development' | 'deployed';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  githubRepo: string | null;
  status: ProjectStatus;
  editorContent: string;
  deployedUrl: string | null;
  webUrl: string | null;
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
  webUrl?: string;
}

export interface CommitSummary {
  totalCommits: number;
  commits: Array<{
    taskId: string;
    taskTitle: string;
    commitUrl: string;
  }>;
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

// Parallel development types
export type TestStatus = 'pending' | 'running' | 'passed' | 'failed';
export type MergeStatus = 'pending' | 'merged' | 'conflict';
export type ExecutionGroupStatus = 'pending' | 'running' | 'completed' | 'failed' | 'aborted';

export interface KanbanTask {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: KanbanStatus;
  position: number;
  commitUrl: string | null;
  // Parallel development fields
  dependencies: string[];
  branchName: string | null;
  testCoverage: number | null;
  testStatus: TestStatus | null;
  mergeStatus: MergeStatus | null;
  executionGroupId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionGroup {
  id: string;
  projectId: string;
  status: ExecutionGroupStatus;
  taskIds: string[];
  containerIds: string[];
  batchNumber: number;
  totalBatches: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
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
  | 'tasks_created'  // New tasks auto-created from PRD
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
  // For tasks_created event
  tasks?: Array<{ title: string }>;
  count?: number;
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
  | 'done'
  | 'reconnected'
  // Parallel development events
  | 'plan'
  | 'batch_start'
  | 'batch_complete'
  | 'task_setup'
  | 'task_claude'
  | 'task_commit'
  | 'task_error'
  | 'merge_start'
  | 'merge_complete'
  | 'merge_conflict'
  | 'merge_batch_complete'
  // Code review events
  | 'review_start'
  | 'review_task_start'
  | 'review_progress'
  | 'review_task_complete'
  | 'review_fix_start'
  | 'review_fix_progress'
  | 'review_fix_complete'
  | 'review_task_failed'
  | 'review_batch_complete';

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
  mode?: 'sequential' | 'parallel';
  // Tasks list
  total?: number;
  tasks?: Array<{ id: string; title: string }>;
  // Claude events (nested)
  content?: string;
  tool_name?: string;
  event?: Record<string, unknown>; // Nested claude event for parallel
  // Done event
  success?: boolean;
  // Parallel batch events
  batchNumber?: number;
  totalBatches?: number;
  taskCount?: number;
  branchName?: string;
  successCount?: number;
  failedCount?: number;
  results?: Array<{ taskId: string; success: boolean; branchName: string; commitUrl?: string; error?: string }>;
  // Merge events
  branches?: string[];
  error?: string;
  // Plan event
  plan?: Array<{
    batchNumber: number;
    taskIds: string[];
    tasks: Array<{ id: string; title: string } | null>;
  }>;
  batches?: number;
  // Code review events
  attempt?: number;
  maxAttempts?: number;
  qualityScore?: number;
  passed?: boolean;
  summary?: string;
  issues?: string[];
  suggestions?: string[];
  retriesExhausted?: boolean;
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

// ============ Parallel Execution Types ============

export interface UpdateDependenciesData {
  dependencyIds: string[];
}

export type ParallelEventType =
  | 'plan_ready'
  | 'batch_start'
  | 'batch_complete'
  | 'task_start'
  | 'task_progress'
  | 'task_complete'
  | 'task_error'
  | 'coverage_result'
  | 'merge_start'
  | 'merge_complete'
  | 'merge_conflict'
  | 'execution_complete'
  | 'execution_error';

export interface ParallelStreamEvent {
  type: ParallelEventType;
  // Plan ready
  batches?: string[][];
  totalTasks?: number;
  totalBatches?: number;
  // Batch events
  batchNumber?: number;
  groupId?: string;
  taskIds?: string[];
  taskCount?: number;
  success?: boolean;
  completedTasks?: string[];
  failedTasks?: Array<{ taskId: string; error?: string }>;
  // Task events
  taskId?: string;
  taskTitle?: string;
  branchName?: string;
  // Coverage
  coverage?: number;
  coveragePassed?: boolean;
  uncoveredFiles?: string[];
  // Merge events
  commitHash?: string;
  conflictFiles?: string[];
  // Error
  error?: string;
  cyclicTasks?: string[];
}

export interface ParallelStreamState {
  isRunning: boolean;
  currentBatch: number;
  totalBatches: number;
  activeTasks: Array<{
    taskId: string;
    title: string;
    branchName: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    coverage?: number;
    coveragePassed?: boolean;
  }>;
  completedBatches: number;
  errors: string[];
}
