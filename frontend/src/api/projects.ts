import { apiClient } from './client';
import type {
  Project,
  CreateProjectData,
  UpdateProjectData,
  ChatMessage,
  CreateChatMessageData,
  KanbanTask,
  CreateKanbanTaskData,
  UpdateKanbanTaskData,
  MoveTaskData,
  TaskComment,
  CreateTaskCommentData,
  StreamEvent,
  DevStreamEvent,
  UpdateDependenciesData,
  CommitSummary,
} from '@/types';

export interface ProcessResponse {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  editorUpdate: {
    content: string;
    diff: {
      hasChanges: boolean;
      addedLines: number;
      removedLines: number;
    };
  } | null;
}

export const projectsApi = {
  getAll: (): Promise<Project[]> => apiClient.get('/projects'),

  getById: (id: string): Promise<Project> => apiClient.get(`/projects/${id}`),

  create: (data: CreateProjectData): Promise<Project> => apiClient.post('/projects', data),

  update: (id: string, data: UpdateProjectData): Promise<Project> => apiClient.patch(`/projects/${id}`, data),

  delete: (id: string): Promise<void> => apiClient.delete(`/projects/${id}`),

  updateEditor: (id: string, content: string): Promise<Project> =>
    apiClient.put(`/projects/${id}/editor`, { content }),

  getChatHistory: (id: string): Promise<ChatMessage[]> => apiClient.get(`/projects/${id}/chat`),

  addChatMessage: (id: string, data: CreateChatMessageData): Promise<ChatMessage> =>
    apiClient.post(`/projects/${id}/chat`, data),

  clearChatHistory: (id: string): Promise<void> => apiClient.delete(`/projects/${id}/chat`),

  processInput: (id: string, content: string): Promise<ProcessResponse> =>
    apiClient.post(`/projects/${id}/process`, { content }),

  // Kanban API
  getKanbanTasks: (id: string): Promise<KanbanTask[]> =>
    apiClient.get(`/projects/${id}/kanban`),

  createKanbanTask: (id: string, data: CreateKanbanTaskData): Promise<KanbanTask> =>
    apiClient.post(`/projects/${id}/kanban`, data),

  updateKanbanTask: (id: string, taskId: string, data: UpdateKanbanTaskData): Promise<KanbanTask> =>
    apiClient.patch(`/projects/${id}/kanban/${taskId}`, data),

  moveKanbanTask: (id: string, taskId: string, data: MoveTaskData): Promise<KanbanTask> =>
    apiClient.put(`/projects/${id}/kanban/${taskId}/move`, data),

  deleteKanbanTask: (id: string, taskId: string): Promise<void> =>
    apiClient.delete(`/projects/${id}/kanban/${taskId}`),

  // Task Dependencies API
  updateTaskDependencies: (id: string, taskId: string, data: UpdateDependenciesData): Promise<KanbanTask> =>
    apiClient.put(`/projects/${id}/kanban/${taskId}/dependencies`, data),

  getTaskDependencies: (id: string, taskId: string): Promise<{
    taskId: string;
    dependencies: Array<{ id: string; title: string; status: string }>;
    dependents: Array<{ id: string; title: string; status: string }>;
    areDependenciesSatisfied: boolean;
  }> => apiClient.get(`/projects/${id}/kanban/${taskId}/dependencies`),

  getExecutionPlan: (id: string): Promise<{
    batches: Array<Array<{ id: string; title: string; dependencies: string[] }>>;
    totalTasks: number;
    totalBatches: number;
    hasCycles: boolean;
    cyclicTasks: string[];
  }> => apiClient.get(`/projects/${id}/execution-plan`),

  // Commits API
  getCommitSummary: (id: string): Promise<CommitSummary> =>
    apiClient.get(`/projects/${id}/commits`),

  // Parse new tasks from PRD (for deployed/development projects)
  parseNewTasks: (id: string): Promise<{ success: boolean; tasks: KanbanTask[]; message?: string }> =>
    apiClient.post(`/projects/${id}/parse-new-tasks`, {}),

  // Development API
  startDevelop: (id: string): Promise<{ success: boolean; tasks: KanbanTask[] }> =>
    apiClient.post(`/projects/${id}/start-develop`, {}),

  developNext: (id: string): Promise<{
    success: boolean;
    task?: KanbanTask;
    output?: string;
    complete?: boolean;
    message?: string;
  }> => apiClient.post(`/projects/${id}/develop-next`, {}),

  developAll: (id: string): Promise<{ success: boolean; message: string }> =>
    apiClient.post(`/projects/${id}/develop-all`, {}),

  deploy: (id: string): Promise<{ success: boolean; output: string; path: string }> =>
    apiClient.post(`/projects/${id}/deploy`, {}),

  // Task Comment API
  getTaskComments: (projectId: string, taskId: string): Promise<TaskComment[]> =>
    apiClient.get(`/projects/${projectId}/kanban/${taskId}/comments`),

  addTaskComment: (projectId: string, taskId: string, data: CreateTaskCommentData): Promise<TaskComment> =>
    apiClient.post(`/projects/${projectId}/kanban/${taskId}/comments`, data),

  deleteTaskComment: (projectId: string, taskId: string, commentId: string): Promise<void> =>
    apiClient.delete(`/projects/${projectId}/kanban/${taskId}/comments/${commentId}`),

  // ============ Streaming API ============

  /**
   * Stream chat processing via Server-Sent Events
   * @returns EventSource and abort function
   */
  streamProcess: (
    id: string,
    content: string,
    callbacks: {
      onEvent: (event: StreamEvent) => void;
      onError: (error: Error) => void;
      onComplete: () => void;
    }
  ): { eventSource: EventSource; abort: () => void } => {
    const url = `/api/projects/${id}/stream?content=${encodeURIComponent(content)}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as StreamEvent;
        callbacks.onEvent(data);

        if (data.type === 'done') {
          eventSource.close();
          callbacks.onComplete();
        }
      } catch (err) {
        console.error('Failed to parse stream event:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('EventSource error:', err);
      eventSource.close();
      callbacks.onError(new Error('Connection lost'));
    };

    return {
      eventSource,
      abort: () => {
        eventSource.close();
        // Also call backend abort endpoint
        fetch(`/api/projects/${id}/stream/abort`, { method: 'POST' }).catch(() => {});
      },
    };
  },

  /**
   * Abort any active stream for a project
   */
  abortStream: (id: string): Promise<{ success: boolean }> =>
    apiClient.post(`/projects/${id}/stream/abort`, {}),

  // ============ Development Streaming API ============

  /**
   * Stream development pipeline via Server-Sent Events
   * @returns EventSource and abort function
   */
  streamDevelopment: (
    id: string,
    callbacks: {
      onEvent: (event: DevStreamEvent) => void;
      onError: (error: Error) => void;
      onComplete: () => void;
    }
  ): { eventSource: EventSource; abort: () => void } => {
    const url = `/api/projects/${id}/develop-stream`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as DevStreamEvent;
        callbacks.onEvent(data);

        if (data.type === 'done') {
          eventSource.close();
          callbacks.onComplete();
        }
      } catch (err) {
        console.error('Failed to parse dev stream event:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('Dev EventSource error:', err);
      eventSource.close();
      callbacks.onError(new Error('Connection lost'));
    };

    return {
      eventSource,
      abort: () => {
        eventSource.close();
        fetch(`/api/projects/${id}/develop-stream/abort`, { method: 'POST' }).catch(() => {});
      },
    };
  },

  /**
   * Abort development stream for a project
   */
  abortDevelopmentStream: (id: string): Promise<{ success: boolean }> =>
    apiClient.post(`/projects/${id}/develop-stream/abort`, {}),

  /**
   * Get current development status for a project
   */
  getDevelopmentStatus: (id: string): Promise<{
    isRunning: boolean;
    phase: string;
    message: string;
    startedAt: string | null;
    logs: string[];
    error: string | null;
    hasActiveStream: boolean;
  }> => apiClient.get(`/projects/${id}/development-status`),

  // ============ Parallel Development Streaming API ============

  /**
   * Stream parallel development pipeline via Server-Sent Events
   * @returns EventSource and abort function
   */
  streamParallelDevelopment: (
    id: string,
    callbacks: {
      onEvent: (event: DevStreamEvent) => void;
      onError: (error: Error) => void;
      onComplete: () => void;
    }
  ): { eventSource: EventSource; abort: () => void } => {
    const url = `/api/projects/${id}/develop-parallel-stream`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as DevStreamEvent;
        callbacks.onEvent(data);

        if (data.type === 'done' || data.type === 'aborted') {
          eventSource.close();
          callbacks.onComplete();
        }
      } catch (err) {
        console.error('Failed to parse parallel dev stream event:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('Parallel Dev EventSource error:', err);
      eventSource.close();
      callbacks.onError(new Error('Connection lost'));
    };

    return {
      eventSource,
      abort: () => {
        eventSource.close();
        fetch(`/api/projects/${id}/develop-parallel-stream/abort`, { method: 'POST' }).catch(() => {});
      },
    };
  },

  /**
   * Abort parallel development stream for a project
   */
  abortParallelDevelopmentStream: (id: string): Promise<{ success: boolean }> =>
    apiClient.post(`/projects/${id}/develop-parallel-stream/abort`, {}),
};
