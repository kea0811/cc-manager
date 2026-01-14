import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import type { StreamingPhase } from '@/types';
import {
  Sparkles,
  FileText,
  FolderSearch,
  Terminal,
  Edit3,
  Eye,
  Search,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface StreamingChatBubbleProps {
  phase: StreamingPhase;
  content: string;
  currentTool: string | null;
  error: string | null;
  onCancel?: () => void;
}

// Map tool names to friendly labels and icons
const TOOL_INFO: Record<string, { label: string; icon: React.ElementType }> = {
  Read: { label: 'Reading file', icon: FileText },
  Glob: { label: 'Searching files', icon: FolderSearch },
  Grep: { label: 'Searching code', icon: Search },
  Bash: { label: 'Running command', icon: Terminal },
  Edit: { label: 'Editing file', icon: Edit3 },
  Write: { label: 'Writing file', icon: FileText },
  View: { label: 'Viewing', icon: Eye },
  Task: { label: 'Running task', icon: Sparkles },
};

const getToolInfo = (toolName: string | null) => {
  if (!toolName) return null;
  return TOOL_INFO[toolName] || { label: `Using ${toolName}`, icon: Terminal };
};

// Phase indicator component
const PhaseIndicator: React.FC<{
  phase: StreamingPhase;
  currentTool: string | null;
}> = ({ phase, currentTool }) => {
  const toolInfo = getToolInfo(currentTool);

  if (phase === 'connecting') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="flex gap-1">
          <span className="h-2 w-2 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.3s]" />
          <span className="h-2 w-2 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]" />
          <span className="h-2 w-2 rounded-full bg-blue-500 animate-bounce" />
        </div>
        <span>Connecting...</span>
      </div>
    );
  }

  if (phase === 'thinking') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="h-4 w-4 animate-pulse text-purple-500" />
        <span>Thinking...</span>
      </div>
    );
  }

  if (phase === 'tool_use' && toolInfo) {
    const Icon = toolInfo.icon;
    return (
      <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
        <Icon className="h-4 w-4 animate-pulse" />
        <span>{toolInfo.label}...</span>
      </div>
    );
  }

  if (phase === 'writing') {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
        <Edit3 className="h-4 w-4" />
        <span>Writing...</span>
      </div>
    );
  }

  return null;
};

// Streaming cursor/caret
const StreamingCursor: React.FC = () => (
  <span className="inline-block w-2 h-4 ml-0.5 bg-foreground/70 animate-pulse" />
);

export const StreamingChatBubble: React.FC<StreamingChatBubbleProps> = ({
  phase,
  content,
  currentTool,
  error,
  onCancel,
}) => {
  const isActive = phase !== 'idle' && phase !== 'complete' && phase !== 'error';
  const hasContent = content.length > 0;

  // Error state
  if (phase === 'error' || error) {
    return (
      <div className="flex justify-start mb-4">
        <div className="max-w-[80%] rounded-lg px-4 py-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800">
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <X className="h-4 w-4" />
            <span>{error || 'An error occurred'}</span>
          </div>
        </div>
      </div>
    );
  }

  // Idle state - nothing to show
  if (phase === 'idle' && !hasContent) {
    return null;
  }

  return (
    <div className="flex justify-start mb-4 group">
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-4 py-2 bg-muted transition-all duration-200',
          isActive && 'ring-2 ring-blue-500/30 shadow-md'
        )}
      >
        {/* Phase indicator - shows above content when active */}
        {isActive && !hasContent && (
          <PhaseIndicator phase={phase} currentTool={currentTool} />
        )}

        {/* Content area */}
        {hasContent && (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{content}</ReactMarkdown>
            {/* Show cursor while actively streaming */}
            {phase === 'writing' && <StreamingCursor />}
          </div>
        )}

        {/* Tool indicator - shows below content when using tool */}
        {hasContent && phase === 'tool_use' && currentTool && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <PhaseIndicator phase={phase} currentTool={currentTool} />
          </div>
        )}

        {/* Thinking indicator - shows below content when thinking */}
        {hasContent && phase === 'thinking' && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <PhaseIndicator phase={phase} currentTool={null} />
          </div>
        )}

        {/* Cancel button */}
        {isActive && onCancel && (
          <div className="mt-2 pt-2 border-t border-border/50 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>
          </div>
        )}

        {/* Timestamp placeholder - will be filled when complete */}
        {phase === 'complete' && (
          <span className="mt-1 block text-xs opacity-70">
            {new Date().toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
};

export default StreamingChatBubble;
