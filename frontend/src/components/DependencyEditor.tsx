import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KanbanTask } from '@/types';

interface DependencyEditorProps {
  task: KanbanTask | null;
  allTasks: KanbanTask[];
  isOpen: boolean;
  onClose: () => void;
  onSave: (taskId: string, dependencyIds: string[]) => Promise<void>;
}

export const DependencyEditor: React.FC<DependencyEditorProps> = ({
  task,
  allTasks,
  isOpen,
  onClose,
  onSave,
}) => {
  const [selectedDeps, setSelectedDeps] = React.useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = React.useState(false);
  const [cycleWarning, setCycleWarning] = React.useState<string | null>(null);

  // Initialize selected deps when task changes
  React.useEffect(() => {
    if (task) {
      setSelectedDeps(new Set(task.dependencies));
      setCycleWarning(null);
    }
  }, [task]);

  // Get available tasks (exclude self and tasks that already depend on this task)
  const getAvailableTasks = (): KanbanTask[] => {
    if (!task) return [];

    return allTasks.filter((t) => {
      // Can't depend on self
      if (t.id === task.id) return false;
      return true;
    });
  };

  // Check if selecting a task would create a cycle
  const wouldCreateCycle = (potentialDepId: string): boolean => {
    if (!task) return false;

    // Build a simple cycle detection
    const visited = new Set<string>();
    const toCheck = [potentialDepId];

    while (toCheck.length > 0) {
      const currentId = toCheck.pop()!;
      if (currentId === task.id) return true;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      // Add dependencies of current task
      const currentTask = allTasks.find((t) => t.id === currentId);
      if (currentTask) {
        toCheck.push(...currentTask.dependencies);
      }
    }

    return false;
  };

  // Check if this task depends on the given task (directly or indirectly)
  const getTasksThatDependOn = (taskId: string): string[] => {
    const dependents: string[] = [];
    for (const t of allTasks) {
      if (t.dependencies.includes(taskId)) {
        dependents.push(t.id);
      }
    }
    return dependents;
  };

  const handleToggleDep = (depId: string): void => {
    const newDeps = new Set(selectedDeps);

    if (newDeps.has(depId)) {
      newDeps.delete(depId);
      setCycleWarning(null);
    } else {
      // Check for cycle
      if (wouldCreateCycle(depId)) {
        const depTask = allTasks.find((t) => t.id === depId);
        setCycleWarning(
          `Cannot add "${depTask?.title}" as a dependency - it would create a circular dependency.`
        );
        return;
      }
      newDeps.add(depId);
      setCycleWarning(null);
    }

    setSelectedDeps(newDeps);
  };

  const handleSave = async (): Promise<void> => {
    if (!task) return;

    setIsSaving(true);
    try {
      await onSave(task.id, Array.from(selectedDeps));
      onClose();
    } catch (error) {
      console.error('Failed to save dependencies:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const availableTasks = getAvailableTasks();

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Edit Dependencies
          </DialogTitle>
          <DialogDescription>
            Select which tasks must be completed before "{task?.title}"
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {cycleWarning && (
            <div className="mb-4 p-3 rounded bg-yellow-500/10 border border-yellow-500/30 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
              <p className="text-sm text-yellow-500">{cycleWarning}</p>
            </div>
          )}

          {availableTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No other tasks available to add as dependencies.
            </p>
          ) : (
            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {availableTasks.map((t) => {
                const isSelected = selectedDeps.has(t.id);
                const wouldCycle = !isSelected && wouldCreateCycle(t.id);
                const dependents = getTasksThatDependOn(task?.id || '');
                const isDependent = dependents.includes(t.id);

                return (
                  <div
                    key={t.id}
                    className={cn(
                      'flex items-start gap-3 p-2 rounded border transition-colors',
                      isSelected && 'border-primary bg-primary/5',
                      wouldCycle && 'opacity-50 cursor-not-allowed',
                      !isSelected && !wouldCycle && 'border-transparent hover:border-border'
                    )}
                  >
                    <Checkbox
                      id={`dep-${t.id}`}
                      checked={isSelected}
                      onCheckedChange={() => handleToggleDep(t.id)}
                      disabled={wouldCycle}
                    />
                    <div className="flex-1 min-w-0">
                      <Label
                        htmlFor={`dep-${t.id}`}
                        className={cn(
                          'text-sm font-medium cursor-pointer',
                          wouldCycle && 'cursor-not-allowed'
                        )}
                      >
                        {t.title}
                      </Label>
                      {t.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {t.description}
                        </p>
                      )}
                      {isDependent && (
                        <p className="text-xs text-yellow-500 mt-0.5">
                          (This task depends on the current task)
                        </p>
                      )}
                      {wouldCycle && (
                        <p className="text-xs text-red-500 mt-0.5">
                          Would create circular dependency
                        </p>
                      )}
                    </div>
                    <span
                      className={cn(
                        'text-xs px-1.5 py-0.5 rounded capitalize',
                        t.status === 'done' && 'bg-green-500/20 text-green-400',
                        t.status === 'wip' && 'bg-blue-500/20 text-blue-400',
                        t.status === 'todo' && 'bg-slate-500/20 text-slate-400'
                      )}
                    >
                      {t.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : `Save (${selectedDeps.size} dependencies)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
