import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Save, Eye, Edit2, GitCompare } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DiffView } from '@/components/DiffView';
import { cn } from '@/lib/utils';

type EditorMode = 'edit' | 'preview' | 'diff';

interface EditorPanelProps {
  content: string;
  onChange: (content: string) => void;
  onSave: () => void;
  isDirty: boolean;
  isSaving?: boolean;
  savedContent?: string; // The last saved version for diff comparison
}

export const EditorPanel: React.FC<EditorPanelProps> = ({
  content,
  onChange,
  onSave,
  isDirty,
  isSaving = false,
  savedContent = '',
}) => {
  const [mode, setMode] = React.useState<EditorMode>('edit');

  return (
    <div className="flex h-full flex-col" data-testid="editor-panel">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">Editor</h2>
        <div className="flex gap-2">
          <Button
            variant={mode === 'edit' ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setMode('edit')}
            title="Edit mode"
          >
            <Edit2 className="mr-1 h-4 w-4" />
            Edit
          </Button>
          <Button
            variant={mode === 'preview' ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setMode('preview')}
            title="Preview mode"
          >
            <Eye className="mr-1 h-4 w-4" />
            Preview
          </Button>
          <Button
            variant={mode === 'diff' ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setMode('diff')}
            title="View changes"
            className={cn(
              isDirty && mode !== 'diff' && 'border-yellow-500 text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-950'
            )}
          >
            <GitCompare className="mr-1 h-4 w-4" />
            Diff
            {isDirty && (
              <span className="ml-1 h-2 w-2 rounded-full bg-yellow-500" />
            )}
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={!isDirty || isSaving}
            data-testid="save-editor"
          >
            <Save className="mr-1 h-4 w-4" />
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {mode === 'preview' ? (
          <ScrollArea className="h-full p-4">
            <div className="prose prose-sm max-w-none dark:prose-invert" data-testid="editor-preview">
              <ReactMarkdown>{content || '*No content yet*'}</ReactMarkdown>
            </div>
          </ScrollArea>
        ) : mode === 'diff' ? (
          <DiffView oldContent={savedContent} newContent={content} />
        ) : (
          <Textarea
            value={content}
            onChange={(e) => onChange(e.target.value)}
            className="h-full w-full resize-none rounded-none border-0 font-mono text-sm focus-visible:ring-0"
            placeholder="# Start writing your project documentation..."
            data-testid="editor-textarea"
          />
        )}
      </div>
    </div>
  );
};
