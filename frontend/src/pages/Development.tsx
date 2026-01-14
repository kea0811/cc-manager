import * as React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { projectsApi } from '@/api/projects';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft,
  Play,
  Square,
  CheckCircle2,
  Circle,
  Loader2,
  Terminal,
  AlertCircle,
  Rocket,
  TestTube,
  Code2,
  FileSearch,
  Upload,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Project, DevStreamEvent, DevPhase, DevStreamState } from '@/types';
import ReactMarkdown from 'react-markdown';

// Phase configuration
const PHASES: { id: DevPhase; label: string; icon: React.ElementType }[] = [
  { id: 'development', label: 'Development', icon: Code2 },
  { id: 'code_review', label: 'Code Review', icon: FileSearch },
  { id: 'unit_tests', label: 'Unit Tests', icon: TestTube },
  { id: 'e2e_tests', label: 'E2E Tests', icon: TestTube },
  { id: 'deploy', label: 'Deploy', icon: Upload },
  { id: 'complete', label: 'Complete', icon: CheckCircle2 },
];

// Tool name to friendly label
const TOOL_LABELS: Record<string, string> = {
  Read: 'Reading file',
  Glob: 'Searching files',
  Grep: 'Searching code',
  Bash: 'Running command',
  Edit: 'Editing file',
  Write: 'Writing file',
  Task: 'Running task',
};

export const Development: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [project, setProject] = React.useState<Project | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [state, setState] = React.useState<DevStreamState>({
    isRunning: false,
    currentPhase: null,
    currentTask: null,
    claudeOutput: '',
    currentTool: null,
    setupMessage: null,
    completedTasks: [],
    errors: [],
  });

  const abortRef = React.useRef<(() => void) | null>(null);
  const outputRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll output
  React.useEffect(() => {
    if (outputRef.current) {
      const viewport = outputRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [state.claudeOutput]);

  // Load project
  React.useEffect(() => {
    const loadProject = async () => {
      if (!id) return;
      try {
        const data = await projectsApi.getById(id);
        setProject(data);
      } catch {
        toast({ title: 'Error', description: 'Failed to load project', variant: 'destructive' });
        navigate('/');
      } finally {
        setIsLoading(false);
      }
    };
    loadProject();
  }, [id, navigate, toast]);

  // Start development
  const handleStart = () => {
    if (!id) return;

    setState({
      isRunning: true,
      currentPhase: 'setup',
      currentTask: null,
      claudeOutput: '',
      currentTool: null,
      setupMessage: 'Initializing...',
      completedTasks: [],
      errors: [],
    });

    const { abort } = projectsApi.streamDevelopment(id, {
      onEvent: (event: DevStreamEvent) => {
        switch (event.type) {
          case 'init':
            setState(prev => ({ ...prev, setupMessage: `Starting development for ${event.projectName}` }));
            break;

          case 'tasks':
            setState(prev => ({
              ...prev,
              setupMessage: `Found ${event.total} tasks to develop`,
            }));
            break;

          case 'phase':
            setState(prev => ({
              ...prev,
              currentPhase: event.phase || null,
              claudeOutput: '', // Clear output for new phase
              currentTool: null,
              setupMessage: event.message || null,
            }));
            break;

          case 'task_start':
            setState(prev => ({
              ...prev,
              currentTask: {
                id: event.taskId || '',
                title: event.taskTitle || '',
                index: event.taskIndex || 0,
                total: event.totalTasks || 0,
              },
              claudeOutput: '',
              setupMessage: null,
            }));
            break;

          case 'setup':
            setState(prev => ({ ...prev, setupMessage: event.message || null }));
            break;

          case 'claude':
            // Handle claude streaming events
            if (event.type === 'claude') {
              const claudeEvent = event as DevStreamEvent & { message?: { content: string }; tool_name?: string };
              if (claudeEvent.message?.content) {
                setState(prev => ({
                  ...prev,
                  claudeOutput: prev.claudeOutput + claudeEvent.message!.content,
                  setupMessage: null,
                }));
              }
              if (claudeEvent.tool_name) {
                setState(prev => ({
                  ...prev,
                  currentTool: claudeEvent.tool_name || null,
                }));
              }
            }
            break;

          case 'commit':
            setState(prev => ({
              ...prev,
              claudeOutput: prev.claudeOutput + `\n\n**Committed:** ${event.commitUrl}\n`,
            }));
            break;

          case 'task_complete':
          case 'task_claude_complete':
            setState(prev => ({
              ...prev,
              completedTasks: [...prev.completedTasks, event.taskId || ''],
              currentTool: null,
            }));
            break;

          case 'task_moved':
            // Task moved to new status
            break;

          case 'test_complete':
            setState(prev => ({
              ...prev,
              claudeOutput: prev.claudeOutput + `\n\n**${event.type === 'test_complete' ? 'Tests' : 'Test'} completed**\n`,
            }));
            break;

          case 'deploy_complete':
            setState(prev => ({
              ...prev,
              claudeOutput: prev.claudeOutput + '\n\n**Deployment completed**\n',
            }));
            break;

          case 'error':
            setState(prev => ({
              ...prev,
              errors: [...prev.errors, event.message || 'Unknown error'],
            }));
            break;

          case 'aborted':
            setState(prev => ({
              ...prev,
              isRunning: false,
              setupMessage: 'Development aborted',
            }));
            break;

          case 'done':
            setState(prev => ({
              ...prev,
              isRunning: false,
              currentPhase: event.success ? 'complete' : prev.currentPhase,
              setupMessage: event.success ? 'Development complete!' : 'Development finished with errors',
            }));
            if (event.success) {
              toast({ title: 'Success', description: 'Development pipeline completed!' });
            }
            break;
        }
      },
      onError: (error) => {
        setState(prev => ({
          ...prev,
          isRunning: false,
          errors: [...prev.errors, error.message],
        }));
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      },
      onComplete: () => {
        abortRef.current = null;
      },
    });

    abortRef.current = abort;
  };

  // Stop development
  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setState(prev => ({
      ...prev,
      isRunning: false,
      setupMessage: 'Stopping...',
    }));
  };

  // Get current phase index for progress
  const getCurrentPhaseIndex = () => {
    if (!state.currentPhase) return -1;
    return PHASES.findIndex(p => p.id === state.currentPhase);
  };

  const progress = state.currentPhase === 'complete'
    ? 100
    : Math.max(0, ((getCurrentPhaseIndex() + 1) / PHASES.length) * 100);

  if (isLoading || !project) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/workspace/${id}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Rocket className="h-5 w-5 text-purple-500" />
              Development Pipeline
            </h1>
            <p className="text-sm text-muted-foreground">{project.name}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!state.isRunning ? (
            <Button
              onClick={handleStart}
              className="gap-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
            >
              <Play className="h-4 w-4" />
              Start Development
            </Button>
          ) : (
            <Button onClick={handleStop} variant="destructive" className="gap-2">
              <Square className="h-4 w-4" />
              Stop
            </Button>
          )}
        </div>
      </header>

      {/* Progress bar */}
      <div className="px-4 py-2 border-b">
        <Progress value={progress} className="h-2" />
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Phase timeline */}
        <div className="w-64 border-r p-4 overflow-auto">
          <h2 className="text-sm font-semibold mb-4 text-muted-foreground">PIPELINE PHASES</h2>
          <div className="space-y-1">
            {PHASES.map((phase, index) => {
              const currentIndex = getCurrentPhaseIndex();
              const isComplete = index < currentIndex || state.currentPhase === 'complete';
              const isCurrent = index === currentIndex && state.currentPhase !== 'complete';
              const Icon = phase.icon;

              return (
                <div
                  key={phase.id}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                    isCurrent && 'bg-blue-500/10 text-blue-600',
                    isComplete && 'text-green-600',
                    !isCurrent && !isComplete && 'text-muted-foreground'
                  )}
                >
                  {isComplete ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : isCurrent ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Circle className="h-5 w-5" />
                  )}
                  <Icon className="h-4 w-4" />
                  <span className="text-sm font-medium">{phase.label}</span>
                </div>
              );
            })}
          </div>

          {/* Current task info */}
          {state.currentTask && (
            <Card className="mt-4">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Current Task</CardTitle>
              </CardHeader>
              <CardContent className="py-2">
                <p className="text-sm font-medium">{state.currentTask.title}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Task {state.currentTask.index} of {state.currentTask.total}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Completed tasks */}
          {state.completedTasks.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold text-muted-foreground mb-2">
                COMPLETED ({state.completedTasks.length})
              </h3>
              <div className="space-y-1">
                {state.completedTasks.map((taskId, i) => (
                  <div key={taskId} className="flex items-center gap-2 text-xs text-green-600">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>Task {i + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Output panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Status bar */}
          <div className="flex items-center gap-4 px-4 py-2 border-b bg-muted/30">
            {state.isRunning && (
              <Badge variant="outline" className="gap-1 text-blue-600 border-blue-600">
                <Loader2 className="h-3 w-3 animate-spin" />
                Running
              </Badge>
            )}
            {state.currentPhase && (
              <Badge variant="secondary">
                Phase: {PHASES.find(p => p.id === state.currentPhase)?.label || state.currentPhase}
              </Badge>
            )}
            {state.currentTool && (
              <Badge variant="outline" className="gap-1">
                <Terminal className="h-3 w-3" />
                {TOOL_LABELS[state.currentTool] || state.currentTool}
              </Badge>
            )}
            {state.setupMessage && (
              <span className="text-sm text-muted-foreground flex items-center gap-2">
                <Sparkles className="h-4 w-4 animate-pulse text-purple-500" />
                {state.setupMessage}
              </span>
            )}
          </div>

          {/* Output */}
          <ScrollArea className="flex-1 p-4" ref={outputRef}>
            {!state.isRunning && !state.claudeOutput && state.completedTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Rocket className="h-16 w-16 text-muted-foreground/30 mb-4" />
                <h3 className="text-lg font-medium text-muted-foreground">Ready to develop</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Click "Start Development" to begin the pipeline
                </p>
              </div>
            ) : (
              <div className="font-mono text-sm">
                {state.claudeOutput ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{state.claudeOutput}</ReactMarkdown>
                  </div>
                ) : state.setupMessage ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {state.setupMessage}
                  </div>
                ) : null}
              </div>
            )}

            {/* Errors */}
            {state.errors.length > 0 && (
              <div className="mt-4 space-y-2">
                {state.errors.map((error, i) => (
                  <div key={i} className="flex items-start gap-2 text-red-600 bg-red-50 dark:bg-red-950 p-3 rounded-lg">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span className="text-sm">{error}</span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
};

export default Development;
