import * as React from 'react';
import { Button } from '@/components/ui/button';
import { TaskCard } from '@/components/TaskCard';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KanbanTask, KanbanStatus } from '@/types';

interface KanbanColumnProps {
  id: KanbanStatus;
  title: string;
  color: string;
  tasks: KanbanTask[];
  onAddTask: (status: KanbanStatus) => void;
  onEditTask: (task: KanbanTask) => void;
  onDeleteTask: (taskId: string) => void;
  onMoveTask: (taskId: string, newStatus: KanbanStatus, position: number) => void;
}

export const KanbanColumn: React.FC<KanbanColumnProps> = ({
  id,
  title,
  color,
  tasks,
  onAddTask,
  onEditTask,
  onDeleteTask,
  onMoveTask,
}) => {
  return (
    <div
      className="flex flex-col bg-muted/30 rounded-lg w-[280px] min-w-[280px] h-full max-h-full"
      data-testid={`kanban-column-${id}`}
    >
      {/* Column Header */}
      <div className="p-3 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <div className={cn('w-3 h-3 rounded-full', color)} />
          <h3 className="font-semibold text-sm">{title}</h3>
          <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {tasks.length}
          </span>
        </div>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto p-2 min-h-0">
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onEdit={onEditTask}
              onDelete={onDeleteTask}
              onMove={onMoveTask}
            />
          ))}
        </div>
      </div>

      {/* Add Task Button */}
      <div className="p-2 border-t border-border/50 shrink-0">
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
          onClick={() => onAddTask(id)}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add task
        </Button>
      </div>
    </div>
  );
};
