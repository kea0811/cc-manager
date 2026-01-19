import * as React from 'react';
import * as Diff from 'diff';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface DiffViewProps {
  oldContent: string;
  newContent: string;
}

interface DiffLine {
  type: 'add' | 'remove' | 'unchanged';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export const DiffView: React.FC<DiffViewProps> = ({ oldContent, newContent }) => {
  const diffLines = React.useMemo(() => {
    const changes = Diff.diffLines(oldContent, newContent);
    const lines: DiffLine[] = [];
    let oldLineNum = 1;
    let newLineNum = 1;

    for (const change of changes) {
      const lineContents = change.value.split('\n');
      // Remove last empty element if the string ends with newline
      if (lineContents[lineContents.length - 1] === '') {
        lineContents.pop();
      }

      for (const line of lineContents) {
        if (change.added) {
          lines.push({
            type: 'add',
            content: line,
            newLineNumber: newLineNum++,
          });
        } else if (change.removed) {
          lines.push({
            type: 'remove',
            content: line,
            oldLineNumber: oldLineNum++,
          });
        } else {
          lines.push({
            type: 'unchanged',
            content: line,
            oldLineNumber: oldLineNum++,
            newLineNumber: newLineNum++,
          });
        }
      }
    }

    return lines;
  }, [oldContent, newContent]);

  const stats = React.useMemo(() => {
    const added = diffLines.filter(l => l.type === 'add').length;
    const removed = diffLines.filter(l => l.type === 'remove').length;
    return { added, removed };
  }, [diffLines]);

  const hasChanges = stats.added > 0 || stats.removed > 0;

  if (!hasChanges) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>No changes to display</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Stats header */}
      <div className="flex items-center gap-4 border-b px-4 py-2 text-sm">
        <span className="text-muted-foreground">Changes:</span>
        <span className="text-green-600 font-medium">+{stats.added} added</span>
        <span className="text-red-600 font-medium">-{stats.removed} removed</span>
      </div>

      {/* Diff content */}
      <ScrollArea className="flex-1">
        <div className="font-mono text-sm">
          {diffLines.map((line, index) => (
            <div
              key={index}
              className={cn(
                'flex border-b border-border/30',
                line.type === 'add' && 'bg-green-500/10',
                line.type === 'remove' && 'bg-red-500/10'
              )}
            >
              {/* Line numbers */}
              <div className="flex w-20 flex-shrink-0 select-none border-r border-border/50 text-muted-foreground text-xs">
                <span className="w-10 px-2 py-0.5 text-right border-r border-border/30">
                  {line.oldLineNumber || ''}
                </span>
                <span className="w-10 px-2 py-0.5 text-right">
                  {line.newLineNumber || ''}
                </span>
              </div>

              {/* Change indicator */}
              <div
                className={cn(
                  'w-6 flex-shrink-0 text-center py-0.5 font-bold select-none',
                  line.type === 'add' && 'text-green-600 bg-green-500/20',
                  line.type === 'remove' && 'text-red-600 bg-red-500/20'
                )}
              >
                {line.type === 'add' && '+'}
                {line.type === 'remove' && '-'}
              </div>

              {/* Content */}
              <pre
                className={cn(
                  'flex-1 px-2 py-0.5 whitespace-pre-wrap break-all',
                  line.type === 'add' && 'text-green-700 dark:text-green-400',
                  line.type === 'remove' && 'text-red-700 dark:text-red-400'
                )}
              >
                {line.content || ' '}
              </pre>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
