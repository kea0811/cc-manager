import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  GitCommit,
  GitBranch,
  TestTube,
  GitMerge,
  Link2,
  Calendar,
  Pencil,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KanbanTask } from '@/types';
import { KANBAN_COLUMNS } from '@/types';

interface TaskDetailDialogProps {
  task: KanbanTask | null;
  allTasks: KanbanTask[];
  isOpen: boolean;
  onClose: () => void;
  onEdit: (task: KanbanTask) => void;
  onEditDependencies: (task: KanbanTask) => void;
}

export const TaskDetailDialog: React.FC<TaskDetailDialogProps> = ({
  task,
  allTasks,
  isOpen,
  onClose,
  onEdit,
  onEditDependencies,
}) => {
  if (!task) return null;

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusColor = (status: string): string => {
    const column = KANBAN_COLUMNS.find((c) => c.id === status);
    return column?.color || 'bg-slate-500';
  };

  const getStatusLabel = (status: string): string => {
    const column = KANBAN_COLUMNS.find((c) => c.id === status);
    return column?.title || status;
  };

  // Get dependency task details
  const dependencyTasks = task.dependencies
    .map((depId) => allTasks.find((t) => t.id === depId))
    .filter((t): t is KanbanTask => t !== undefined);

  // Get tasks that depend on this task
  const dependentTasks = allTasks.filter((t) => t.dependencies.includes(task.id));

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <DialogTitle className="text-xl leading-tight">{task.title}</DialogTitle>
              <div className="flex items-center gap-2 mt-2">
                <Badge className={cn(getStatusColor(task.status), 'text-white')}>
                  {getStatusLabel(task.status)}
                </Badge>
                {task.testStatus && (
                  <Badge
                    variant="outline"
                    className={cn(
                      task.testStatus === 'passed' && 'border-green-500 text-green-500',
                      task.testStatus === 'failed' && 'border-red-500 text-red-500',
                      task.testStatus === 'running' && 'border-yellow-500 text-yellow-500',
                      task.testStatus === 'pending' && 'border-slate-500 text-slate-500'
                    )}
                  >
                    {task.testStatus === 'passed' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                    {task.testStatus === 'failed' && <XCircle className="h-3 w-3 mr-1" />}
                    {task.testStatus === 'running' && <Clock className="h-3 w-3 mr-1" />}
                    {task.testStatus === 'pending' && <Clock className="h-3 w-3 mr-1" />}
                    Tests: {task.testStatus}
                  </Badge>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => onEdit(task)}>
              <Pencil className="h-4 w-4 mr-1" />
              Edit
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Description */}
          {task.description && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">Description</h4>
              <p className="text-sm whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {/* Development Info */}
          {(task.branchName || task.testCoverage !== null || task.mergeStatus || task.commitUrl) && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-3">Development Info</h4>
                <div className="space-y-3">
                  {/* Branch */}
                  {task.branchName && (
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-blue-500" />
                      <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                        {task.branchName}
                      </span>
                    </div>
                  )}

                  {/* Test Coverage */}
                  {task.testCoverage !== null && (
                    <div className="flex items-center gap-2">
                      <TestTube
                        className={cn(
                          'h-4 w-4',
                          task.testCoverage >= 100 ? 'text-green-500' : 'text-yellow-500'
                        )}
                      />
                      <span className="text-sm">
                        Test Coverage:{' '}
                        <span
                          className={cn(
                            'font-medium',
                            task.testCoverage >= 100 ? 'text-green-500' : 'text-yellow-500'
                          )}
                        >
                          {task.testCoverage}%
                        </span>
                      </span>
                    </div>
                  )}

                  {/* Merge Status */}
                  {task.mergeStatus && (
                    <div className="flex items-center gap-2">
                      <GitMerge
                        className={cn(
                          'h-4 w-4',
                          task.mergeStatus === 'merged' && 'text-purple-500',
                          task.mergeStatus === 'conflict' && 'text-red-500',
                          task.mergeStatus === 'pending' && 'text-yellow-500'
                        )}
                      />
                      <span className="text-sm">
                        Merge Status:{' '}
                        <span
                          className={cn(
                            'font-medium capitalize',
                            task.mergeStatus === 'merged' && 'text-purple-500',
                            task.mergeStatus === 'conflict' && 'text-red-500',
                            task.mergeStatus === 'pending' && 'text-yellow-500'
                          )}
                        >
                          {task.mergeStatus}
                        </span>
                      </span>
                      {task.mergeStatus === 'conflict' && (
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                  )}

                  {/* Commit URL */}
                  {task.commitUrl && (
                    <div className="flex items-center gap-2">
                      <GitCommit className="h-4 w-4 text-emerald-500" />
                      <a
                        href={task.commitUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-emerald-500 hover:underline flex items-center gap-1"
                      >
                        View Commit
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Dependencies */}
          <Separator />
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                Dependencies ({dependencyTasks.length})
              </h4>
              <Button variant="outline" size="sm" onClick={() => onEditDependencies(task)}>
                Edit Dependencies
              </Button>
            </div>
            {dependencyTasks.length > 0 ? (
              <div className="space-y-2">
                {dependencyTasks.map((dep) => (
                  <div
                    key={dep.id}
                    className="flex items-center justify-between p-2 rounded bg-muted/50"
                  >
                    <span className="text-sm truncate flex-1">{dep.title}</span>
                    <Badge
                      variant="outline"
                      className={cn('ml-2 text-xs', getStatusColor(dep.status), 'text-white border-0')}
                    >
                      {getStatusLabel(dep.status)}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No dependencies</p>
            )}
          </div>

          {/* Dependents (tasks that depend on this) */}
          {dependentTasks.length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-3">
                  Blocked Tasks ({dependentTasks.length})
                </h4>
                <p className="text-xs text-muted-foreground mb-2">
                  These tasks are waiting for this task to complete:
                </p>
                <div className="space-y-2">
                  {dependentTasks.map((dep) => (
                    <div
                      key={dep.id}
                      className="flex items-center justify-between p-2 rounded bg-muted/50"
                    >
                      <span className="text-sm truncate flex-1">{dep.title}</span>
                      <Badge
                        variant="outline"
                        className={cn('ml-2 text-xs', getStatusColor(dep.status), 'text-white border-0')}
                      >
                        {getStatusLabel(dep.status)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Timestamps */}
          <Separator />
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Created: {formatDate(task.createdAt)}
            </div>
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Updated: {formatDate(task.updatedAt)}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
