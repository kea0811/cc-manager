import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ProjectCard } from '@/components/ProjectCard';
import { CreateProjectDialog } from '@/components/CreateProjectDialog';
import { projectsApi } from '@/api/projects';
import { useToast } from '@/hooks/use-toast';
import { Plus, FolderOpen } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import type { Project, CreateProjectData } from '@/types';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [commitCounts, setCommitCounts] = React.useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = React.useState(true);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);

  const fetchProjects = React.useCallback(async () => {
    try {
      const data = await projectsApi.getAll();
      setProjects(data);

      // Fetch commit counts for all projects in parallel
      const commitPromises = data.map(async (project) => {
        try {
          const summary = await projectsApi.getCommitSummary(project.id);
          return { id: project.id, count: summary.totalCommits };
        } catch {
          return { id: project.id, count: 0 };
        }
      });

      const results = await Promise.all(commitPromises);
      const counts: Record<string, number> = {};
      results.forEach(({ id, count }) => {
        counts[id] = count;
      });
      setCommitCounts(counts);
    } catch {
      toast({ title: 'Error', description: 'Failed to load projects', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleCreateProject = async (data: CreateProjectData): Promise<void> => {
    setIsCreating(true);
    try {
      const project = await projectsApi.create(data);
      setProjects((prev) => [project, ...prev]);
      setIsCreateOpen(false);
      toast({ title: 'Success', description: 'Project created successfully' });
      navigate(`/projects/${project.id}`);
    } catch {
      toast({ title: 'Error', description: 'Failed to create project', variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteProject = async (id: string): Promise<void> => {
    try {
      await projectsApi.delete(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      toast({ title: 'Success', description: 'Project deleted' });
    } catch {
      toast({ title: 'Error', description: 'Failed to delete project', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading projects...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-4" data-testid="dashboard">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="text-muted-foreground">Manage your development projects</p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button onClick={() => setIsCreateOpen(true)} data-testid="create-project-btn">
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12">
          <FolderOpen className="mb-4 h-12 w-12 text-muted-foreground" />
          <h2 className="mb-2 text-xl font-semibold">No projects yet</h2>
          <p className="mb-4 text-muted-foreground">Create your first project to get started</p>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Project
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              commitCount={commitCounts[project.id] ?? 0}
              onClick={() => navigate(`/projects/${project.id}`)}
              onDelete={() => handleDeleteProject(project.id)}
            />
          ))}
        </div>
      )}

      <CreateProjectDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onSubmit={handleCreateProject}
        isLoading={isCreating}
      />
    </div>
  );
};
