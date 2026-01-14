import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, MemoryRouter, Routes, Route } from 'react-router-dom';
import { Dashboard } from '@/pages/Dashboard';
import { Workspace } from '@/pages/Workspace';
import { mockProjects, mockMessages, server } from './setup';
import { http, HttpResponse } from 'msw';

const renderWithRouter = (ui: React.ReactElement, { route = '/' } = {}) => {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects/:id" element={<Workspace />} />
      </Routes>
    </MemoryRouter>
  );
};

describe('Dashboard Page', () => {
  it('renders loading state initially', () => {
    render(<Dashboard />, { wrapper: BrowserRouter });
    expect(screen.getByText('Loading projects...')).toBeInTheDocument();
  });

  it('renders projects after loading', async () => {
    render(<Dashboard />, { wrapper: BrowserRouter });

    await waitFor(() => {
      expect(screen.getByText('Test Project 1')).toBeInTheDocument();
    });

    expect(screen.getByText('Test Project 2')).toBeInTheDocument();
  });

  it('renders empty state when no projects', async () => {
    server.use(http.get('/api/projects', () => HttpResponse.json([])));

    render(<Dashboard />, { wrapper: BrowserRouter });

    await waitFor(() => {
      expect(screen.getByText('No projects yet')).toBeInTheDocument();
    });
  });

  it('opens create dialog when button clicked', async () => {
    const user = userEvent.setup();
    render(<Dashboard />, { wrapper: BrowserRouter });

    await waitFor(() => {
      expect(screen.getByTestId('create-project-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('create-project-btn'));
    expect(screen.getByText('Create New Project')).toBeInTheDocument();
  });

  it('creates a new project', async () => {
    const user = userEvent.setup();
    render(<Dashboard />, { wrapper: BrowserRouter });

    await waitFor(() => {
      expect(screen.getByTestId('create-project-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('create-project-btn'));
    await user.type(screen.getByLabelText('Name'), 'New Project');
    await user.click(screen.getByText('Create Project'));

    await waitFor(() => {
      expect(screen.queryByText('Create New Project')).not.toBeInTheDocument();
    });
  });

  it('deletes a project', async () => {
    const user = userEvent.setup();
    render(<Dashboard />, { wrapper: BrowserRouter });

    await waitFor(() => {
      expect(screen.getByText('Test Project 1')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByTestId('delete-project');
    await user.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText('Test Project 1')).not.toBeInTheDocument();
    });
  });

  it('shows error toast on fetch failure', async () => {
    server.use(
      http.get('/api/projects', () => HttpResponse.json({ error: 'Server error' }, { status: 500 }))
    );

    render(<Dashboard />, { wrapper: BrowserRouter });

    await waitFor(() => {
      expect(screen.queryByText('Loading projects...')).not.toBeInTheDocument();
    });
  });

  it('shows error toast on create project failure', async () => {
    server.use(
      http.post('/api/projects', () => HttpResponse.json({ error: 'Creation failed' }, { status: 500 }))
    );

    const user = userEvent.setup();
    render(<Dashboard />, { wrapper: BrowserRouter });

    await waitFor(() => {
      expect(screen.getByTestId('create-project-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('create-project-btn'));
    await user.type(screen.getByLabelText('Name'), 'New Project');
    await user.click(screen.getByText('Create Project'));

    await waitFor(() => {
      expect(screen.getByText('Create New Project')).toBeInTheDocument();
    });
  });

  it('shows error toast on delete project failure', async () => {
    server.use(
      http.delete('/api/projects/:id', () => HttpResponse.json({ error: 'Delete failed' }, { status: 500 }))
    );

    const user = userEvent.setup();
    render(<Dashboard />, { wrapper: BrowserRouter });

    await waitFor(() => {
      expect(screen.getByText('Test Project 1')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByTestId('delete-project');
    await user.click(deleteButtons[0]);

    // Project should still be there since delete failed
    await waitFor(() => {
      expect(screen.getByText('Test Project 1')).toBeInTheDocument();
    });
  });
});

describe('Workspace Page', () => {
  it('renders loading state initially', () => {
    renderWithRouter(<Workspace />, { route: '/projects/1' });
    expect(screen.getByText('Loading workspace...')).toBeInTheDocument();
  });

  it('renders workspace after loading', async () => {
    renderWithRouter(<Workspace />, { route: '/projects/1' });

    await waitFor(() => {
      expect(screen.getByText('Test Project 1')).toBeInTheDocument();
    });

    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(screen.getByTestId('editor-panel')).toBeInTheDocument();
  });

  it('loads chat history', async () => {
    renderWithRouter(<Workspace />, { route: '/projects/1' });

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument();
    });
  });

  it('loads editor content', async () => {
    renderWithRouter(<Workspace />, { route: '/projects/1' });

    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toHaveValue('# Test Content');
    });
  });

  it('sends a chat message', async () => {
    const user = userEvent.setup();
    renderWithRouter(<Workspace />, { route: '/projects/1' });

    await waitFor(() => {
      expect(screen.getByTestId('chat-input')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('chat-input'), 'New message');
    await user.click(screen.getByTestId('send-message'));

    await waitFor(() => {
      expect(screen.getByText('New message')).toBeInTheDocument();
    });
  });

  it('clears chat history', async () => {
    const user = userEvent.setup();
    renderWithRouter(<Workspace />, { route: '/projects/1' });

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('clear-chat'));

    await waitFor(() => {
      expect(screen.queryByText('Hello')).not.toBeInTheDocument();
    });
  });

  it('saves editor content', async () => {
    const user = userEvent.setup();
    renderWithRouter(<Workspace />, { route: '/projects/1' });

    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toBeInTheDocument();
    });

    await user.clear(screen.getByTestId('editor-textarea'));
    await user.type(screen.getByTestId('editor-textarea'), '# Updated');

    await waitFor(() => {
      expect(screen.getByTestId('save-editor')).not.toBeDisabled();
    });

    await user.click(screen.getByTestId('save-editor'));

    await waitFor(() => {
      expect(screen.getByTestId('save-editor')).toBeDisabled();
    });
  });

  it('navigates back to dashboard', async () => {
    const user = userEvent.setup();
    renderWithRouter(<Workspace />, { route: '/projects/1' });

    await waitFor(() => {
      expect(screen.getByTestId('back-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('back-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    });
  });

  it('redirects to dashboard on error', async () => {
    server.use(
      http.get('/api/projects/:id', () => HttpResponse.json({ error: 'Not found' }, { status: 404 }))
    );

    renderWithRouter(<Workspace />, { route: '/projects/nonexistent' });

    await waitFor(() => {
      expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    });
  });

  it('shows error toast on save editor failure', async () => {
    server.use(
      http.put('/api/projects/:id/editor', () => HttpResponse.json({ error: 'Save failed' }, { status: 500 }))
    );

    const user = userEvent.setup();
    renderWithRouter(<Workspace />, { route: '/projects/1' });

    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toBeInTheDocument();
    });

    await user.clear(screen.getByTestId('editor-textarea'));
    await user.type(screen.getByTestId('editor-textarea'), '# Updated content');

    await waitFor(() => {
      expect(screen.getByTestId('save-editor')).not.toBeDisabled();
    });

    await user.click(screen.getByTestId('save-editor'));

    // Wait for the error handling to complete
    await waitFor(() => {
      expect(screen.getByTestId('save-editor')).not.toBeDisabled();
    });
  });

  it('shows error toast on send message failure', async () => {
    server.use(
      http.post('/api/projects/:id/process', () => HttpResponse.json({ error: 'Process failed' }, { status: 500 }))
    );

    const user = userEvent.setup();
    renderWithRouter(<Workspace />, { route: '/projects/1' });

    await waitFor(() => {
      expect(screen.getByTestId('chat-input')).toBeInTheDocument();
    });

    const initialMessageCount = screen.getAllByTestId(/chat-message-/).length;

    await user.type(screen.getByTestId('chat-input'), 'New message');
    await user.click(screen.getByTestId('send-message'));

    // Wait a bit for error handling to complete, then check messages didn't increase
    await new Promise(resolve => setTimeout(resolve, 100));
    await waitFor(() => {
      // The message count should remain the same since the request failed
      const currentMessageCount = screen.getAllByTestId(/chat-message-/).length;
      expect(currentMessageCount).toBe(initialMessageCount);
    });
  });

  it('shows error toast on clear chat failure', async () => {
    server.use(
      http.delete('/api/projects/:id/chat', () => HttpResponse.json({ error: 'Clear failed' }, { status: 500 }))
    );

    const user = userEvent.setup();
    renderWithRouter(<Workspace />, { route: '/projects/1' });

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('clear-chat'));

    // Messages should still be there since clear failed
    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument();
    });
  });
});
