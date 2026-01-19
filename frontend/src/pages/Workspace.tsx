import * as React from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ChatPanel } from '@/components/ChatPanel';
import { EditorPanel } from '@/components/EditorPanel';
import { ProjectSettingsDialog } from '@/components/ProjectSettingsDialog';
import { KanbanBoard, KanbanBoardHandle } from '@/components/KanbanBoard';
import { projectsApi } from '@/api/projects';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Settings, MessageSquare, Kanban, Rocket, Play, Loader2, ExternalLink, CheckCircle, Upload, ListPlus } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { cn } from '@/lib/utils';
import type { Project, ChatMessage, UpdateProjectData, StreamingState } from '@/types';

type WorkspaceView = 'chat' | 'kanban';

export const Workspace: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  // Get initial view from URL or default to 'chat'
  const initialView = (searchParams.get('view') as WorkspaceView) || 'chat';

  const [project, setProject] = React.useState<Project | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [editorContent, setEditorContent] = React.useState('');
  const [isDirty, setIsDirty] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [activeView, setActiveViewState] = React.useState<WorkspaceView>(initialView);
  const [isStartingDev, setIsStartingDev] = React.useState(false);

  // Update both state and URL when view changes
  const setActiveView = React.useCallback((view: WorkspaceView) => {
    setActiveViewState(view);
    setSearchParams({ view }, { replace: true });
  }, [setSearchParams]);
  const [isDeploying, setIsDeploying] = React.useState(false);
  const [isParsingTasks, setIsParsingTasks] = React.useState(false);
  const kanbanRef = React.useRef<KanbanBoardHandle>(null);

  // Streaming state
  const [streamingState, setStreamingState] = React.useState<StreamingState>({
    phase: 'idle',
    content: '',
    currentTool: null,
    error: null,
  });
  const abortRef = React.useRef<(() => void) | null>(null);

  const loadProject = React.useCallback(async () => {
    if (!id) return;
    try {
      const [projectData, chatHistory] = await Promise.all([
        projectsApi.getById(id),
        projectsApi.getChatHistory(id),
      ]);
      setProject(projectData);
      setEditorContent(projectData.editorContent);
      setMessages(chatHistory);
    } catch {
      toast({ title: 'Error', description: 'Failed to load project', variant: 'destructive' });
      navigate('/');
    } finally {
      setIsLoading(false);
    }
  }, [id, navigate, toast]);

  React.useEffect(() => {
    loadProject();
  }, [loadProject]);

  const handleEditorChange = (content: string): void => {
    setEditorContent(content);
    setIsDirty(content !== project?.editorContent);
  };

  const handleSaveEditor = async (): Promise<void> => {
    if (!id || !isDirty) return;
    setIsSaving(true);
    try {
      const updated = await projectsApi.updateEditor(id, editorContent);
      setProject(updated);
      setIsDirty(false);
      toast({ title: 'Saved', description: 'Editor content saved' });
    } catch {
      toast({ title: 'Error', description: 'Failed to save', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendMessage = async (content: string): Promise<void> => {
    if (!id) return;

    // Create optimistic user message to show immediately
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: ChatMessage = {
      id: tempId,
      projectId: id,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    // Add user message immediately for instant feedback
    setMessages((prev) => [...prev, optimisticMessage]);

    // Set thinking state
    setStreamingState({
      phase: 'thinking',
      content: '',
      currentTool: null,
      error: null,
    });

    // Track if we've received the real user message
    let userMessageId: string | null = null;

    // Use streaming API
    const { abort } = projectsApi.streamProcess(id, content, {
      onEvent: (event) => {
        switch (event.type) {
          case 'user_message':
            // Replace temp message with real user message
            if (event.message && 'id' in event.message) {
              userMessageId = event.message.id;
              setMessages((prev) => {
                const withoutTemp = prev.filter((m) => m.id !== tempId);
                return [...withoutTemp, event.message as ChatMessage];
              });
            }
            break;

          case 'assistant':
            // Streaming text content
            setStreamingState((prev) => ({
              ...prev,
              phase: 'writing',
              content: prev.content + (event.content || ''),
            }));
            break;

          case 'tool_use':
            // Tool is being called
            setStreamingState((prev) => ({
              ...prev,
              phase: 'tool_use',
              currentTool: event.tool_name || null,
            }));
            break;

          case 'tool_result':
            // Tool completed
            setStreamingState((prev) => ({
              ...prev,
              phase: 'writing',
              currentTool: null,
            }));
            break;

          case 'assistant_message':
            // Final assistant message stored
            if (event.message && 'id' in event.message) {
              setMessages((prev) => [...prev, event.message as ChatMessage]);
              setStreamingState({
                phase: 'idle',
                content: '',
                currentTool: null,
                error: null,
              });
            }
            break;

          case 'editor_update':
            // Editor content updated
            if (event.content) {
              setEditorContent(event.content);
              setProject((prev) => prev ? { ...prev, editorContent: event.content! } : null);
              setIsDirty(false);

              // Show toast with diff info
              if (event.diff?.hasChanges) {
                toast({
                  title: 'Editor Updated',
                  description: `+${event.diff.addedLines} / -${event.diff.removedLines} lines`,
                });
              }
            }
            break;

          case 'tasks_created':
            // New tasks were auto-created from updated PRD
            if (event.count && event.count > 0) {
              toast({
                title: 'New Tasks Created',
                description: `${event.count} task${event.count > 1 ? 's' : ''} added to Kanban`,
              });
              // Refresh kanban board
              kanbanRef.current?.refresh();
            }
            break;

          case 'error':
            setStreamingState({
              phase: 'error',
              content: '',
              currentTool: null,
              error: event.error || 'Unknown error',
            });
            // Remove optimistic message if we haven't received real user message yet
            if (!userMessageId) {
              setMessages((prev) => prev.filter((m) => m.id !== tempId));
            }
            toast({
              title: 'Error',
              description: event.error || 'Unknown error',
              variant: 'destructive',
            });
            break;

          case 'done':
            // Stream completed
            setStreamingState({
              phase: 'idle',
              content: '',
              currentTool: null,
              error: null,
            });
            break;
        }
      },
      onError: (error) => {
        setStreamingState({
          phase: 'error',
          content: '',
          currentTool: null,
          error: error.message,
        });
        // Remove optimistic message on error
        if (!userMessageId) {
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
        }
        toast({
          title: 'Error',
          description: error.message,
          variant: 'destructive',
        });
      },
      onComplete: () => {
        abortRef.current = null;
      },
    });

    // Store abort function for cancellation
    abortRef.current = abort;
  };

  // Cancel streaming handler
  const handleCancelStream = (): void => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setStreamingState({
      phase: 'idle',
      content: '',
      currentTool: null,
      error: null,
    });
    toast({ title: 'Cancelled', description: 'Response cancelled' });
  };

  const handleClearChat = async (): Promise<void> => {
    if (!id) return;
    try {
      await projectsApi.clearChatHistory(id);
      setMessages([]);
      toast({ title: 'Cleared', description: 'Chat history cleared' });
    } catch {
      toast({ title: 'Error', description: 'Failed to clear chat', variant: 'destructive' });
    }
  };

  const handleUpdateProject = async (data: UpdateProjectData): Promise<void> => {
    if (!id) return;
    try {
      const updated = await projectsApi.update(id, data);
      setProject(updated);
      toast({ title: 'Updated', description: 'Project settings saved' });
    } catch {
      toast({ title: 'Error', description: 'Failed to update project', variant: 'destructive' });
      throw new Error('Update failed');
    }
  };

  const handleDeleteProject = async (): Promise<void> => {
    if (!id) return;
    try {
      await projectsApi.delete(id);
      toast({ title: 'Deleted', description: 'Project has been deleted' });
      navigate('/');
    } catch {
      toast({ title: 'Error', description: 'Failed to delete project', variant: 'destructive' });
      throw new Error('Delete failed');
    }
  };

  const handleStartDevelop = async (): Promise<void> => {
    if (!id) return;

    // Save editor content first if dirty
    if (isDirty) {
      await handleSaveEditor();
    }

    setIsStartingDev(true);
    try {
      const result = await projectsApi.startDevelop(id);
      toast({
        title: 'Tasks Created',
        description: `Created ${result.tasks.length} tasks. Starting development...`,
      });
      // Switch to Kanban view to see the tasks
      setActiveView('kanban');
      // Refresh project to get updated status
      const updatedProject = await projectsApi.getById(id);
      setProject(updatedProject);
      // Refresh kanban board
      kanbanRef.current?.refresh();

      // Navigate to development page if we have tasks and a repo
      if (result.tasks.length > 0 && updatedProject.githubRepo) {
        navigate(`/projects/${id}/develop`);
      }
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to analyze PRD',
        variant: 'destructive',
      });
    } finally {
      setIsStartingDev(false);
    }
  };

  const handleDevelopAll = (): void => {
    if (!id) return;
    // Navigate to the development page with streaming
    navigate(`/projects/${id}/develop`);
  };

  const handleDeploy = async (): Promise<void> => {
    if (!id) return;
    setIsDeploying(true);
    try {
      const result = await projectsApi.deploy(id);
      toast({
        title: 'Deployed',
        description: `Project deployed to ${result.path}`,
      });
      // Refresh project to get updated status and deployedUrl
      const updatedProject = await projectsApi.getById(id);
      setProject(updatedProject);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to deploy',
        variant: 'destructive',
      });
    } finally {
      setIsDeploying(false);
    }
  };

  const handleParseNewTasks = async (): Promise<void> => {
    if (!id) return;
    setIsParsingTasks(true);
    try {
      const result = await projectsApi.parseNewTasks(id);
      if (result.tasks.length > 0) {
        toast({
          title: 'Tasks Created',
          description: `Created ${result.tasks.length} new task${result.tasks.length > 1 ? 's' : ''} from PRD`,
        });
        // Refresh kanban board
        kanbanRef.current?.refresh();
        // Switch to kanban view to show new tasks
        setActiveView('kanban');
      } else {
        toast({
          title: 'No New Tasks',
          description: result.message || 'All tasks from PRD already exist',
        });
      }
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to parse tasks',
        variant: 'destructive',
      });
    } finally {
      setIsParsingTasks(false);
    }
  };

  if (isLoading || !project) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading workspace...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col" data-testid="workspace">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} data-testid="back-btn">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">{project.name}</h1>
            <div className="flex items-center gap-2">
              {project.status === 'deployed' ? (
                <span className="inline-flex items-center gap-1 text-sm text-green-600 font-medium">
                  <CheckCircle className="h-3 w-3" />
                  Deployed
                </span>
              ) : (
                <p className="text-sm text-muted-foreground">{project.status}</p>
              )}
              {project.webUrl && (
                <a
                  href={project.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  View App
                </a>
              )}
            </div>
          </div>
        </div>

        {/* View Tabs */}
        <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg">
          <Button
            variant={activeView === 'chat' ? 'secondary' : 'ghost'}
            size="sm"
            className={cn(
              'gap-2 transition-all',
              activeView === 'chat' && 'shadow-sm'
            )}
            onClick={() => setActiveView('chat')}
          >
            <MessageSquare className="h-4 w-4" />
            Chat
          </Button>
          <Button
            variant={activeView === 'kanban' ? 'secondary' : 'ghost'}
            size="sm"
            className={cn(
              'gap-2 transition-all',
              activeView === 'kanban' && 'shadow-sm'
            )}
            onClick={() => setActiveView('kanban')}
          >
            <Kanban className="h-4 w-4" />
            Kanban
          </Button>
        </div>

        {/* Development Actions */}
        <div className="flex items-center gap-2">
          {project.status === 'draft' && editorContent.trim() && (
            <Button
              variant="default"
              size="sm"
              className="gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              onClick={handleStartDevelop}
              disabled={isStartingDev || !project.githubRepo}
              title={!project.githubRepo ? 'Configure GitHub repo in settings first' : undefined}
            >
              {isStartingDev ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              {isStartingDev ? 'Analyzing...' : 'Start Develop'}
            </Button>
          )}

          {(project.status === 'development' || project.status === 'deployed') && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleParseNewTasks}
                disabled={isParsingTasks || isDeploying}
                title="Parse PRD and add new tasks"
              >
                {isParsingTasks ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ListPlus className="h-4 w-4" />
                )}
                {isParsingTasks ? 'Parsing...' : 'Add Tasks'}
              </Button>
              <Button
                variant="default"
                size="sm"
                className="gap-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                onClick={handleDevelopAll}
                disabled={isDeploying || isParsingTasks}
              >
                <Play className="h-4 w-4" />
                Continue Development
              </Button>
              <Button
                variant="default"
                size="sm"
                className="gap-2 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700"
                onClick={handleDeploy}
                disabled={isDeploying || isParsingTasks}
              >
                {isDeploying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {isDeploying ? 'Deploying...' : 'Deploy'}
              </Button>
            </>
          )}

          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            title="Project settings"
            onClick={() => setIsSettingsOpen(true)}
            data-testid="settings-btn"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <ProjectSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        project={project}
        onUpdate={handleUpdateProject}
        onDelete={handleDeleteProject}
      />

      {/* Main Content */}
      {activeView === 'chat' ? (
        <div className="flex flex-1 overflow-hidden">
          <div className="w-1/2 border-r">
            <ChatPanel
              messages={messages}
              onSendMessage={handleSendMessage}
              onClearChat={handleClearChat}
              isLoading={false}
              streamingState={streamingState}
              onCancelStream={handleCancelStream}
              useStreaming={true}
            />
          </div>
          <Separator orientation="vertical" />
          <div className="w-1/2">
            <EditorPanel
              content={editorContent}
              onChange={handleEditorChange}
              onSave={handleSaveEditor}
              isDirty={isDirty}
              isSaving={isSaving}
              savedContent={project.editorContent}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <KanbanBoard ref={kanbanRef} projectId={id!} />
        </div>
      )}
    </div>
  );
};
