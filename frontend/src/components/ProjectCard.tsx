import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trash2, ExternalLink, Github } from 'lucide-react';
import type { Project } from '@/types';

interface ProjectCardProps {
  project: Project;
  onClick: () => void;
  onDelete: () => void;
}

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const StatusBadge: React.FC<{ status: Project['status'] }> = ({ status }) => {
  const colors: Record<Project['status'], string> = {
    draft: 'bg-yellow-100 text-yellow-800',
    development: 'bg-blue-100 text-blue-800',
    deployed: 'bg-green-100 text-green-800',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${colors[status]}`}>
      {status}
    </span>
  );
};

export const ProjectCard: React.FC<ProjectCardProps> = ({ project, onClick, onDelete }) => {
  const handleDelete = (e: React.MouseEvent): void => {
    e.stopPropagation();
    onDelete();
  };

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={onClick}
      data-testid="project-card"
    >
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-lg font-semibold">{project.name}</CardTitle>
          {project.description && (
            <CardDescription className="text-sm">{project.description}</CardDescription>
          )}
        </div>
        <StatusBadge status={project.status} />
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Updated {formatDate(project.updatedAt)}</span>
            {project.githubRepo && (
              <a
                href={project.githubRepo}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Github className="h-4 w-4" />
              </a>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" onClick={onClick}>
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleDelete} data-testid="delete-project">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
