import '@testing-library/jest-dom';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

// Mock data
export const mockProjects = [
  {
    id: '1',
    name: 'Test Project 1',
    description: 'A test project',
    githubRepo: null,
    status: 'draft' as const,
    editorContent: '# Test Content',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
  {
    id: '2',
    name: 'Test Project 2',
    description: null,
    githubRepo: 'https://github.com/test/repo',
    status: 'development' as const,
    editorContent: '',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

export const mockMessages = [
  {
    id: 'msg-1',
    projectId: '1',
    role: 'user' as const,
    content: 'Hello',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'msg-2',
    projectId: '1',
    role: 'assistant' as const,
    content: 'Hi there!',
    createdAt: '2024-01-01T00:01:00.000Z',
  },
];

// MSW handlers
export const handlers = [
  http.get('/api/projects', () => HttpResponse.json(mockProjects)),

  http.get('/api/projects/:id', ({ params }) => {
    const project = mockProjects.find((p) => p.id === params.id);
    if (!project) return HttpResponse.json({ error: 'Not found' }, { status: 404 });
    return HttpResponse.json(project);
  }),

  http.post('/api/projects', async ({ request }) => {
    const data = (await request.json()) as { name: string; description?: string };
    const newProject = {
      id: '3',
      name: data.name,
      description: data.description || null,
      githubRepo: null,
      status: 'draft' as const,
      editorContent: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return HttpResponse.json(newProject, { status: 201 });
  }),

  http.patch('/api/projects/:id', async ({ params, request }) => {
    const project = mockProjects.find((p) => p.id === params.id);
    if (!project) return HttpResponse.json({ error: 'Not found' }, { status: 404 });
    const data = await request.json();
    return HttpResponse.json({ ...project, ...data, updatedAt: new Date().toISOString() });
  }),

  http.delete('/api/projects/:id', ({ params }) => {
    const project = mockProjects.find((p) => p.id === params.id);
    if (!project) return HttpResponse.json({ error: 'Not found' }, { status: 404 });
    return new HttpResponse(null, { status: 204 });
  }),

  http.put('/api/projects/:id/editor', async ({ params, request }) => {
    const project = mockProjects.find((p) => p.id === params.id);
    if (!project) return HttpResponse.json({ error: 'Not found' }, { status: 404 });
    const data = (await request.json()) as { content: string };
    return HttpResponse.json({ ...project, editorContent: data.content });
  }),

  http.get('/api/projects/:id/chat', ({ params }) => {
    const messages = mockMessages.filter((m) => m.projectId === params.id);
    return HttpResponse.json(messages);
  }),

  http.post('/api/projects/:id/chat', async ({ params, request }) => {
    const data = (await request.json()) as { role: 'user' | 'assistant'; content: string };
    const newMessage = {
      id: `msg-${Date.now()}`,
      projectId: params.id as string,
      role: data.role,
      content: data.content,
      createdAt: new Date().toISOString(),
    };
    return HttpResponse.json(newMessage, { status: 201 });
  }),

  http.delete('/api/projects/:id/chat', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/projects/:id/process', async ({ params, request }) => {
    const data = (await request.json()) as { content: string };
    const userMessage = {
      id: `msg-user-${Date.now()}`,
      projectId: params.id as string,
      role: 'user' as const,
      content: data.content,
      createdAt: new Date().toISOString(),
    };
    const assistantMessage = {
      id: `msg-asst-${Date.now()}`,
      projectId: params.id as string,
      role: 'assistant' as const,
      content: `Processed: ${data.content}`,
      createdAt: new Date().toISOString(),
    };
    return HttpResponse.json({
      userMessage,
      assistantMessage,
      editorUpdate: {
        content: `# Updated\n\n- ${data.content}`,
        diff: { hasChanges: true, addedLines: 2, removedLines: 0 },
      },
    });
  }),
];

export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
