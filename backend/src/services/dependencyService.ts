import type { KanbanTask } from '../types/index.js';

/**
 * Dependency graph representation
 */
export interface DependencyGraph {
  // Map of taskId -> array of task IDs it depends on
  dependencies: Map<string, string[]>;
  // Map of taskId -> array of task IDs that depend on it
  dependents: Map<string, string[]>;
  // Tasks with no dependencies (can start immediately)
  roots: string[];
  // All task IDs in the graph
  taskIds: string[];
}

/**
 * Result of topological sort - batches of tasks that can run in parallel
 */
export interface ExecutionPlan {
  // Each batch contains task IDs that can run in parallel
  batches: string[][];
  // Total number of tasks
  totalTasks: number;
  // Whether the graph has cycles (invalid)
  hasCycles: boolean;
  // Tasks involved in cycles (if any)
  cyclicTasks: string[];
}

/**
 * Service for managing task dependencies and execution ordering
 */
export class DependencyService {
  /**
   * Build a dependency graph from a list of tasks
   */
  buildGraph(tasks: KanbanTask[]): DependencyGraph {
    const dependencies = new Map<string, string[]>();
    const dependents = new Map<string, string[]>();
    const taskIds = tasks.map(t => t.id);

    // Initialize maps
    for (const task of tasks) {
      dependencies.set(task.id, [...task.dependencies]);
      dependents.set(task.id, []);
    }

    // Build dependents map (reverse of dependencies)
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        const deps = dependents.get(depId);
        if (deps) {
          deps.push(task.id);
        }
      }
    }

    // Find roots (tasks with no dependencies)
    const roots = tasks
      .filter(t => t.dependencies.length === 0)
      .map(t => t.id);

    return { dependencies, dependents, roots, taskIds };
  }

  /**
   * Detect circular dependencies using DFS
   * Returns array of task IDs involved in cycles
   */
  detectCycles(graph: DependencyGraph): string[] {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cyclicTasks = new Set<string>();

    const dfs = (taskId: string): boolean => {
      visited.add(taskId);
      recursionStack.add(taskId);

      const deps = graph.dependencies.get(taskId) || [];
      for (const depId of deps) {
        if (!visited.has(depId)) {
          if (dfs(depId)) {
            cyclicTasks.add(taskId);
            return true;
          }
        } else if (recursionStack.has(depId)) {
          // Found a cycle
          cyclicTasks.add(taskId);
          cyclicTasks.add(depId);
          return true;
        }
      }

      recursionStack.delete(taskId);
      return false;
    };

    for (const taskId of graph.taskIds) {
      if (!visited.has(taskId)) {
        dfs(taskId);
      }
    }

    return Array.from(cyclicTasks);
  }

  /**
   * Validate that adding dependencies won't create a cycle
   */
  validateNoCycles(
    taskId: string,
    newDependencyIds: string[],
    tasks: KanbanTask[]
  ): { valid: boolean; cyclePath?: string[] } {
    // Create a temporary task list with updated dependencies
    const tempTasks = tasks.map(t =>
      t.id === taskId
        ? { ...t, dependencies: newDependencyIds }
        : t
    );

    const graph = this.buildGraph(tempTasks);
    const cyclicTasks = this.detectCycles(graph);

    if (cyclicTasks.length > 0) {
      return { valid: false, cyclePath: cyclicTasks };
    }

    return { valid: true };
  }

  /**
   * Get execution order using Kahn's algorithm (topological sort)
   * Returns batches of tasks that can run in parallel
   */
  getExecutionOrder(tasks: KanbanTask[]): ExecutionPlan {
    const graph = this.buildGraph(tasks);
    const cyclicTasks = this.detectCycles(graph);

    if (cyclicTasks.length > 0) {
      return {
        batches: [],
        totalTasks: tasks.length,
        hasCycles: true,
        cyclicTasks,
      };
    }

    const batches: string[][] = [];
    const inDegree = new Map<string, number>();
    const remaining = new Set(graph.taskIds);

    // Calculate in-degrees (number of dependencies)
    for (const taskId of graph.taskIds) {
      const deps = graph.dependencies.get(taskId) || [];
      // Only count dependencies that are in the task list
      const validDeps = deps.filter(d => remaining.has(d));
      inDegree.set(taskId, validDeps.length);
    }

    // Process batches until all tasks are scheduled
    while (remaining.size > 0) {
      // Find all tasks with in-degree 0 (no pending dependencies)
      const batch: string[] = [];
      for (const taskId of remaining) {
        if (inDegree.get(taskId) === 0) {
          batch.push(taskId);
        }
      }

      if (batch.length === 0) {
        // This shouldn't happen if there are no cycles, but just in case
        break;
      }

      // Add batch to result
      batches.push(batch);

      // Remove batch tasks and update in-degrees of dependents
      for (const taskId of batch) {
        remaining.delete(taskId);
        const deps = graph.dependents.get(taskId) || [];
        for (const depId of deps) {
          const current = inDegree.get(depId) || 0;
          inDegree.set(depId, current - 1);
        }
      }
    }

    return {
      batches,
      totalTasks: tasks.length,
      hasCycles: false,
      cyclicTasks: [],
    };
  }

  /**
   * Get tasks that can be executed immediately (dependencies satisfied)
   */
  getExecutableTasks(tasks: KanbanTask[]): KanbanTask[] {
    const completedIds = new Set(
      tasks
        .filter(t => ['done', 'code_review', 'done_unit_test', 'done_e2e_testing', 'deploy'].includes(t.status))
        .map(t => t.id)
    );

    return tasks.filter(task => {
      // Task must be in 'todo' status
      if (task.status !== 'todo') return false;

      // All dependencies must be completed
      return task.dependencies.every(depId => completedIds.has(depId));
    });
  }

  /**
   * Check if all dependencies of a task are satisfied
   */
  areDependenciesSatisfied(taskId: string, tasks: KanbanTask[]): boolean {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return false;

    const completedStatuses = ['done', 'code_review', 'done_unit_test', 'done_e2e_testing', 'deploy'];
    const completedIds = new Set(
      tasks
        .filter(t => completedStatuses.includes(t.status))
        .map(t => t.id)
    );

    return task.dependencies.every(depId => completedIds.has(depId));
  }

  /**
   * Get tasks that depend on a given task
   */
  getDependentTasks(taskId: string, tasks: KanbanTask[]): KanbanTask[] {
    return tasks.filter(t => t.dependencies.includes(taskId));
  }

  /**
   * Get tasks that a given task depends on
   */
  getDependencyTasks(taskId: string, tasks: KanbanTask[]): KanbanTask[] {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return [];

    return tasks.filter(t => task.dependencies.includes(t.id));
  }

  /**
   * Resolve dependency IDs from task titles (for PRD analysis)
   * Used when Claude returns dependencies as titles instead of IDs
   */
  resolveDependenciesByTitle(
    tasks: Array<{ title: string; dependencies: string[] }>,
    createdTasks: Array<{ id: string; title: string }>
  ): Map<string, string[]> {
    const titleToId = new Map(createdTasks.map(t => [t.title.toLowerCase(), t.id]));
    const result = new Map<string, string[]>();

    for (const task of tasks) {
      const taskEntry = createdTasks.find(ct => ct.title === task.title);
      if (!taskEntry) continue;

      const resolvedDeps = task.dependencies
        .map(depTitle => titleToId.get(depTitle.toLowerCase()))
        .filter((id): id is string => id !== undefined);

      result.set(taskEntry.id, resolvedDeps);
    }

    return result;
  }
}

// Singleton instance
export const dependencyService = new DependencyService();
