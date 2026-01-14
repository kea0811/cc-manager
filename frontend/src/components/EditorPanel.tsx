import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Save, Eye, Edit2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ScrollArea } from '@/components/ui/scroll-area';

interface EditorPanelProps {
  content: string;
  onChange: (content: string) => void;
  onSave: () => void;
  isDirty: boolean;
  isSaving?: boolean;
}

export const EditorPanel: React.FC<EditorPanelProps> = ({
  content,
  onChange,
  onSave,
  isDirty,
  isSaving = false,
}) => {
  const [isPreview, setIsPreview] = React.useState(false);

  return (
    <div className="flex h-full flex-col" data-testid="editor-panel">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">Editor</h2>
        <div className="flex gap-2">
          <Button
            variant={isPreview ? 'outline' : 'secondary'}
            size="sm"
            onClick={() => setIsPreview(false)}
            title="Edit mode"
          >
            <Edit2 className="mr-1 h-4 w-4" />
            Edit
          </Button>
          <Button
            variant={isPreview ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setIsPreview(true)}
            title="Preview mode"
          >
            <Eye className="mr-1 h-4 w-4" />
            Preview
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
        {isPreview ? (
          <ScrollArea className="h-full p-4">
            <div className="prose prose-sm max-w-none dark:prose-invert" data-testid="editor-preview">
              <ReactMarkdown>{content || '*No content yet*'}</ReactMarkdown>
            </div>
          </ScrollArea>
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
