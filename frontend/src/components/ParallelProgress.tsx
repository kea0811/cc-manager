import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  GitBranch,
  TestTube,
  CheckCircle2,
  XCircle,
  Loader2,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ParallelStreamState } from '@/types';

interface ParallelProgressProps {
  state: ParallelStreamState;
}

export const ParallelProgress: React.FC<ParallelProgressProps> = ({ state }) => {
  const progressPercentage =
    state.totalBatches > 0
      ? Math.round((state.completedBatches / state.totalBatches) * 100)
      : 0;

  if (!state.isRunning && state.activeTasks.length === 0) {
    return null;
  }

  return (
    <Card className="bg-card/50 backdrop-blur-sm border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          Parallel Development
          {state.isRunning && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-auto" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Overall Progress */}
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">
              Batch {state.currentBatch} of {state.totalBatches}
            </span>
            <span className="font-medium">{progressPercentage}%</span>
          </div>
          <Progress value={progressPercentage} className="h-2" />
        </div>

        {/* Active Tasks Grid */}
        {state.activeTasks.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Active Tasks</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {state.activeTasks.map((activeTask) => (
                <div
                  key={activeTask.taskId}
                  className={cn(
                    'p-3 rounded-lg border transition-colors',
                    activeTask.status === 'running' && 'border-blue-500/50 bg-blue-500/10',
                    activeTask.status === 'completed' && 'border-green-500/50 bg-green-500/10',
                    activeTask.status === 'failed' && 'border-red-500/50 bg-red-500/10',
                    activeTask.status === 'pending' && 'border-slate-500/50 bg-slate-500/10'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h5 className="font-medium text-sm truncate">{activeTask.title}</h5>

                      {/* Branch Name */}
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                        <GitBranch className="h-3 w-3" />
                        <span className="truncate">{activeTask.branchName}</span>
                      </div>
                    </div>

                    {/* Status Icon */}
                    {activeTask.status === 'running' && (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                    )}
                    {activeTask.status === 'completed' && (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    )}
                    {activeTask.status === 'failed' && (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                  </div>

                  {/* Coverage */}
                  {activeTask.coverage !== undefined && (
                    <div className="mt-2 flex items-center gap-2">
                      <TestTube
                        className={cn(
                          'h-3 w-3',
                          activeTask.coveragePassed ? 'text-green-500' : 'text-red-500'
                        )}
                      />
                      <div className="flex-1">
                        <Progress
                          value={activeTask.coverage}
                          className={cn(
                            'h-1',
                            activeTask.coveragePassed
                              ? '[&>div]:bg-green-500'
                              : '[&>div]:bg-red-500'
                          )}
                        />
                      </div>
                      <span
                        className={cn(
                          'text-xs font-medium',
                          activeTask.coveragePassed ? 'text-green-500' : 'text-red-500'
                        )}
                      >
                        {activeTask.coverage}%
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Errors */}
        {state.errors.length > 0 && (
          <div className="mt-4 p-3 rounded bg-red-500/10 border border-red-500/30">
            <h4 className="text-sm font-medium text-red-500 mb-1">Errors</h4>
            <ul className="text-xs text-red-400 space-y-1">
              {state.errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Completed Message */}
        {!state.isRunning &&
          state.completedBatches > 0 &&
          state.completedBatches === state.totalBatches && (
            <div className="mt-4 p-3 rounded bg-green-500/10 border border-green-500/30 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-sm text-green-500">
                All {state.totalBatches} batch(es) completed successfully
              </span>
            </div>
          )}
      </CardContent>
    </Card>
  );
};

// Hook to manage parallel stream state
export const useParallelStreamState = (): {
  state: ParallelStreamState;
  updateFromEvent: (event: unknown) => void;
  reset: () => void;
} => {
  const [state, setState] = React.useState<ParallelStreamState>({
    isRunning: false,
    currentBatch: 0,
    totalBatches: 0,
    activeTasks: [],
    completedBatches: 0,
    errors: [],
  });

  const updateFromEvent = React.useCallback((event: unknown): void => {
    const e = event as Record<string, unknown>;
    const type = e.type as string;

    setState((prev) => {
      switch (type) {
        case 'plan_ready':
          return {
            ...prev,
            isRunning: true,
            totalBatches: (e.totalBatches as number) || 0,
            activeTasks: [],
            errors: [],
          };

        case 'batch_start':
          return {
            ...prev,
            currentBatch: (e.batchNumber as number) || 0,
            activeTasks: ((e.taskIds as string[]) || []).map((id) => ({
              taskId: id,
              title: id,
              branchName: '',
              status: 'pending' as const,
            })),
          };

        case 'task_start':
          return {
            ...prev,
            activeTasks: prev.activeTasks.map((t) =>
              t.taskId === e.taskId
                ? {
                    ...t,
                    title: (e.taskTitle as string) || t.title,
                    branchName: (e.branchName as string) || t.branchName,
                    status: 'running' as const,
                  }
                : t
            ),
          };

        case 'task_complete':
          return {
            ...prev,
            activeTasks: prev.activeTasks.map((t) =>
              t.taskId === e.taskId
                ? {
                    ...t,
                    status: 'completed' as const,
                  }
                : t
            ),
          };

        case 'task_error':
          return {
            ...prev,
            activeTasks: prev.activeTasks.map((t) =>
              t.taskId === e.taskId
                ? {
                    ...t,
                    status: 'failed' as const,
                  }
                : t
            ),
            errors: [...prev.errors, (e.error as string) || 'Task failed'],
          };

        case 'coverage_result':
          return {
            ...prev,
            activeTasks: prev.activeTasks.map((t) =>
              t.taskId === e.taskId
                ? {
                    ...t,
                    coverage: (e.coverage as number) || 0,
                    coveragePassed: (e.coveragePassed as boolean) || false,
                  }
                : t
            ),
          };

        case 'batch_complete':
          return {
            ...prev,
            completedBatches: prev.completedBatches + 1,
          };

        case 'execution_complete':
          return {
            ...prev,
            isRunning: false,
          };

        case 'execution_error':
          return {
            ...prev,
            isRunning: false,
            errors: [...prev.errors, (e.error as string) || 'Execution failed'],
          };

        default:
          return prev;
      }
    });
  }, []);

  const reset = React.useCallback((): void => {
    setState({
      isRunning: false,
      currentBatch: 0,
      totalBatches: 0,
      activeTasks: [],
      completedBatches: 0,
      errors: [],
    });
  }, []);

  return { state, updateFromEvent, reset };
};
