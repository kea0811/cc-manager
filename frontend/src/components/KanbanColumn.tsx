import * as React from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { AnimatePresence } from 'motion/react';
import { SortableTaskCard } from '@/components/TaskCard';
import { cn } from '@/lib/utils';
import type { KanbanTask, KanbanStatus } from '@/types';

interface KanbanColumnProps {
  id: KanbanStatus;
  title: string;
  color: string;
  tasks: KanbanTask[];
  onEditTask: (task: KanbanTask) => void;
  onDeleteTask: (taskId: string) => void;
  onMoveTask: (taskId: string, newStatus: KanbanStatus, position: number) => void;
  onViewTaskDetails: (task: KanbanTask) => void;
}

export const KanbanColumn: React.FC<KanbanColumnProps> = ({
  id,
  title,
  color,
  tasks,
  onEditTask,
  onDeleteTask,
  onMoveTask,
  onViewTaskDetails,
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id,
  });

  const taskIds = React.useMemo(() => tasks.map((t) => t.id), [tasks]);

  return (
    <div
      className={cn(
        'flex flex-col bg-muted/30 rounded-lg w-[280px] min-w-[280px] h-full max-h-full transition-colors',
        isOver && 'bg-primary/10 ring-2 ring-primary/50'
      )}
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

      {/* Task List with Drag & Drop */}
      <div ref={setNodeRef} className="flex-1 overflow-y-auto p-2 min-h-0">
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          <AnimatePresence mode="popLayout">
            <div className="space-y-2">
              {tasks.map((task) => (
                <SortableTaskCard
                  key={task.id}
                  task={task}
                  onEdit={onEditTask}
                  onDelete={onDeleteTask}
                  onMove={onMoveTask}
                  onViewDetails={onViewTaskDetails}
                />
              ))}
            </div>
          </AnimatePresence>
        </SortableContext>
      </div>

    </div>
  );
};
