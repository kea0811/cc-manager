import * as React from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { motion, AnimatePresence } from 'motion/react';
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
import { TaskCard } from '@/components/TaskCard';
import { TaskDetailDialog } from '@/components/TaskDetailDialog';
import { DependencyEditor } from '@/components/DependencyEditor';
import { projectsApi } from '@/api/projects';
import { useToast } from '@/hooks/use-toast';
import { Kanban, RefreshCw } from 'lucide-react';
import type { KanbanTask, KanbanStatus } from '@/types';
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

  // Drag state
  const [activeTask, setActiveTask] = React.useState<KanbanTask | null>(null);

  // Task detail dialog state
  const [detailTask, setDetailTask] = React.useState<KanbanTask | null>(null);
  const [isDetailOpen, setIsDetailOpen] = React.useState(false);

  // Dependency editor state
  const [dependencyTask, setDependencyTask] = React.useState<KanbanTask | null>(null);
  const [isDependencyOpen, setIsDependencyOpen] = React.useState(false);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

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

  // Task detail handlers
  const openTaskDetail = (task: KanbanTask): void => {
    setDetailTask(task);
    setIsDetailOpen(true);
  };

  const closeTaskDetail = (): void => {
    setDetailTask(null);
    setIsDetailOpen(false);
  };

  const handleEditFromDetail = (task: KanbanTask): void => {
    closeTaskDetail();
    openEditDialog(task);
  };

  // Dependency editor handlers
  const openDependencyEditor = (task: KanbanTask): void => {
    setDependencyTask(task);
    setIsDependencyOpen(true);
    closeTaskDetail(); // Close detail dialog when opening dependency editor
  };

  const closeDependencyEditor = (): void => {
    setDependencyTask(null);
    setIsDependencyOpen(false);
  };

  const handleSaveDependencies = async (taskId: string, dependencyIds: string[]): Promise<void> => {
    try {
      const updated = await projectsApi.updateTaskDependencies(projectId, taskId, { dependencyIds });
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      toast({ title: 'Updated', description: 'Dependencies updated successfully' });
    } catch {
      toast({ title: 'Error', description: 'Failed to update dependencies', variant: 'destructive' });
      throw new Error('Failed to update dependencies');
    }
  };

  const handleSaveTask = async (): Promise<void> => {
    if (!formTitle.trim() || !dialog.task) return;
    setIsSaving(true);

    try {
      const updated = await projectsApi.updateKanbanTask(projectId, dialog.task.id, {
        title: formTitle.trim(),
        description: formDescription.trim() || undefined,
      });
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      toast({ title: 'Updated', description: 'Task updated successfully' });
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

  // DnD handlers
  const handleDragStart = (event: DragStartEvent): void => {
    const { active } = event;
    const task = tasks.find((t) => t.id === active.id);
    if (task) {
      setActiveTask(task);
    }
  };

  const handleDragOver = (event: DragOverEvent): void => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeTask = tasks.find((t) => t.id === activeId);
    if (!activeTask) return;

    // Check if dropping over a column
    const overColumn = KANBAN_COLUMNS.find((c) => c.id === overId);
    if (overColumn) {
      // Moving to empty column or column itself
      if (activeTask.status !== overColumn.id) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === activeId ? { ...t, status: overColumn.id } : t
          )
        );
      }
      return;
    }

    // Check if dropping over another task
    const overTask = tasks.find((t) => t.id === overId);
    if (overTask && activeTask.status !== overTask.status) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === activeId ? { ...t, status: overTask.status } : t
        )
      );
    }
  };

  const handleDragEnd = async (event: DragEndEvent): Promise<void> => {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeTask = tasks.find((t) => t.id === activeId);
    if (!activeTask) return;

    // Determine the target column
    let targetStatus: KanbanStatus = activeTask.status;
    const overColumn = KANBAN_COLUMNS.find((c) => c.id === overId);
    if (overColumn) {
      targetStatus = overColumn.id;
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (overTask) {
        targetStatus = overTask.status;
      }
    }

    // Calculate new position
    const tasksInColumn = tasks
      .filter((t) => t.status === targetStatus && t.id !== activeId)
      .sort((a, b) => a.position - b.position);

    let newPosition = 0;
    if (overId !== targetStatus) {
      const overTaskIndex = tasksInColumn.findIndex((t) => t.id === overId);
      if (overTaskIndex !== -1) {
        newPosition = overTaskIndex;
      } else {
        newPosition = tasksInColumn.length;
      }
    } else {
      newPosition = tasksInColumn.length;
    }

    // Optimistically update
    setTasks((prev) => {
      const filtered = prev.filter((t) => t.id !== activeId);
      const updated = { ...activeTask, status: targetStatus, position: newPosition };
      const result = [...filtered, updated];
      // Recalculate positions
      return result.map((t) => {
        if (t.status === targetStatus) {
          const sameStatusTasks = result
            .filter((x) => x.status === targetStatus)
            .sort((a, b) => a.position - b.position);
          const idx = sameStatusTasks.findIndex((x) => x.id === t.id);
          return { ...t, position: idx };
        }
        return t;
      });
    });

    // Persist
    try {
      await projectsApi.moveKanbanTask(projectId, activeId, {
        status: targetStatus,
        position: newPosition,
      });
    } catch {
      loadTasks();
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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-4 p-4 h-full">
            {KANBAN_COLUMNS.map((column) => (
              <KanbanColumn
                key={column.id}
                id={column.id}
                title={column.title}
                color={column.color}
                tasks={getTasksByStatus(column.id)}
                onEditTask={openEditDialog}
                onDeleteTask={handleDeleteTask}
                onMoveTask={handleMoveTask}
                onViewTaskDetails={openTaskDetail}
              />
            ))}
          </div>
        </div>
        <DragOverlay dropAnimation={{
          duration: 200,
          easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
        }}>
          <AnimatePresence>
            {activeTask ? (
              <motion.div
                initial={{ scale: 1, boxShadow: '0 0 0 rgba(0,0,0,0)' }}
                animate={{
                  scale: 1.05,
                  boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
                  rotate: 2,
                }}
                exit={{ scale: 1, boxShadow: '0 0 0 rgba(0,0,0,0)' }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              >
                <TaskCard
                  task={activeTask}
                  onEdit={() => {}}
                  onDelete={() => {}}
                  onMove={() => {}}
                  isDragging
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </DragOverlay>
      </DndContext>

      {/* Task Edit Dialog */}
      <Dialog open={dialog.isOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
            <DialogDescription>Update task details</DialogDescription>
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
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task Detail Dialog */}
      <TaskDetailDialog
        task={detailTask}
        allTasks={tasks}
        isOpen={isDetailOpen}
        onClose={closeTaskDetail}
        onEdit={handleEditFromDetail}
        onEditDependencies={openDependencyEditor}
      />

      {/* Dependency Editor Dialog */}
      <DependencyEditor
        task={dependencyTask}
        allTasks={tasks}
        isOpen={isDependencyOpen}
        onClose={closeDependencyEditor}
        onSave={handleSaveDependencies}
      />
    </div>
  );
});

KanbanBoard.displayName = 'KanbanBoard';
