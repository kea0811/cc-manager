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
  Radio,
  GitBranch,
  Layers,
  GitMerge,
  Zap,
} from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { cn } from '@/lib/utils';
import type { Project, DevStreamEvent, DevPhase, DevStreamState } from '@/types';
import ReactMarkdown from 'react-markdown';

// Parallel development state
interface ParallelTask {
  id: string;
  title: string;
  branchName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'merging' | 'merged' | 'reviewing' | 'fixing' | 'review_passed' | 'review_failed';
  output: string;
  commitUrl?: string;
  error?: string;
  qualityScore?: number;
  reviewAttempt?: number;
}

interface ParallelState {
  currentBatch: number;
  totalBatches: number;
  tasks: ParallelTask[];
  plan: Array<{
    batchNumber: number;
    tasks: Array<{ id: string; title: string } | null>;
  }>;
  mergeInProgress: boolean;
  reviewInProgress: boolean;
}

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
  // Always use parallel mode - system automatically detects task dependencies
  const isParallelMode = true;
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

  // Parallel development state
  const [parallelState, setParallelState] = React.useState<ParallelState>({
    currentBatch: 0,
    totalBatches: 0,
    tasks: [],
    plan: [],
    mergeInProgress: false,
    reviewInProgress: false,
  });
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);

  const abortRef = React.useRef<(() => void) | null>(null);
  const outputRef = React.useRef<HTMLDivElement>(null);
  const [hasActiveStream, setHasActiveStream] = React.useState(false);
  const [shouldAutoReconnect, setShouldAutoReconnect] = React.useState(false);

  // Auto-scroll output
  React.useEffect(() => {
    if (outputRef.current) {
      const viewport = outputRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [state.claudeOutput]);

  // Load project and check development status
  React.useEffect(() => {
    const loadProject = async () => {
      if (!id) return;
      try {
        const data = await projectsApi.getById(id);
        setProject(data);

        // Check if development is already running
        const devStatus = await projectsApi.getDevelopmentStatus(id);
        if (devStatus.isRunning) {
          setState({
            isRunning: true,
            currentPhase: devStatus.phase as DevPhase,
            currentTask: null,
            claudeOutput: devStatus.logs.join('\n\n'),
            currentTool: null,
            setupMessage: 'Reconnecting to development stream...',
            completedTasks: [],
            errors: devStatus.error ? [devStatus.error] : [],
          });
          // Mark that we need to auto-reconnect (handled by separate effect)
          setShouldAutoReconnect(true);
        } else if (devStatus.phase === 'complete') {
          // Show completed state
          setState(prev => ({
            ...prev,
            currentPhase: 'complete',
            setupMessage: devStatus.message,
            claudeOutput: devStatus.logs.join('\n\n'),
          }));
        } else if (devStatus.phase === 'error') {
          // Show error state
          setState(prev => ({
            ...prev,
            errors: devStatus.error ? [devStatus.error] : [],
            claudeOutput: devStatus.logs.join('\n\n'),
          }));
        }
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

    // Reset parallel state
    setParallelState({
      currentBatch: 0,
      totalBatches: 0,
      tasks: [],
      plan: [],
      mergeInProgress: false,
      reviewInProgress: false,
    });
    setSelectedTaskId(null);

    if (isParallelMode) {
      connectToParallelStream();
    } else {
      connectToStream(true); // Clear output when starting fresh
    }
  };

  // Stop development
  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setHasActiveStream(false);
    setState(prev => ({
      ...prev,
      isRunning: false,
      setupMessage: 'Stopping...',
    }));
  };

  // Connect to SSE stream (used by both start and reconnect)
  const connectToStream = (clearOutput: boolean = false) => {
    if (!id) return;

    if (clearOutput) {
      setState(prev => ({
        ...prev,
        claudeOutput: '',
        errors: [],
      }));
    }

    setHasActiveStream(true);

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

          case 'reconnected':
            // Successfully reconnected to running development
            setState(prev => ({
              ...prev,
              currentPhase: event.phase as DevPhase || prev.currentPhase,
              setupMessage: event.message || 'Reconnected to stream',
            }));
            break;

          case 'claude':
            // Handle claude streaming events
            {
              const claudeEvent = event as DevStreamEvent & {
                message?: { content: Array<{ type: string; text?: string }> };
                delta?: { text?: string };
                tool_name?: string;
                content?: string;
              };

              // Handle different Claude event formats
              let textContent = '';

              // Format 1: message.content array (assistant message)
              if (claudeEvent.message?.content && Array.isArray(claudeEvent.message.content)) {
                textContent = claudeEvent.message.content
                  .filter(block => block.type === 'text' && block.text)
                  .map(block => block.text)
                  .join('');
              }
              // Format 2: delta.text (streaming delta)
              else if (claudeEvent.delta?.text) {
                textContent = claudeEvent.delta.text;
              }
              // Format 3: direct content string
              else if (typeof claudeEvent.content === 'string') {
                textContent = claudeEvent.content;
              }

              if (textContent) {
                setState(prev => ({
                  ...prev,
                  claudeOutput: prev.claudeOutput + textContent,
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
            setHasActiveStream(false);
            setState(prev => ({
              ...prev,
              isRunning: false,
              setupMessage: 'Development aborted',
            }));
            break;

          case 'done':
            setHasActiveStream(false);
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
        setHasActiveStream(false);
        setState(prev => ({
          ...prev,
          isRunning: false,
          errors: [...prev.errors, error.message],
        }));
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      },
      onComplete: () => {
        setHasActiveStream(false);
        abortRef.current = null;
      },
    });

    abortRef.current = abort;
  };

  // Connect to parallel development stream
  const connectToParallelStream = () => {
    if (!id) return;

    setHasActiveStream(true);

    const { abort } = projectsApi.streamParallelDevelopment(id, {
      onEvent: (event: DevStreamEvent) => {
        switch (event.type) {
          case 'init':
            setState(prev => ({
              ...prev,
              setupMessage: `Starting parallel development for ${event.projectName}`,
              currentPhase: 'development',
            }));
            break;

          case 'reconnected':
            // Restore full state on reconnection
            {
              // Use type assertion for the full reconnected event structure
              const reconnectData = event as unknown as {
                type: 'reconnected';
                phase?: string;
                message?: string;
                currentBatch?: number;
                totalBatches?: number;
                tasks?: Array<{
                  id: string;
                  title: string;
                  branchName: string;
                  status: 'pending' | 'running' | 'completed' | 'failed' | 'merging' | 'merged';
                  output: string;
                  commitUrl?: string;
                  error?: string;
                }>;
                mergeInProgress?: boolean;
              };

              const restoredTasks = (reconnectData.tasks || []).map(t => ({
                id: t.id,
                title: t.title,
                branchName: t.branchName || '',
                status: t.status || 'pending' as const,
                output: t.output || '',
                commitUrl: t.commitUrl,
                error: t.error,
              }));

              setParallelState({
                currentBatch: reconnectData.currentBatch || 0,
                totalBatches: reconnectData.totalBatches || 0,
                tasks: restoredTasks,
                plan: [],
                mergeInProgress: reconnectData.mergeInProgress || false,
                reviewInProgress: false,
              });

              setState(prev => ({
                ...prev,
                isRunning: true,
                currentPhase: (reconnectData.phase as DevPhase) || 'development',
                setupMessage: `Reconnected: ${reconnectData.message || 'Development in progress'}`,
              }));

              // Select first running task
              const runningTask = restoredTasks.find(t => t.status === 'running');
              if (runningTask) {
                setSelectedTaskId(runningTask.id);
              }
            }
            break;

          case 'plan':
            setParallelState(prev => ({
              ...prev,
              totalBatches: event.batches || 0,
              plan: event.plan || [],
            }));
            setState(prev => ({
              ...prev,
              setupMessage: `Execution plan: ${event.batches} batches, ${event.totalTasks} tasks`,
            }));
            break;

          case 'batch_start':
            setParallelState(prev => ({
              ...prev,
              currentBatch: event.batchNumber || 0,
              tasks: (event.tasks || []).map(t => ({
                id: t.id,
                title: t.title,
                branchName: '',
                status: 'pending' as const,
                output: '',
              })),
            }));
            setState(prev => ({
              ...prev,
              setupMessage: `Batch ${event.batchNumber}/${event.totalBatches}: ${event.taskCount} tasks`,
            }));
            break;

          case 'task_start':
            setParallelState(prev => ({
              ...prev,
              tasks: prev.tasks.map(t =>
                t.id === event.taskId
                  ? { ...t, status: 'running' as const, branchName: event.branchName || '' }
                  : t
              ),
            }));
            // Auto-select first running task if none selected
            setSelectedTaskId(prev => prev || event.taskId || null);
            break;

          case 'task_setup':
            setParallelState(prev => ({
              ...prev,
              tasks: prev.tasks.map(t =>
                t.id === event.taskId
                  ? { ...t, output: t.output + `[Setup] ${event.message}\n\n` }
                  : t
              ),
            }));
            break;

          case 'task_claude':
            // Handle nested claude events
            if (event.event) {
              const claudeEvent = event.event as Record<string, unknown>;
              let textContent = '';

              // Extract text from various formats
              if (claudeEvent.message && typeof claudeEvent.message === 'object') {
                const msg = claudeEvent.message as { content?: Array<{ type: string; text?: string }> };
                if (Array.isArray(msg.content)) {
                  textContent = msg.content
                    .filter(block => block.type === 'text' && block.text)
                    .map(block => block.text)
                    .join('');
                }
              } else if (claudeEvent.content && typeof claudeEvent.content === 'string') {
                textContent = claudeEvent.content;
              }

              if (textContent) {
                setParallelState(prev => ({
                  ...prev,
                  tasks: prev.tasks.map(t =>
                    t.id === event.taskId
                      ? { ...t, output: t.output + textContent }
                      : t
                  ),
                }));
              }
            }
            break;

          case 'task_commit':
            setParallelState(prev => ({
              ...prev,
              tasks: prev.tasks.map(t =>
                t.id === event.taskId
                  ? { ...t, commitUrl: event.commitUrl, output: t.output + `\n**Committed:** ${event.commitUrl}\n` }
                  : t
              ),
            }));
            break;

          case 'task_complete':
            setParallelState(prev => ({
              ...prev,
              tasks: prev.tasks.map(t =>
                t.id === event.taskId
                  ? {
                      ...t,
                      status: event.success ? 'completed' as const : 'failed' as const,
                      error: event.error,
                    }
                  : t
              ),
            }));
            if (event.success) {
              setState(prev => ({
                ...prev,
                completedTasks: [...prev.completedTasks, event.taskId || ''],
              }));
            }
            break;

          case 'task_error':
            setParallelState(prev => ({
              ...prev,
              tasks: prev.tasks.map(t =>
                t.id === event.taskId
                  ? { ...t, output: t.output + `\n**Error:** ${event.error}\n`, error: event.error }
                  : t
              ),
            }));
            break;

          case 'batch_complete':
            setState(prev => ({
              ...prev,
              setupMessage: `Batch ${event.batchNumber} complete: ${event.successCount} succeeded, ${event.failedCount} failed`,
            }));
            break;

          case 'merge_start':
            setParallelState(prev => ({
              ...prev,
              mergeInProgress: true,
              tasks: prev.tasks.map(t =>
                event.branches?.includes(t.branchName)
                  ? { ...t, status: 'merging' as const }
                  : t
              ),
            }));
            setState(prev => ({
              ...prev,
              setupMessage: `Merging ${event.branches?.length || 0} branches to main...`,
            }));
            break;

          case 'merge_complete':
            setParallelState(prev => ({
              ...prev,
              tasks: prev.tasks.map(t =>
                t.id === event.taskId
                  ? { ...t, status: 'merged' as const }
                  : t
              ),
            }));
            break;

          case 'merge_conflict':
            setParallelState(prev => ({
              ...prev,
              tasks: prev.tasks.map(t =>
                t.id === event.taskId
                  ? { ...t, status: 'failed' as const, error: `Merge conflict: ${event.error}` }
                  : t
              ),
            }));
            setState(prev => ({
              ...prev,
              errors: [...prev.errors, `Merge conflict for ${event.branchName}: ${event.error}`],
            }));
            break;

          case 'merge_batch_complete':
            setParallelState(prev => ({
              ...prev,
              mergeInProgress: false,
            }));
            break;

          // Code Review Events
          case 'review_start':
            setParallelState(prev => ({
              ...prev,
              reviewInProgress: true,
              tasks: prev.tasks.map(t =>
                t.status === 'merged'
                  ? { ...t, status: 'reviewing' as const }
                  : t
              ),
            }));
            setState(prev => ({
              ...prev,
              setupMessage: `Code review: reviewing ${event.taskCount} tasks...`,
            }));
            break;

          case 'review_task_start':
            setParallelState(prev => ({
              ...prev,
              tasks: prev.tasks.map(t =>
                t.id === event.taskId
                  ? {
                      ...t,
                      status: 'reviewing' as const,
                      reviewAttempt: event.attempt,
                      output: t.output + `\n**Code Review** (Attempt ${event.attempt}/${event.maxAttempts})\n`,
                    }
                  : t
              ),
            }));
            break;

          case 'review_progress':
            setParallelState(prev => ({
              ...prev,
              tasks: prev.tasks.map(t =>
                t.id === event.taskId
                  ? { ...t, output: t.output + `${event.message}\n` }
                  : t
              ),
            }));
            break;

          case 'review_task_complete':
            setParallelState(prev => ({
              ...prev,
              tasks: prev.tasks.map(t =>
                t.id === event.taskId
                  ? {
                      ...t,
                      status: 'review_passed' as const,
                      qualityScore: event.qualityScore,
                      output: t.output + `\n✅ **Review Passed!** Quality: ${event.qualityScore}/10\n${event.summary || ''}\n`,
                    }
                  : t
              ),
            }));
            break;

          case 'review_fix_start':
            setParallelState(prev => ({
              ...prev,
              tasks: prev.tasks.map(t =>
                t.id === event.taskId
                  ? {
                      ...t,
                      status: 'fixing' as const,
                      qualityScore: event.qualityScore,
                      output: t.output + `\n⚠️ Quality ${event.qualityScore}/10 (target: 9.5)\n**Fixing issues...**\n${(event.issues || []).map((i: string) => `  - ${i}`).join('\n')}\n`,
                    }
                  : t
              ),
            }));
            break;

          case 'review_fix_progress':
            setParallelState(prev => ({
              ...prev,
              tasks: prev.tasks.map(t =>
                t.id === event.taskId
                  ? { ...t, output: t.output + `${event.message}\n` }
                  : t
              ),
            }));
            break;

          case 'review_fix_complete':
            setParallelState(prev => ({
              ...prev,
              tasks: prev.tasks.map(t =>
                t.id === event.taskId
                  ? { ...t, output: t.output + `\n**Fix complete, re-reviewing...**\n` }
                  : t
              ),
            }));
            break;

          case 'review_task_failed':
            setParallelState(prev => ({
              ...prev,
              tasks: prev.tasks.map(t =>
                t.id === event.taskId
                  ? {
                      ...t,
                      status: 'review_failed' as const,
                      qualityScore: event.qualityScore,
                      error: `Quality ${event.qualityScore}/10 after ${event.maxAttempts} attempts`,
                      output: t.output + `\n❌ **Review Failed** - Quality: ${event.qualityScore}/10\n${event.summary || ''}\n`,
                    }
                  : t
              ),
            }));
            break;

          case 'review_batch_complete':
            setParallelState(prev => ({
              ...prev,
              reviewInProgress: false,
            }));
            setState(prev => ({
              ...prev,
              setupMessage: `Batch ${event.batchNumber} review complete`,
            }));
            break;

          case 'error':
            setState(prev => ({
              ...prev,
              errors: [...prev.errors, event.message || 'Unknown error'],
            }));
            break;

          case 'aborted':
            setHasActiveStream(false);
            setState(prev => ({
              ...prev,
              isRunning: false,
              setupMessage: 'Development aborted',
            }));
            break;

          case 'done':
            setHasActiveStream(false);
            setState(prev => ({
              ...prev,
              isRunning: false,
              currentPhase: event.success ? 'complete' : prev.currentPhase,
              setupMessage: event.success ? 'Parallel development complete!' : 'Development finished with errors',
            }));
            if (event.success) {
              toast({ title: 'Success', description: 'Parallel development completed!' });
            }
            break;
        }
      },
      onError: (error) => {
        setHasActiveStream(false);
        setState(prev => ({
          ...prev,
          isRunning: false,
          errors: [...prev.errors, error.message],
        }));
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      },
      onComplete: () => {
        setHasActiveStream(false);
        abortRef.current = null;
      },
    });

    abortRef.current = abort;
  };

  // Reconnect to stream (for page refresh scenarios)
  const handleReconnect = () => {
    if (!id || hasActiveStream) return;
    toast({ title: 'Reconnecting', description: 'Connecting to live stream...' });
    connectToParallelStream();
  };

  // Auto-reconnect when page loads with running development
  React.useEffect(() => {
    if (shouldAutoReconnect && !hasActiveStream) {
      setShouldAutoReconnect(false);
      connectToParallelStream();
    }
  }, [shouldAutoReconnect, hasActiveStream]);

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

        <div className="flex items-center gap-4">
          <ThemeToggle />
          {!state.isRunning ? (
            <Button
              onClick={handleStart}
              className="gap-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
            >
              <Zap className="h-4 w-4" />
              Start Development
            </Button>
          ) : (
            <>
              {!hasActiveStream && (
                <Button
                  onClick={handleReconnect}
                  variant="outline"
                  className="gap-2 text-blue-600 border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
                >
                  <Radio className="h-4 w-4" />
                  Reconnect to Stream
                </Button>
              )}
              <Button onClick={handleStop} variant="destructive" className="gap-2">
                <Square className="h-4 w-4" />
                Stop
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Progress bar */}
      <div className="px-4 py-2 border-b">
        <Progress value={progress} className="h-2" />
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - different for parallel vs sequential */}
        <div className="w-72 border-r p-4 overflow-auto">
          {isParallelMode && parallelState.tasks.length > 0 ? (
            // Parallel mode: show batch and task grid
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  BATCH {parallelState.currentBatch}/{parallelState.totalBatches}
                </h2>
                {parallelState.mergeInProgress && (
                  <Badge variant="outline" className="gap-1 text-purple-600 border-purple-600">
                    <GitMerge className="h-3 w-3 animate-spin" />
                    Merging
                  </Badge>
                )}
              </div>

              {/* Task grid */}
              <div className="space-y-2">
                {parallelState.tasks.map((task) => {
                  const isSelected = selectedTaskId === task.id;
                  const statusColors = {
                    pending: 'bg-muted text-muted-foreground',
                    running: 'bg-blue-500/10 text-blue-600 border-blue-500',
                    completed: 'bg-green-500/10 text-green-600 border-green-500',
                    failed: 'bg-red-500/10 text-red-600 border-red-500',
                    merging: 'bg-purple-500/10 text-purple-600 border-purple-500',
                    merged: 'bg-emerald-500/10 text-emerald-600 border-emerald-500',
                    reviewing: 'bg-yellow-500/10 text-yellow-600 border-yellow-500',
                    fixing: 'bg-orange-500/10 text-orange-600 border-orange-500',
                    review_passed: 'bg-green-500/10 text-green-600 border-green-500',
                    review_failed: 'bg-red-500/10 text-red-600 border-red-500',
                  };

                  return (
                    <Card
                      key={task.id}
                      className={cn(
                        'cursor-pointer transition-all border-2',
                        statusColors[task.status],
                        isSelected && 'ring-2 ring-blue-500 ring-offset-2'
                      )}
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start gap-2">
                          {task.status === 'running' && <Loader2 className="h-4 w-4 animate-spin flex-shrink-0 mt-0.5" />}
                          {task.status === 'completed' && <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />}
                          {task.status === 'failed' && <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />}
                          {task.status === 'merging' && <GitMerge className="h-4 w-4 animate-spin flex-shrink-0 mt-0.5" />}
                          {task.status === 'merged' && <GitMerge className="h-4 w-4 flex-shrink-0 mt-0.5" />}
                          {task.status === 'pending' && <Circle className="h-4 w-4 flex-shrink-0 mt-0.5" />}
                          {task.status === 'reviewing' && <FileSearch className="h-4 w-4 animate-pulse flex-shrink-0 mt-0.5" />}
                          {task.status === 'fixing' && <Code2 className="h-4 w-4 animate-pulse flex-shrink-0 mt-0.5" />}
                          {task.status === 'review_passed' && <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />}
                          {task.status === 'review_failed' && <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{task.title}</p>
                            {task.branchName && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                <GitBranch className="h-3 w-3" />
                                {task.branchName}
                              </p>
                            )}
                            {task.qualityScore !== undefined && (
                              <p className={cn(
                                "text-xs flex items-center gap-1 mt-1",
                                task.qualityScore >= 9.5 ? "text-green-600" : "text-yellow-600"
                              )}>
                                <Sparkles className="h-3 w-3" />
                                Quality: {task.qualityScore}/10
                              </p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Summary */}
              <div className="mt-4 pt-4 border-t">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1 text-green-600">
                    <CheckCircle2 className="h-3 w-3" />
                    {parallelState.tasks.filter(t => t.status === 'completed' || t.status === 'merged' || t.status === 'review_passed').length} Done
                  </div>
                  <div className="flex items-center gap-1 text-blue-600">
                    <Loader2 className="h-3 w-3" />
                    {parallelState.tasks.filter(t => t.status === 'running' || t.status === 'merging').length} Running
                  </div>
                  <div className="flex items-center gap-1 text-yellow-600">
                    <FileSearch className="h-3 w-3" />
                    {parallelState.tasks.filter(t => t.status === 'reviewing' || t.status === 'fixing').length} Reviewing
                  </div>
                  <div className="flex items-center gap-1 text-red-600">
                    <AlertCircle className="h-3 w-3" />
                    {parallelState.tasks.filter(t => t.status === 'failed' || t.status === 'review_failed').length} Failed
                  </div>
                </div>
              </div>
            </>
          ) : (
            // Sequential mode: show phase timeline
            <>
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
            </>
          )}
        </div>

        {/* Right: Output panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Status bar */}
          <div className="flex items-center gap-4 px-4 py-2 border-b bg-muted/30">
            {state.isRunning && (
              <Badge
                variant="outline"
                className={cn(
                  'gap-1',
                  hasActiveStream
                    ? 'text-green-600 border-green-600'
                    : 'text-yellow-600 border-yellow-600'
                )}
              >
                {hasActiveStream ? (
                  <>
                    <Radio className="h-3 w-3 animate-pulse" />
                    Live
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-3 w-3" />
                    Disconnected
                  </>
                )}
              </Badge>
            )}
            {isParallelMode && parallelState.currentBatch > 0 && (
              <Badge variant="secondary" className="gap-1">
                <Layers className="h-3 w-3" />
                Batch {parallelState.currentBatch}/{parallelState.totalBatches}
              </Badge>
            )}
            {parallelState.reviewInProgress && (
              <Badge variant="outline" className="gap-1 text-yellow-600 border-yellow-600">
                <FileSearch className="h-3 w-3 animate-pulse" />
                Code Review
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
            {/* Parallel mode: show selected task output */}
            {isParallelMode && parallelState.tasks.length > 0 ? (
              <>
                {selectedTaskId ? (
                  (() => {
                    const task = parallelState.tasks.find(t => t.id === selectedTaskId);
                    if (!task) return null;
                    return (
                      <div>
                        <div className="flex items-center gap-2 mb-4 pb-2 border-b">
                          <GitBranch className="h-4 w-4 text-purple-500" />
                          <span className="font-medium">{task.title}</span>
                          {task.branchName && (
                            <Badge variant="outline" className="text-xs">
                              {task.branchName}
                            </Badge>
                          )}
                        </div>
                        <div className="font-mono text-sm">
                          {task.output ? (
                            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
                              <ReactMarkdown>{task.output}</ReactMarkdown>
                            </div>
                          ) : task.status === 'running' ? (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Developing...
                            </div>
                          ) : task.status === 'pending' ? (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Circle className="h-4 w-4" />
                              Waiting to start...
                            </div>
                          ) : null}
                        </div>
                        {task.error && (
                          <div className="mt-4 flex items-start gap-2 text-red-600 bg-red-50 dark:bg-red-950 p-3 rounded-lg">
                            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                            <span className="text-sm">{task.error}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <Layers className="h-16 w-16 text-muted-foreground/30 mb-4" />
                    <h3 className="text-lg font-medium text-muted-foreground">Select a task</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Click on a task in the sidebar to view its output
                    </p>
                  </div>
                )}
              </>
            ) : !state.isRunning && !state.claudeOutput && state.completedTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Rocket className="h-16 w-16 text-muted-foreground/30 mb-4" />
                <h3 className="text-lg font-medium text-muted-foreground">Ready to develop</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {isParallelMode
                    ? 'Click "Start Parallel Dev" to develop multiple tasks simultaneously'
                    : 'Click "Start Development" to begin the pipeline'}
                </p>
              </div>
            ) : (
              <div className="font-mono text-sm">
                {state.claudeOutput ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
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
