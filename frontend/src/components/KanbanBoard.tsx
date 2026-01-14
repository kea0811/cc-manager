import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { KanbanColumn } from '@/components/KanbanColumn';
import { projectsApi } from '@/api/projects';
import { useToast } from '@/hooks/use-toast';
import { Kanban, RefreshCw } from 'lucide-react';
import type { KanbanTask, KanbanStatus, CreateKanbanTaskData } from '@/types';
import { KANBAN_COLUMNS } from '@/types';

interface KanbanBoardProps {
  projectId: string;
}

export interface KanbanBoardHandle {
  refresh: () => void;
}

interface TaskDialogState {
  isOpen: boolean;
  mode: 'create' | 'edit';
  status: KanbanStatus;
  task: KanbanTask | null;
}

const initialDialogState: TaskDialogState = {
  isOpen: false,
  mode: 'create',
  status: 'todo',
  task: null,
};

export const KanbanBoard = React.forwardRef<KanbanBoardHandle, KanbanBoardProps>(
  ({ projectId }, ref) => {
  const { toast } = useToast();
  const [tasks, setTasks] = React.useState<KanbanTask[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [dialog, setDialog] = React.useState<TaskDialogState>(initialDialogState);
  const [formTitle, setFormTitle] = React.useState('');
  const [formDescription, setFormDescription] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);

  const loadTasks = React.useCallback(async () => {
    try {
      const data = await projectsApi.getKanbanTasks(projectId);
      setTasks(data);
    } catch {
      toast({ title: 'Error', description: 'Failed to load tasks', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [projectId, toast]);

  // Expose refresh method to parent
  React.useImperativeHandle(ref, () => ({
    refresh: loadTasks,
  }), [loadTasks]);

  React.useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const getTasksByStatus = (status: KanbanStatus): KanbanTask[] =>
    tasks.filter((t) => t.status === status).sort((a, b) => a.position - b.position);

  const openCreateDialog = (status: KanbanStatus): void => {
    setDialog({ isOpen: true, mode: 'create', status, task: null });
    setFormTitle('');
    setFormDescription('');
  };

  const openEditDialog = (task: KanbanTask): void => {
    setDialog({ isOpen: true, mode: 'edit', status: task.status, task });
    setFormTitle(task.title);
    setFormDescription(task.description || '');
  };

  const closeDialog = (): void => {
    setDialog(initialDialogState);
    setFormTitle('');
    setFormDescription('');
  };

  const handleSaveTask = async (): Promise<void> => {
    if (!formTitle.trim()) return;
    setIsSaving(true);

    try {
      if (dialog.mode === 'create') {
        const data: CreateKanbanTaskData = {
          title: formTitle.trim(),
          description: formDescription.trim() || undefined,
          status: dialog.status,
        };
        const newTask = await projectsApi.createKanbanTask(projectId, data);
        setTasks((prev) => [...prev, newTask]);
        toast({ title: 'Created', description: 'Task created successfully' });
      } else if (dialog.task) {
        const updated = await projectsApi.updateKanbanTask(projectId, dialog.task.id, {
          title: formTitle.trim(),
          description: formDescription.trim() || undefined,
        });
        setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        toast({ title: 'Updated', description: 'Task updated successfully' });
      }
      closeDialog();
    } catch {
      toast({ title: 'Error', description: 'Failed to save task', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTask = async (taskId: string): Promise<void> => {
    try {
      await projectsApi.deleteKanbanTask(projectId, taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      toast({ title: 'Deleted', description: 'Task deleted' });
    } catch {
      toast({ title: 'Error', description: 'Failed to delete task', variant: 'destructive' });
    }
  };

  const handleMoveTask = async (
    taskId: string,
    newStatus: KanbanStatus,
    position: number
  ): Promise<void> => {
    try {
      const moved = await projectsApi.moveKanbanTask(projectId, taskId, { status: newStatus, position });
      setTasks((prev) => prev.map((t) => (t.id === moved.id ? moved : t)));
    } catch {
      toast({ title: 'Error', description: 'Failed to move task', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading kanban board...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="kanban-board">
      {/* Board Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Kanban className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Development Board</h2>
          <span className="text-sm text-muted-foreground">({tasks.length} tasks)</span>
        </div>
        <Button variant="ghost" size="icon" onClick={loadTasks} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Board Columns */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-4 p-4 h-full">
          {KANBAN_COLUMNS.map((column) => (
            <KanbanColumn
              key={column.id}
              id={column.id}
              title={column.title}
              color={column.color}
              tasks={getTasksByStatus(column.id)}
              onAddTask={openCreateDialog}
              onEditTask={openEditDialog}
              onDeleteTask={handleDeleteTask}
              onMoveTask={handleMoveTask}
            />
          ))}
        </div>
      </div>

      {/* Task Dialog */}
      <Dialog open={dialog.isOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog.mode === 'create' ? 'Create Task' : 'Edit Task'}
            </DialogTitle>
            <DialogDescription>
              {dialog.mode === 'create'
                ? `Add a new task to ${KANBAN_COLUMNS.find((c) => c.id === dialog.status)?.title}`
                : 'Update task details'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Enter task title..."
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-description">Description (optional)</Label>
              <Textarea
                id="task-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Enter task description..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={handleSaveTask} disabled={!formTitle.trim() || isSaving}>
              {isSaving ? 'Saving...' : dialog.mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

KanbanBoard.displayName = 'KanbanBoard';
