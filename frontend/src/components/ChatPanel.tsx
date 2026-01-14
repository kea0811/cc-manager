import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Trash2, Loader2, Zap } from 'lucide-react';
import { StreamingChatBubble } from '@/components/StreamingChatBubble';
import type { ChatMessage, StreamingState } from '@/types';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (content: string) => void;
  onClearChat: () => void;
  isLoading?: boolean;
  // Streaming support
  streamingState?: StreamingState;
  onCancelStream?: () => void;
  useStreaming?: boolean;
}

const ChatBubble: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        }`}
        data-testid={`chat-message-${message.role}`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
        <span className="mt-1 block text-xs opacity-70">
          {new Date(message.createdAt).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
};

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  onClearChat,
  isLoading = false,
  streamingState,
  onCancelStream,
  useStreaming = true,
}) => {
  const [input, setInput] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Determine if actively streaming
  const isStreaming = streamingState && streamingState.phase !== 'idle' && streamingState.phase !== 'complete';
  const isDisabled = isLoading || isStreaming;

  // Auto-scroll when messages change, loading starts, or streaming content updates
  React.useEffect(() => {
    if (scrollRef.current) {
      // ScrollArea uses a viewport div inside, find it
      const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [messages, isLoading, streamingState?.content]);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!input.trim() || isDisabled) return;
    onSendMessage(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden" data-testid="chat-panel">
      {/* Header - fixed at top */}
      <div className="flex-shrink-0 flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">Chat</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClearChat}
          disabled={messages.length === 0}
          title="Clear chat"
          data-testid="clear-chat"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages area - scrollable, takes remaining space */}
      <ScrollArea className="flex-1 min-h-0 p-4" ref={scrollRef}>
        {messages.length === 0 && !isLoading && !isStreaming ? (
          <p className="text-center text-muted-foreground">
            Start a conversation to capture your ideas...
          </p>
        ) : (
          <>
            {messages.map((message) => <ChatBubble key={message.id} message={message} />)}

            {/* Streaming bubble - shows real-time response */}
            {streamingState && streamingState.phase !== 'idle' && (
              <StreamingChatBubble
                phase={streamingState.phase}
                content={streamingState.content}
                currentTool={streamingState.currentTool}
                error={streamingState.error}
                onCancel={onCancelStream}
              />
            )}

            {/* Fallback loading indicator for non-streaming mode */}
            {isLoading && !isStreaming && (
              <div className="flex justify-start mb-4" data-testid="chat-loading">
                <div className="max-w-[80%] rounded-lg px-4 py-2 bg-muted">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Thinking...</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </ScrollArea>

      {/* Input area - fixed at bottom, always visible */}
      <form onSubmit={handleSubmit} className="flex-shrink-0 border-t bg-background p-4">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isStreaming ? 'Waiting for response...' : 'Type your message... (Enter to send, Shift+Enter for new line)'}
            className="min-h-[60px] max-h-[120px] resize-none"
            disabled={isDisabled}
            data-testid="chat-input"
          />
          <Button
            type="submit"
            disabled={!input.trim() || isDisabled}
            data-testid="send-message"
            className="relative"
          >
            {isStreaming ? (
              <Zap className="h-4 w-4 animate-pulse text-yellow-400" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        {/* Streaming status indicator */}
        {useStreaming && (
          <div className="mt-2 flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <Zap className="h-3 w-3" />
            <span>Streaming enabled</span>
          </div>
        )}
      </form>
    </div>
  );
};
