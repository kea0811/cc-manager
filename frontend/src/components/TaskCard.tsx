import * as React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GripVertical, Pencil, Trash2, ChevronLeft, ChevronRight, GitCommit, MessageSquare, ChevronDown, ChevronUp, Send, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KanbanTask, KanbanStatus, TaskComment } from '@/types';
import { KANBAN_COLUMNS } from '@/types';
import { projectsApi } from '@/api/projects';

interface TaskCardProps {
  task: KanbanTask;
  onEdit: (task: KanbanTask) => void;
  onDelete: (taskId: string) => void;
  onMove: (taskId: string, newStatus: KanbanStatus, position: number) => void;
  isDragging?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onEdit,
  onDelete,
  onMove,
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

  return (
    <Card
      className={cn(
        'group relative cursor-pointer transition-all duration-200',
        'hover:shadow-md hover:border-primary/50',
        isDragging && 'shadow-lg ring-2 ring-primary/50 opacity-90'
      )}
      data-testid={`task-card-${task.id}`}
    >
      <div className="p-3">
        <div className="flex items-start gap-2">
          <div
            {...dragHandleProps}
            className="mt-0.5 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity"
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
