import { exec } from 'child_process';
import { promisify } from 'util';
import type { KanbanTask } from '../types/index.js';
import * as kanbanService from './kanbanService.js';

const execAsync = promisify(exec);

/**
 * Result of a merge operation
 */
export interface MergeResult {
  success: boolean;
  taskId: string;
  branchName: string;
  commitHash?: string;
  conflictFiles?: string[];
  error?: string;
}

/**
 * Service for managing git branch merges
 */
export class MergeService {
  /**
   * Merge a feature branch to main in a Docker container
   */
  async mergeBranchInContainer(
    containerId: string,
    branchName: string,
    taskId: string,
    workDir: string = '/app'
  ): Promise<MergeResult> {
    try {
      // Update merge status to pending
      await kanbanService.updateTaskMergeStatus(taskId, 'pending');

      // Checkout main and pull latest
      await execAsync(
        `docker exec ${containerId} sh -c "cd ${workDir} && git checkout main && git pull origin main 2>/dev/null || true"`,
        { timeout: 60000 }
      );

      // Try to merge the feature branch
      try {
        const { stdout } = await execAsync(
          `docker exec ${containerId} sh -c "cd ${workDir} && git merge ${branchName} --no-ff -m 'Merge ${branchName} into main'"`,
          { timeout: 60000 }
        );

        // Get the merge commit hash
        const { stdout: hashStdout } = await execAsync(
          `docker exec ${containerId} sh -c "cd ${workDir} && git rev-parse HEAD"`,
          { timeout: 10000 }
        );

        const commitHash = hashStdout.trim();

        // Update task status
        await kanbanService.updateTaskMergeStatus(taskId, 'merged');

        return {
          success: true,
          taskId,
          branchName,
          commitHash,
        };
      } catch (mergeError) {
        // Check if it's a merge conflict
        const errorStr = mergeError instanceof Error ? mergeError.message : String(mergeError);

        if (errorStr.includes('CONFLICT') || errorStr.includes('merge conflict')) {
          // Get list of conflicting files
          const { stdout: conflictOutput } = await execAsync(
            `docker exec ${containerId} sh -c "cd ${workDir} && git diff --name-only --diff-filter=U"`,
            { timeout: 10000 }
          );

          const conflictFiles = conflictOutput.trim().split('\n').filter(Boolean);

          // Abort the merge
          await execAsync(
            `docker exec ${containerId} sh -c "cd ${workDir} && git merge --abort"`,
            { timeout: 10000 }
          );

          // Update task status
          await kanbanService.updateTaskMergeStatus(taskId, 'conflict');

          // Move task back to WIP for conflict resolution
          await kanbanService.moveTask(taskId, 'wip', 0);

          return {
            success: false,
            taskId,
            branchName,
            conflictFiles,
            error: `Merge conflict in files: ${conflictFiles.join(', ')}`,
          };
        }

        throw mergeError;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      return {
        success: false,
        taskId,
        branchName,
        error: errorMsg,
      };
    }
  }

  /**
   * Merge multiple branches in dependency order
   * Returns results for each merge
   */
  async mergeTasksInOrder(
    containerId: string,
    tasks: KanbanTask[],
    workDir: string = '/app'
  ): Promise<MergeResult[]> {
    const results: MergeResult[] = [];

    // Sort tasks by their dependencies (tasks with no deps first)
    const sortedTasks = this.sortByDependencies(tasks);

    for (const task of sortedTasks) {
      if (!task.branchName) {
        results.push({
          success: false,
          taskId: task.id,
          branchName: '',
          error: 'No branch name set for task',
        });
        continue;
      }

      const result = await this.mergeBranchInContainer(
        containerId,
        task.branchName,
        task.id,
        workDir
      );

      results.push(result);

      // If merge failed with conflict, stop processing
      if (!result.success && result.conflictFiles) {
        break;
      }
    }

    return results;
  }

  /**
   * Sort tasks so that dependencies come before dependents
   */
  private sortByDependencies(tasks: KanbanTask[]): KanbanTask[] {
    const sorted: KanbanTask[] = [];
    const visited = new Set<string>();
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    const visit = (task: KanbanTask) => {
      if (visited.has(task.id)) return;
      visited.add(task.id);

      // Visit dependencies first
      for (const depId of task.dependencies) {
        const dep = taskMap.get(depId);
        if (dep && !visited.has(depId)) {
          visit(dep);
        }
      }

      sorted.push(task);
    };

    for (const task of tasks) {
      visit(task);
    }

    return sorted;
  }

  /**
   * Delete a merged feature branch
   */
  async deleteBranchInContainer(
    containerId: string,
    branchName: string,
    workDir: string = '/app'
  ): Promise<boolean> {
    try {
      // Delete local branch
      await execAsync(
        `docker exec ${containerId} sh -c "cd ${workDir} && git branch -d ${branchName}"`,
        { timeout: 30000 }
      );

      // Try to delete remote branch (may fail if not pushed)
      try {
        await execAsync(
          `docker exec ${containerId} sh -c "cd ${workDir} && git push origin --delete ${branchName}"`,
          { timeout: 30000 }
        );
      } catch {
        // Ignore - branch may not exist on remote
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Push merged main branch to origin
   */
  async pushMainInContainer(
    containerId: string,
    workDir: string = '/app'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await execAsync(
        `docker exec ${containerId} sh -c "cd ${workDir} && git push origin main"`,
        { timeout: 120000 }
      );

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Create a feature branch in a container
   */
  async createBranchInContainer(
    containerId: string,
    branchName: string,
    workDir: string = '/app'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Ensure we're on main and up to date
      await execAsync(
        `docker exec ${containerId} sh -c "cd ${workDir} && git checkout main && git pull origin main 2>/dev/null || true"`,
        { timeout: 60000 }
      );

      // Create and checkout new branch
      await execAsync(
        `docker exec ${containerId} sh -c "cd ${workDir} && git checkout -b ${branchName}"`,
        { timeout: 30000 }
      );

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Check if a branch exists
   */
  async branchExistsInContainer(
    containerId: string,
    branchName: string,
    workDir: string = '/app'
  ): Promise<boolean> {
    try {
      await execAsync(
        `docker exec ${containerId} sh -c "cd ${workDir} && git rev-parse --verify ${branchName}"`,
        { timeout: 10000 }
      );
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const mergeService = new MergeService();
