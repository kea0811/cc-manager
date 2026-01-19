import { randomUUID } from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import { ExecutionGroupModel, mapExecutionGroupDoc } from '../db/index.js';
import type { KanbanTask, ExecutionGroup, ExecutionGroupStatus } from '../types/index.js';
import { dependencyService } from './dependencyService.js';
import * as kanbanService from './kanbanService.js';

// Maximum concurrent task executions
const MAX_CONCURRENCY = parseInt(process.env.MAX_PARALLEL_TASKS || '4', 10);

/**
 * Event types for parallel execution SSE streaming
 */
export interface ParallelExecutionEvent {
  type:
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
  data: Record<string, unknown>;
}

/**
 * Active execution context for a task
 */
interface TaskExecution {
  taskId: string;
  process: ChildProcess | null;
  containerId: string | null;
  branchName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

/**
 * Service for managing parallel task execution with dependency ordering
 */
export class ParallelExecutionService {
  private activeExecutions: Map<string, TaskExecution[]> = new Map();

  /**
   * Generate a feature branch name for a task
   */
  generateBranchName(task: KanbanTask): string {
    // Use first 8 chars of task ID and sanitized title
    const shortId = task.id.substring(0, 8);
    const sanitizedTitle = task.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 30);
    return `feature/task-${shortId}-${sanitizedTitle}`;
  }

  /**
   * Create an execution group for a batch of tasks
   */
  async createExecutionGroup(
    projectId: string,
    taskIds: string[],
    batchNumber: number,
    totalBatches: number
  ): Promise<ExecutionGroup> {
    const id = randomUUID();

    const doc = await ExecutionGroupModel.create({
      _id: id,
      projectId,
      status: 'pending',
      taskIds,
      containerIds: [],
      batchNumber,
      totalBatches,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
    });

    // Update tasks with execution group ID
    for (const taskId of taskIds) {
      await kanbanService.updateTaskExecutionGroup(taskId, id);
    }

    return mapExecutionGroupDoc(doc);
  }

  /**
   * Update execution group status
   */
  async updateExecutionGroupStatus(
    groupId: string,
    status: ExecutionGroupStatus,
    errorMessage?: string
  ): Promise<ExecutionGroup | null> {
    const update: Record<string, unknown> = { status };

    if (status === 'running') {
      update.startedAt = new Date();
    } else if (status === 'completed' || status === 'failed') {
      update.completedAt = new Date();
    }

    if (errorMessage) {
      update.errorMessage = errorMessage;
    }

    const doc = await ExecutionGroupModel.findByIdAndUpdate(groupId, update, { new: true });
    return doc ? mapExecutionGroupDoc(doc) : null;
  }

  /**
   * Get execution plan with batches of parallelizable tasks
   */
  getExecutionPlan(tasks: KanbanTask[]) {
    const executableTasks = tasks.filter(t => t.status === 'todo');
    return dependencyService.getExecutionOrder(executableTasks);
  }

  /**
   * Execute a batch of tasks in parallel
   * Returns an async generator that yields execution events
   */
  async *executeBatch(
    projectId: string,
    tasks: KanbanTask[],
    batchNumber: number,
    totalBatches: number,
    developTaskFn: (task: KanbanTask, branchName: string) => AsyncGenerator<ParallelExecutionEvent>
  ): AsyncGenerator<ParallelExecutionEvent> {
    const taskIds = tasks.map(t => t.id);

    // Create execution group
    const group = await this.createExecutionGroup(projectId, taskIds, batchNumber, totalBatches);

    yield {
      type: 'batch_start',
      data: {
        batchNumber,
        totalBatches,
        groupId: group.id,
        taskIds,
        taskCount: tasks.length,
      },
    };

    // Update group status to running
    await this.updateExecutionGroupStatus(group.id, 'running');

    // Track executions for this group
    const executions: TaskExecution[] = tasks.map(task => ({
      taskId: task.id,
      process: null,
      containerId: null,
      branchName: this.generateBranchName(task),
      status: 'pending' as const,
    }));
    this.activeExecutions.set(group.id, executions);

    // Execute tasks with concurrency limit
    const results: Array<{ taskId: string; success: boolean; error?: string }> = [];
    const executing: Promise<void>[] = [];

    for (const execution of executions) {
      const task = tasks.find(t => t.id === execution.taskId)!;

      const executeTask = async () => {
        execution.status = 'running';

        // Update task with branch name and move to WIP
        await kanbanService.updateTaskBranch(execution.taskId, execution.branchName);
        await kanbanService.moveTask(execution.taskId, 'wip', 0);
        await kanbanService.updateTaskTestStatus(execution.taskId, 'pending');

        try {
          // Stream task development
          for await (const event of developTaskFn(task, execution.branchName)) {
            // Forward events but don't yield here - we'll collect them
          }

          execution.status = 'completed';
          results.push({ taskId: execution.taskId, success: true });
        } catch (error) {
          execution.status = 'failed';
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          results.push({ taskId: execution.taskId, success: false, error: errorMsg });
        }
      };

      executing.push(executeTask());

      // Respect concurrency limit
      if (executing.length >= MAX_CONCURRENCY) {
        await Promise.race(executing);
        // Remove completed promises
        for (let i = executing.length - 1; i >= 0; i--) {
          const exec = executions[i];
          if (exec && exec.status !== 'running') {
            executing.splice(i, 1);
          }
        }
      }
    }

    // Wait for all remaining tasks
    await Promise.all(executing);

    // Check results
    const failedTasks = results.filter(r => !r.success);
    const allSucceeded = failedTasks.length === 0;

    // Update group status
    await this.updateExecutionGroupStatus(
      group.id,
      allSucceeded ? 'completed' : 'failed',
      failedTasks.length > 0 ? `${failedTasks.length} task(s) failed` : undefined
    );

    // Cleanup
    this.activeExecutions.delete(group.id);

    yield {
      type: 'batch_complete',
      data: {
        batchNumber,
        totalBatches,
        groupId: group.id,
        success: allSucceeded,
        completedTasks: results.filter(r => r.success).map(r => r.taskId),
        failedTasks: failedTasks.map(r => ({ taskId: r.taskId, error: r.error })),
      },
    };
  }

  /**
   * Execute all batches in dependency order
   */
  async *executeAllBatches(
    projectId: string,
    tasks: KanbanTask[],
    developTaskFn: (task: KanbanTask, branchName: string) => AsyncGenerator<ParallelExecutionEvent>
  ): AsyncGenerator<ParallelExecutionEvent> {
    const plan = this.getExecutionPlan(tasks);

    if (plan.hasCycles) {
      yield {
        type: 'execution_error',
        data: {
          error: 'Circular dependencies detected',
          cyclicTasks: plan.cyclicTasks,
        },
      };
      return;
    }

    yield {
      type: 'plan_ready',
      data: {
        batches: plan.batches,
        totalTasks: plan.totalTasks,
        totalBatches: plan.batches.length,
      },
    };

    // Execute each batch in order
    for (let i = 0; i < plan.batches.length; i++) {
      const batchTaskIds = plan.batches[i];
      const batchTasks = tasks.filter(t => batchTaskIds.includes(t.id));

      // Execute batch and yield all events
      for await (const event of this.executeBatch(
        projectId,
        batchTasks,
        i + 1,
        plan.batches.length,
        developTaskFn
      )) {
        yield event;
      }
    }

    yield {
      type: 'execution_complete',
      data: {
        totalBatches: plan.batches.length,
        totalTasks: plan.totalTasks,
      },
    };
  }

  /**
   * Abort execution of a specific group
   */
  async abortExecution(groupId: string): Promise<boolean> {
    const executions = this.activeExecutions.get(groupId);
    if (!executions) return false;

    // Kill all running processes
    for (const execution of executions) {
      if (execution.process) {
        execution.process.kill('SIGTERM');
      }
    }

    // Update group status
    await this.updateExecutionGroupStatus(groupId, 'aborted', 'Execution aborted by user');
    this.activeExecutions.delete(groupId);

    return true;
  }

  /**
   * Get execution groups for a project
   */
  async getExecutionGroups(projectId: string): Promise<ExecutionGroup[]> {
    const docs = await ExecutionGroupModel.find({ projectId }).sort({ createdAt: -1 });
    return docs.map(mapExecutionGroupDoc);
  }

  /**
   * Get a specific execution group
   */
  async getExecutionGroup(groupId: string): Promise<ExecutionGroup | null> {
    const doc = await ExecutionGroupModel.findById(groupId);
    return doc ? mapExecutionGroupDoc(doc) : null;
  }
}

// Singleton instance
export const parallelExecutionService = new ParallelExecutionService();
