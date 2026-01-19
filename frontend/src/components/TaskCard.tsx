import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { motion } from 'motion/react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  GripVertical,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  GitCommit,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Send,
  X,
  Link2,
  GitBranch,
  TestTube,
  GitMerge,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KanbanTask, KanbanStatus, TaskComment } from '@/types';
import { KANBAN_COLUMNS } from '@/types';
import { projectsApi } from '@/api/projects';

interface TaskCardProps {
  task: KanbanTask;
  onEdit: (task: KanbanTask) => void;
  onDelete: (taskId: string) => void;
  onMove: (taskId: string, newStatus: KanbanStatus, position: number) => void;
  onViewDetails?: (task: KanbanTask) => void;
  isDragging?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onEdit,
  onDelete,
  onMove,
  onViewDetails,
  isDragging = false,
  dragHandleProps,
}) => {
  const [showComments, setShowComments] = React.useState(false);
  const [comments, setComments] = React.useState<TaskComment[]>([]);
  const [newComment, setNewComment] = React.useState('');
  const [isLoadingComments, setIsLoadingComments] = React.useState(false);
  const [isSendingComment, setIsSendingComment] = React.useState(false);

  const currentIndex = KANBAN_COLUMNS.findIndex((c) => c.id === task.status);
  const canMoveLeft = currentIndex > 0;
  const canMoveRight = currentIndex < KANBAN_COLUMNS.length - 1;

  const handleMoveLeft = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (canMoveLeft) {
      const newStatus = KANBAN_COLUMNS[currentIndex - 1].id;
      onMove(task.id, newStatus, 0);
    }
  };

  const handleMoveRight = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (canMoveRight) {
      const newStatus = KANBAN_COLUMNS[currentIndex + 1].id;
      onMove(task.id, newStatus, 0);
    }
  };

  const loadComments = async (): Promise<void> => {
    setIsLoadingComments(true);
    try {
      const data = await projectsApi.getTaskComments(task.projectId, task.id);
      setComments(data);
    } catch {
      console.error('Failed to load comments');
    } finally {
      setIsLoadingComments(false);
    }
  };

  const handleToggleComments = (e: React.MouseEvent): void => {
    e.stopPropagation();
    const newShow = !showComments;
    setShowComments(newShow);
    if (newShow && comments.length === 0) {
      loadComments();
    }
  };

  const handleAddComment = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    if (!newComment.trim()) return;

    setIsSendingComment(true);
    try {
      const comment = await projectsApi.addTaskComment(task.projectId, task.id, {
        content: newComment.trim(),
      });
      setComments((prev) => [...prev, comment]);
      setNewComment('');
    } catch {
      console.error('Failed to add comment');
    } finally {
      setIsSendingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string): Promise<void> => {
    try {
      await projectsApi.deleteTaskComment(task.projectId, task.id, commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch {
      console.error('Failed to delete comment');
    }
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const handleCardClick = (): void => {
    if (onViewDetails) {
      onViewDetails(task);
    }
  };

  return (
    <Card
      className={cn(
        'group relative cursor-pointer transition-all duration-200',
        'hover:shadow-md hover:border-primary/50',
        isDragging && 'shadow-lg ring-2 ring-primary/50 opacity-90'
      )}
      data-testid={`task-card-${task.id}`}
      onClick={handleCardClick}
    >
      <div className="p-3">
        <div className="flex items-start gap-2">
          {/* Drag Handle */}
          <div
            {...dragHandleProps}
            className="mt-0.5 cursor-grab active:cursor-grabbing opacity-50 group-hover:opacity-100 transition-opacity touch-none"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm leading-tight truncate">{task.title}</h4>
            {task.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {task.description}
              </p>
            )}
          </div>
        </div>

        {/* Parallel Development Info */}
        {(task.dependencies.length > 0 || task.branchName || task.testCoverage !== null || task.mergeStatus) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {/* Dependencies */}
            {task.dependencies.length > 0 && (
              <div
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-500/20 text-slate-400"
                title={`Depends on ${task.dependencies.length} task(s)`}
              >
                <Link2 className="h-3 w-3" />
                <span>{task.dependencies.length}</span>
              </div>
            )}

            {/* Branch Name */}
            {task.branchName && (
              <div
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 max-w-[120px]"
                title={task.branchName}
              >
                <GitBranch className="h-3 w-3 shrink-0" />
                <span className="truncate">{task.branchName.replace('feature/', '')}</span>
              </div>
            )}

            {/* Test Coverage */}
            {task.testStatus && (
              <div
                className={cn(
                  'flex items-center gap-1 px-1.5 py-0.5 rounded',
                  task.testStatus === 'passed' && 'bg-green-500/20 text-green-400',
                  task.testStatus === 'failed' && 'bg-red-500/20 text-red-400',
                  task.testStatus === 'running' && 'bg-yellow-500/20 text-yellow-400',
                  task.testStatus === 'pending' && 'bg-slate-500/20 text-slate-400'
                )}
                title={`Test coverage: ${task.testCoverage ?? 0}%`}
              >
                {task.testStatus === 'running' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : task.testStatus === 'passed' ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : task.testStatus === 'failed' ? (
                  <AlertTriangle className="h-3 w-3" />
                ) : (
                  <Clock className="h-3 w-3" />
                )}
                <TestTube className="h-3 w-3" />
                {task.testCoverage !== null && <span>{task.testCoverage}%</span>}
              </div>
            )}

            {/* Merge Status */}
            {task.mergeStatus && (
              <div
                className={cn(
                  'flex items-center gap-1 px-1.5 py-0.5 rounded',
                  task.mergeStatus === 'merged' && 'bg-purple-500/20 text-purple-400',
                  task.mergeStatus === 'conflict' && 'bg-red-500/20 text-red-400',
                  task.mergeStatus === 'pending' && 'bg-yellow-500/20 text-yellow-400'
                )}
                title={`Merge status: ${task.mergeStatus}`}
              >
                <GitMerge className="h-3 w-3" />
                <span className="capitalize">{task.mergeStatus}</span>
              </div>
            )}
          </div>
        )}

        {/* Commit Link */}
        {task.commitUrl && (
          <div className="mt-2 flex items-center gap-1.5">
            <GitCommit className="h-3 w-3 text-emerald-500" />
            <a
              href={task.commitUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-emerald-500 hover:text-emerald-400 hover:underline truncate"
            >
              View Commit
            </a>
          </div>
        )}

        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleMoveLeft}
              disabled={!canMoveLeft}
              title="Move to previous column"
            >
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleMoveRight}
              disabled={!canMoveRight}
              title="Move to next column"
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleToggleComments}
              title="Toggle comments"
            >
              <MessageSquare className="h-3 w-3" />
              {showComments ? <ChevronUp className="h-2 w-2 ml-0.5" /> : <ChevronDown className="h-2 w-2 ml-0.5" />}
            </Button>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(task);
              }}
              title="Edit task"
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-destructive hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(task.id);
              }}
              title="Delete task"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Comments Section */}
        {showComments && (
          <div className="mt-2 pt-2 border-t border-border/50" onClick={(e) => e.stopPropagation()}>
            {isLoadingComments ? (
              <p className="text-xs text-muted-foreground text-center py-2">Loading comments...</p>
            ) : (
              <>
                {comments.length > 0 ? (
                  <div className="space-y-2 max-h-32 overflow-y-auto mb-2">
                    {comments.map((comment) => (
                      <div key={comment.id} className="bg-muted/50 rounded p-2 text-xs group/comment">
                        <div className="flex justify-between items-start gap-2">
                          <p className="text-foreground flex-1">{comment.content}</p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-4 w-4 opacity-0 group-hover/comment:opacity-100 shrink-0"
                            onClick={() => handleDeleteComment(comment.id)}
                          >
                            <X className="h-3 w-3 text-destructive" />
                          </Button>
                        </div>
                        <p className="text-muted-foreground mt-1">{formatDate(comment.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-1">No comments yet</p>
                )}
                <form onSubmit={handleAddComment} className="flex gap-1.5">
                  <Input
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Add a comment..."
                    className="h-7 text-xs"
                    disabled={isSendingComment}
                  />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    disabled={!newComment.trim() || isSendingComment}
                  >
                    <Send className="h-3 w-3" />
                  </Button>
                </form>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

// Sortable wrapper for drag and drop with smooth animations
interface SortableTaskCardProps {
  task: KanbanTask;
  onEdit: (task: KanbanTask) => void;
  onDelete: (taskId: string) => void;
  onMove: (taskId: string, newStatus: KanbanStatus, position: number) => void;
  onViewDetails: (task: KanbanTask) => void;
}

export const SortableTaskCard: React.FC<SortableTaskCardProps> = ({
  task,
  onEdit,
  onDelete,
  onMove,
  onViewDetails,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useSortable({ id: task.id });

  return (
    <motion.div
      ref={setNodeRef}
      layout
      layoutId={task.id}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{
        opacity: isDragging ? 0.5 : 1,
        scale: 1,
        x: transform?.x ?? 0,
        y: transform?.y ?? 0,
      }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{
        type: 'spring',
        stiffness: 500,
        damping: 30,
        opacity: { duration: 0.2 },
      }}
      style={{
        zIndex: isDragging ? 50 : 'auto',
      }}
    >
      <TaskCard
        task={task}
        onEdit={onEdit}
        onDelete={onDelete}
        onMove={onMove}
        onViewDetails={onViewDetails}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </motion.div>
  );
};
