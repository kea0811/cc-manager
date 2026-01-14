import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Trash2 } from 'lucide-react';
import type { Project, UpdateProjectData } from '@/types';

interface ProjectSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  onUpdate: (data: UpdateProjectData) => Promise<void>;
  onDelete: () => Promise<void>;
  isLoading?: boolean;
}

export const ProjectSettingsDialog: React.FC<ProjectSettingsDialogProps> = ({
  open,
  onOpenChange,
  project,
  onUpdate,
  onDelete,
  isLoading = false,
}) => {
  const [name, setName] = React.useState(project.name);
  const [description, setDescription] = React.useState(project.description || '');
  const [githubRepo, setGithubRepo] = React.useState(project.githubRepo || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  // Reset form when project changes or dialog opens
  React.useEffect(() => {
    if (open) {
      setName(project.name);
      setDescription(project.description || '');
      setGithubRepo(project.githubRepo || '');
      setShowDeleteConfirm(false);
    }
  }, [open, project]);

  const hasChanges =
    name !== project.name ||
    description !== (project.description || '') ||
    githubRepo !== (project.githubRepo || '');

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      const updates: UpdateProjectData = {};
      if (name !== project.name) updates.name = name.trim();
      if (description !== (project.description || '')) {
        updates.description = description.trim() || undefined;
      }
      if (githubRepo !== (project.githubRepo || '')) {
        updates.githubRepo = githubRepo.trim() || undefined;
      }
      await onUpdate(updates);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
    }
  };

  const isGitRepoValid = (): boolean => {
    if (!githubRepo) return true;
    // HTTPS: https://github.com/user/repo or similar
    const httpsPattern = /^https?:\/\/[^\s]+$/;
    // SSH: git@github.com:user/repo.git
    const sshPattern = /^git@[^:]+:[^\s]+$/;
    return httpsPattern.test(githubRepo) || sshPattern.test(githubRepo);
  };
  const isGithubUrlValid = isGitRepoValid();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
          <DialogDescription>
            Update your project details or link a GitHub repository.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="settings-name">Name</Label>
            <Input
              id="settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              disabled={isLoading || isSaving}
              data-testid="settings-name"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="settings-description">Description</Label>
            <Textarea
              id="settings-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A brief description of your project..."
              disabled={isLoading || isSaving}
              data-testid="settings-description"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="settings-github">GitHub Repository</Label>
            <Input
              id="settings-github"
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              placeholder="git@github.com:user/repo.git"
              disabled={isLoading || isSaving}
              data-testid="settings-github"
            />
            {githubRepo && !isGithubUrlValid && (
              <p className="text-sm text-destructive">
                Enter a valid HTTPS or SSH URL (e.g., git@github.com:user/repo.git)
              </p>
            )}
            {project.status === 'draft' && githubRepo && isGithubUrlValid && (
              <p className="text-sm text-muted-foreground">
                Linking a repo will enable Development Mode
              </p>
            )}
          </div>

          <Separator className="my-2" />

          {/* Danger Zone */}
          <div className="grid gap-2">
            <Label className="text-destructive">Danger Zone</Label>
            {!showDeleteConfirm ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isLoading || isSaving || isDeleting}
                data-testid="delete-project-btn"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Project
              </Button>
            ) : (
              <div className="flex flex-col gap-2 rounded-md border border-destructive p-3">
                <p className="text-sm font-medium">
                  Are you sure? This action cannot be undone.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDeleting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={isDeleting}
                    data-testid="confirm-delete-btn"
                  >
                    {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving || isDeleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!name.trim() || !hasChanges || !isGithubUrlValid || isSaving || isDeleting}
            data-testid="save-settings-btn"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
