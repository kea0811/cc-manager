import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validation.js';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  UpdateEditorSchema,
  CreateKanbanTaskSchema,
  UpdateKanbanTaskSchema,
  MoveTaskSchema,
  CreateTaskCommentSchema,
} from '../types/index.js';
import * as projectService from '../services/projectService.js';
import * as chatService from '../services/chatService.js';
import * as kanbanService from '../services/kanbanService.js';
import { MockClaudeService, createClaudeService, ClaudeService, StreamEvent } from '../services/claudeService.js';
import { computeDiff, DiffResult } from '../services/diffService.js';
import { ChildProcess } from 'child_process';

const CLAUDE_CODE_TOKEN = process.env.CLAUDE_CODE_TOKEN || process.env.CLAUDE_CODE_OAUTH_TOKEN || '';

// Check if we should use mock service (testable helper)
export const shouldUseMock = (): boolean =>
  process.env.NODE_ENV !== 'production' || !CLAUDE_CODE_TOKEN;

// Create the default factory (testable helper)
export const createDefaultFactory = (): ((project: { status: string; githubRepo?: string | null }) => ClaudeService) =>
  (project) =>
    shouldUseMock()
      ? new MockClaudeService({ token: '' })
      : createClaudeService({ ralphMode: project.status === 'development', githubRepo: project.githubRepo || undefined });

// Allow overriding the Claude service factory for testing
export let claudeServiceFactory: (project: { status: string; githubRepo?: string | null }) => ClaudeService = createDefaultFactory();

export const setClaudeServiceFactory = (factory: (project: { status: string; githubRepo?: string | null }) => ClaudeService): void => {
  claudeServiceFactory = factory;
};

export const resetClaudeServiceFactory = (): void => {
  claudeServiceFactory = createDefaultFactory();
};

const router = Router();

// GET /api/projects - List all projects
router.get('/', (_req, res) => {
  const projects = projectService.getAllProjects();
  res.json(projects);
});

// POST /api/projects - Create a new project
router.post('/', validateBody(CreateProjectSchema), (req, res) => {
  const project = projectService.createProject(req.body);
  res.status(201).json(project);
});

// GET /api/projects/:id - Get a single project
router.get('/:id', (req, res) => {
  const project = projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(project);
});

// PATCH /api/projects/:id - Update a project
router.patch('/:id', validateBody(UpdateProjectSchema), (req, res) => {
  const project = projectService.updateProject(req.params.id, req.body);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(project);
});

// DELETE /api/projects/:id - Delete a project
router.delete('/:id', (req, res) => {
  const deleted = projectService.deleteProject(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.status(204).send();
});

// PUT /api/projects/:id/editor - Update editor content
router.put('/:id/editor', validateBody(UpdateEditorSchema), (req, res) => {
  const project = projectService.updateEditorContent(req.params.id, req.body.content);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(project);
});

// GET /api/projects/:id/chat - Get chat history
router.get('/:id/chat', (req, res) => {
  const project = projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const messages = chatService.getChatHistory(req.params.id);
  res.json(messages);
});

// POST /api/projects/:id/chat - Add chat message
const ChatMessageBodySchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});

router.post('/:id/chat', validateBody(ChatMessageBodySchema), (req, res) => {
  const project = projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const message = chatService.addChatMessage(req.params.id, req.body);
  res.status(201).json(message);
});

// DELETE /api/projects/:id/chat - Clear chat history
router.delete('/:id/chat', (req, res) => {
  const project = projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  chatService.deleteChatHistory(req.params.id);
  res.status(204).send();
});

// POST /api/projects/:id/process - Process user input with Claude
const ProcessInputSchema = z.object({
  content: z.string().min(1),
});

// Extract markdown content from code blocks in Claude's response
const extractMarkdownFromResponse = (response: string): { explanation: string; markdown: string | null } => {
  // Look for markdown code block (```markdown ... ``` or ``` ... ```)
  const markdownBlockRegex = /```(?:markdown)?\s*\n([\s\S]*?)```/;
  const match = response.match(markdownBlockRegex);

  if (match) {
    const markdown = match[1].trim();
    // Remove the code block from the response to get just the explanation
    const explanation = response.replace(markdownBlockRegex, '').trim();
    return { explanation, markdown };
  }

  // No code block found - return full response as explanation, no markdown update
  return { explanation: response, markdown: null };
};

router.post('/:id/process', validateBody(ProcessInputSchema), async (req, res) => {
  const project = projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  // Store the user message
  const userMessage = chatService.addChatMessage(req.params.id, {
    role: 'user',
    content: req.body.content,
  });

  // Create Claude service using the factory (allows dependency injection for testing)
  const claudeService = claudeServiceFactory(project);

  // Process with Claude
  const response = await claudeService.processRequirement(
    req.body.content,
    project.editorContent
  );

  if (!response.success) {
    const errorMessage = chatService.addChatMessage(req.params.id, {
      role: 'assistant',
      content: `Error: ${response.error}`,
    });
    res.json({
      userMessage,
      assistantMessage: errorMessage,
      editorUpdate: null,
    });
    return;
  }

  // Parse Claude's response: explanation goes to chat, markdown goes to editor
  const { explanation, markdown } = extractMarkdownFromResponse(response.content || '');

  // Only update editor if we found markdown content
  let updatedProject = project;
  let diff: DiffResult = { hasChanges: false, addedLines: 0, removedLines: 0, changes: [] };

  if (markdown) {
    diff = computeDiff(project.editorContent, markdown);
    if (diff.hasChanges) {
      updatedProject = projectService.updateEditorContent(req.params.id, markdown) || project;
    }
  }

  // Store assistant response with full explanation (thoughts + suggestions)
  const assistantMessage = chatService.addChatMessage(req.params.id, {
    role: 'assistant',
    content: explanation || (diff.hasChanges
      ? `Updated the document (+${diff.addedLines} lines, -${diff.removedLines} lines)`
      : 'No changes needed to the document.'),
  });

  res.json({
    userMessage,
    assistantMessage,
    editorUpdate: diff.hasChanges
      ? { content: updatedProject.editorContent, diff }
      : null,
  });
});

// Store active streaming processes for cleanup
const activeStreams = new Map<string, { abort: () => void; process: ChildProcess }>();

// GET /api/projects/:id/stream - SSE endpoint for streaming Claude responses
router.get('/:id/stream', (req, res) => {
  const project = projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const content = req.query.content as string;
  if (!content) {
    res.status(400).json({ error: 'Missing content query parameter' });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Create unique stream ID
  const streamId = `${req.params.id}-${Date.now()}`;

  // Store user message immediately
  const userMessage = chatService.addChatMessage(req.params.id, {
    role: 'user',
    content,
  });

  // Send user message event
  res.write(`data: ${JSON.stringify({ type: 'user_message', message: userMessage })}\n\n`);

  const claudeService = claudeServiceFactory(project);

  // Track accumulated content for final processing
  let fullContent = '';
  let currentToolName: string | null = null;

  const stream = claudeService.streamProcessRequirement(
    content,
    project.editorContent,
    {
      onEvent: (event: StreamEvent) => {
        // Forward event to client
        res.write(`data: ${JSON.stringify(event)}\n\n`);

        // Track content and tool usage
        if (event.type === 'assistant' && event.message?.content) {
          fullContent += event.message.content;
        }
        if (event.type === 'tool_use' && event.tool_name) {
          currentToolName = event.tool_name;
        }
      },
      onError: (error: Error) => {
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);

        // Save error as assistant message
        const errorMessage = chatService.addChatMessage(req.params.id, {
          role: 'assistant',
          content: `Error: ${error.message}`,
        });
        res.write(`data: ${JSON.stringify({ type: 'assistant_message', message: errorMessage })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
        activeStreams.delete(streamId);
      },
      onComplete: (completeContent: string) => {
        // Parse response for markdown extraction
        const { explanation, markdown } = extractMarkdownFromResponse(completeContent);

        // Update editor if markdown found
        let editorUpdate = null;
        if (markdown) {
          const diff = computeDiff(project.editorContent, markdown);
          if (diff.hasChanges) {
            const updatedProject = projectService.updateEditorContent(req.params.id, markdown);
            editorUpdate = {
              content: updatedProject?.editorContent || markdown,
              diff,
            };
          }
        }

        // Save assistant message
        const assistantMessage = chatService.addChatMessage(req.params.id, {
          role: 'assistant',
          content: explanation || 'Response completed.',
        });

        // Send final events
        res.write(`data: ${JSON.stringify({ type: 'assistant_message', message: assistantMessage })}\n\n`);
        if (editorUpdate) {
          res.write(`data: ${JSON.stringify({ type: 'editor_update', ...editorUpdate })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
        activeStreams.delete(streamId);
      },
    }
  );

  activeStreams.set(streamId, stream);

  // Handle client disconnect
  req.on('close', () => {
    const activeStream = activeStreams.get(streamId);
    if (activeStream) {
      activeStream.abort();
      activeStreams.delete(streamId);
    }
  });
});

// POST /api/projects/:id/stream/abort - Abort active stream
router.post('/:id/stream/abort', (req, res) => {
  const projectId = req.params.id;

  // Find and abort any active streams for this project
  for (const [streamId, stream] of activeStreams.entries()) {
    if (streamId.startsWith(projectId)) {
      stream.abort();
      activeStreams.delete(streamId);
    }
  }

  res.json({ success: true });
});

// ============ Development Streaming ============

// Store active development streams for cleanup
const activeDevelopmentStreams = new Map<string, { abort: () => void }>();

// Development phases
type DevPhase = 'setup' | 'development' | 'code_review' | 'unit_tests' | 'e2e_tests' | 'deploy' | 'complete';

// GET /api/projects/:id/develop-stream - SSE endpoint for streaming development
router.get('/:id/develop-stream', async (req, res) => {
  const project = projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!project.githubRepo) {
    res.status(400).json({ error: 'GitHub repo not configured' });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const projectId = req.params.id;
  const streamId = `dev-${projectId}-${Date.now()}`;
  let isAborted = false;
  let currentContainerName: string | null = null;

  // Helper to send SSE events
  const sendEvent = (type: string, data: unknown) => {
    if (!isAborted) {
      const eventData = typeof data === 'object' && data !== null ? data : { value: data };
      res.write(`data: ${JSON.stringify({ type, ...eventData as Record<string, unknown> })}\n\n`);
    }
  };

  // Abort handler
  const abort = async () => {
    isAborted = true;
    if (currentContainerName) {
      const claudeService = claudeServiceFactory(project);
      await claudeService.killContainerByName(currentContainerName);
    }
  };

  activeDevelopmentStreams.set(streamId, { abort });

  // Handle client disconnect
  req.on('close', () => {
    abort();
    activeDevelopmentStreams.delete(streamId);
  });

  const claudeService = claudeServiceFactory(project);

  try {
    // Send initial state
    sendEvent('init', { projectId, projectName: project.name });

    // Get all tasks
    let tasks = kanbanService.getTasksByProject(projectId);
    const todoTasks = tasks.filter(t => t.status === 'todo');

    sendEvent('tasks', {
      total: todoTasks.length,
      tasks: todoTasks.map(t => ({ id: t.id, title: t.title }))
    });

    // Phase 1: Develop all todo tasks
    sendEvent('phase', { phase: 'development' as DevPhase, message: 'Starting development phase' });

    for (let i = 0; i < todoTasks.length && !isAborted; i++) {
      const task = todoTasks[i];
      currentContainerName = `claude-dev-${Date.now()}`;

      // Move to WIP
      kanbanService.moveTask(task.id, 'wip', 0);
      sendEvent('task_start', {
        taskId: task.id,
        taskTitle: task.title,
        taskIndex: i + 1,
        totalTasks: todoTasks.length
      });

      const prompt = `You are developing a feature for a project.

TASK: ${task.title}
DESCRIPTION: ${task.description || ''}

PROJECT REQUIREMENTS (for context):
${project.editorContent}

Implement this task. Write the necessary code, create files, and make the changes needed.
Focus only on this specific task. Be thorough but concise.
After implementing, stage and commit your changes with message: "feat: ${task.title}"`;

      const result = await claudeService.streamDockerDevelop(
        prompt,
        currentContainerName,
        {
          onSetup: (phase) => sendEvent('setup', { message: phase }),
          onEvent: (event) => sendEvent('claude', event),
          onCommit: (commitUrl) => {
            kanbanService.updateTaskCommitUrl(task.id, commitUrl);
            sendEvent('commit', { taskId: task.id, commitUrl });
          },
          onError: (error) => sendEvent('error', { message: error.message }),
          onComplete: () => sendEvent('task_claude_complete', { taskId: task.id }),
        }
      );

      // Cleanup container
      await claudeService.killContainerByName(currentContainerName);
      currentContainerName = null;

      if (result.success) {
        kanbanService.moveTask(task.id, 'done', 0);
        sendEvent('task_complete', { taskId: task.id, status: 'done', commitUrl: result.commitUrl });
      } else {
        sendEvent('task_failed', { taskId: task.id, message: 'Development failed' });
        // Leave in WIP for review
      }
    }

    if (isAborted) {
      sendEvent('aborted', { message: 'Development aborted by user' });
      res.end();
      return;
    }

    // Phase 2: Code Review - move all done tasks to code_review
    sendEvent('phase', { phase: 'code_review' as DevPhase, message: 'Moving to code review' });
    tasks = kanbanService.getTasksByProject(projectId);
    const doneTasks = tasks.filter(t => t.status === 'done');
    for (const task of doneTasks) {
      kanbanService.moveTask(task.id, 'code_review', 0);
      sendEvent('task_moved', { taskId: task.id, status: 'code_review' });
    }

    // Phase 3: Unit Tests
    sendEvent('phase', { phase: 'unit_tests' as DevPhase, message: 'Running unit tests' });
    currentContainerName = `claude-test-${Date.now()}`;

    const testPrompt = `Clone ${project.githubRepo} and run unit tests.
Look for test scripts in package.json (npm test, npm run test, etc.).
If no tests exist, set up vitest or jest with a basic test.
Report test results - pass/fail count and any errors.
Commit any test setup changes.`;

    const testResult = await claudeService.streamDockerDevelop(
      testPrompt,
      currentContainerName,
      {
        onSetup: (phase) => sendEvent('setup', { message: phase }),
        onEvent: (event) => sendEvent('claude', event),
        onError: (error) => sendEvent('error', { message: error.message }),
        onComplete: () => sendEvent('test_complete', { type: 'unit' }),
      }
    );

    await claudeService.killContainerByName(currentContainerName);
    currentContainerName = null;

    if (testResult.success && !isAborted) {
      tasks = kanbanService.getTasksByProject(projectId);
      for (const task of tasks.filter(t => t.status === 'code_review')) {
        kanbanService.moveTask(task.id, 'done_unit_test', 0);
        sendEvent('task_moved', { taskId: task.id, status: 'done_unit_test' });
      }
    }

    if (isAborted) {
      sendEvent('aborted', { message: 'Development aborted by user' });
      res.end();
      return;
    }

    // Phase 4: E2E Tests
    sendEvent('phase', { phase: 'e2e_tests' as DevPhase, message: 'Running E2E tests' });
    currentContainerName = `claude-e2e-${Date.now()}`;

    const e2ePrompt = `Clone ${project.githubRepo} and run E2E tests.
If no E2E tests exist, set up playwright with a basic test.
Create docker-compose.test.yml if needed.
Run E2E tests and report results.
Commit any test setup changes.`;

    const e2eResult = await claudeService.streamDockerDevelop(
      e2ePrompt,
      currentContainerName,
      {
        onSetup: (phase) => sendEvent('setup', { message: phase }),
        onEvent: (event) => sendEvent('claude', event),
        onError: (error) => sendEvent('error', { message: error.message }),
        onComplete: () => sendEvent('test_complete', { type: 'e2e' }),
      }
    );

    await claudeService.killContainerByName(currentContainerName);
    currentContainerName = null;

    if (e2eResult.success && !isAborted) {
      tasks = kanbanService.getTasksByProject(projectId);
      for (const task of tasks.filter(t => t.status === 'done_unit_test')) {
        kanbanService.moveTask(task.id, 'done_e2e_testing', 0);
        sendEvent('task_moved', { taskId: task.id, status: 'done_e2e_testing' });
      }
    }

    if (isAborted) {
      sendEvent('aborted', { message: 'Development aborted by user' });
      res.end();
      return;
    }

    // Phase 5: Deploy
    const projectName = project.name.toLowerCase().replace(/\s+/g, '-');
    const targetPath = '/volume1/docker/claude-project';
    sendEvent('phase', { phase: 'deploy' as DevPhase, message: `Deploying to ${targetPath}/${projectName}` });
    currentContainerName = `claude-deploy-${Date.now()}`;

    const deployPrompt = `Clone ${project.githubRepo} and deploy to ${targetPath}/${projectName}

Steps:
1. Build the project (npm run build, etc.)
2. Copy files to ${targetPath}/${projectName}
3. If docker-compose.yml exists, run: cd ${targetPath}/${projectName} && docker compose up -d --build

Report what you did.`;

    const deployResult = await claudeService.streamDockerDevelop(
      deployPrompt,
      currentContainerName,
      {
        onSetup: (phase) => sendEvent('setup', { message: phase }),
        onEvent: (event) => sendEvent('claude', event),
        onError: (error) => sendEvent('error', { message: error.message }),
        onComplete: () => sendEvent('deploy_complete', {}),
      }
    );

    await claudeService.killContainerByName(currentContainerName);
    currentContainerName = null;

    if (deployResult.success && !isAborted) {
      tasks = kanbanService.getTasksByProject(projectId);
      for (const task of tasks.filter(t => t.status === 'done_e2e_testing')) {
        kanbanService.moveTask(task.id, 'deploy', 0);
        sendEvent('task_moved', { taskId: task.id, status: 'deploy' });
      }

      // Update project status
      projectService.updateProject(projectId, {
        status: 'deployed',
        deployedUrl: `${targetPath}/${projectName}`,
      });
    }

    // Complete
    sendEvent('phase', { phase: 'complete' as DevPhase, message: 'Development pipeline complete!' });
    sendEvent('done', { success: true });

  } catch (err) {
    sendEvent('error', { message: err instanceof Error ? err.message : 'Unknown error' });
    sendEvent('done', { success: false });
  } finally {
    activeDevelopmentStreams.delete(streamId);
    res.end();
  }
});

// POST /api/projects/:id/develop-stream/abort - Abort development stream
router.post('/:id/develop-stream/abort', async (req, res) => {
  const projectId = req.params.id;

  for (const [streamId, stream] of activeDevelopmentStreams.entries()) {
    if (streamId.includes(projectId)) {
      await stream.abort();
      activeDevelopmentStreams.delete(streamId);
    }
  }

  res.json({ success: true });
});

// GET /api/projects/:id/diff - Get diff between two content versions
const DiffQuerySchema = z.object({
  oldContent: z.string(),
  newContent: z.string(),
});

router.post('/:id/diff', validateBody(DiffQuerySchema), (req, res) => {
  const project = projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const diff = computeDiff(req.body.oldContent, req.body.newContent);
  res.json(diff);
});

// ============ Development Routes ============

// POST /api/projects/:id/start-develop - Analyze PRD and create tasks
router.post('/:id/start-develop', async (req, res) => {
  const project = projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!project.editorContent.trim()) {
    res.status(400).json({ error: 'PRD is empty. Please add requirements first.' });
    return;
  }

  const claudeService = claudeServiceFactory(project);

  try {
    const response = await claudeService.analyzePRD(project.editorContent);

    if (!response.success) {
      res.status(500).json({ error: response.error || 'Failed to analyze PRD' });
      return;
    }

    // Parse the JSON response - handle potential markdown code blocks
    let tasksJson = response.content || '[]';

    // Remove markdown code block if present
    const jsonMatch = tasksJson.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      tasksJson = jsonMatch[1].trim();
    }

    // Try to find JSON array in the response
    const arrayMatch = tasksJson.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      tasksJson = arrayMatch[0];
    }

    let tasks: { title: string; description?: string }[];
    try {
      tasks = JSON.parse(tasksJson);
    } catch {
      res.status(500).json({ error: 'Failed to parse tasks from Claude response', raw: response.content });
      return;
    }

    // Create kanban tasks
    const createdTasks = tasks.map((task) =>
      kanbanService.createTask(req.params.id, {
        title: task.title,
        description: task.description,
        status: 'todo',
      })
    );

    // Update project status to development if it has a repo
    if (project.githubRepo && project.status === 'draft') {
      projectService.updateProject(req.params.id, { status: 'development' });
    }

    res.json({ success: true, tasks: createdTasks });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/develop-next - Develop the next task in WIP or move one from Todo
router.post('/:id/develop-next', async (req, res) => {
  const project = projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!project.githubRepo) {
    res.status(400).json({ error: 'Please link a GitHub repository first' });
    return;
  }

  const allTasks = kanbanService.getTasksByProject(req.params.id);

  // Find task to work on: first check WIP, then get first from Todo
  let task = allTasks.find((t) => t.status === 'wip');

  if (!task) {
    const todoTask = allTasks.find((t) => t.status === 'todo');
    if (!todoTask) {
      res.json({ success: true, message: 'No tasks to develop', complete: true });
      return;
    }
    // Move to WIP
    task = kanbanService.moveTask(todoTask.id, 'wip', 0)!;
  }

  const claudeService = claudeServiceFactory(project);

  try {
    const response = await claudeService.developTask(
      task.title,
      task.description || '',
      project.editorContent
    );

    if (!response.success) {
      res.status(500).json({ error: response.error || 'Development failed', task });
      return;
    }

    // Move task to done after successful development
    const updatedTask = kanbanService.moveTask(task.id, 'done', 0);

    res.json({
      success: true,
      task: updatedTask,
      output: response.content,
      complete: false,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error', task });
  }
});

// POST /api/projects/:id/develop-all - Develop all tasks sequentially (background job)
router.post('/:id/develop-all', async (req, res) => {
  const project = projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!project.githubRepo) {
    res.status(400).json({ error: 'Please link a GitHub repository first' });
    return;
  }

  // Return immediately, development happens in background
  res.json({ success: true, message: 'Development started' });

  // Process tasks in background with Docker-based development
  const processTasks = async (): Promise<void> => {
    const claudeService = claudeServiceFactory(project);
    const projectId = req.params.id;

    // Phase 1: Develop all tasks in Docker (Todo -> WIP -> Done)
    while (true) {
      const allTasks = kanbanService.getTasksByProject(projectId);
      const todoTask = allTasks.find((t) => t.status === 'todo');

      if (!todoTask) break;

      // Move to WIP
      const wipTask = kanbanService.moveTask(todoTask.id, 'wip', 0)!;

      try {
        // Build prompt for this task
        const prompt = `You are developing a feature for a project.

TASK: ${wipTask.title}
DESCRIPTION: ${wipTask.description || ''}

PROJECT REQUIREMENTS (for context):
${project.editorContent}

Implement this task. Write the necessary code, create files, and make the changes needed.
Focus only on this specific task. Be thorough but concise.
After implementing, stage and commit your changes with message: "feat: ${wipTask.title}"`;

        // Spawn Docker container, clone repo, and develop
        const response = await claudeService.spawnDockerAndDevelop(prompt);

        // Kill the container after task is done
        await claudeService.killContainer();

        if (!response.success) {
          console.error('Development failed:', response.error);
          return; // Leave task in WIP
        }

        // Store commit URL if available
        if (response.commitUrl) {
          kanbanService.updateTaskCommitUrl(wipTask.id, response.commitUrl);
        }

        // Move to done
        kanbanService.moveTask(wipTask.id, 'done', 0);
      } catch (err) {
        // On error, kill container and leave in WIP for manual review
        await claudeService.killContainer();
        console.error('Task development error:', err);
        return;
      }
    }

    // Phase 2: Code Review - move all done tasks to code_review
    console.log('[CC-Manager] Phase 2: Moving tasks to code_review');
    let tasks = kanbanService.getTasksByProject(projectId);
    const doneTasks = tasks.filter((t) => t.status === 'done');
    for (const task of doneTasks) {
      kanbanService.moveTask(task.id, 'code_review', 0);
    }
    console.log(`[CC-Manager] Moved ${doneTasks.length} tasks to code_review`);

    // Phase 3: Unit Tests in Docker
    console.log('[CC-Manager] Phase 3: Running unit tests');
    try {
      const testPrompt = `Clone ${project.githubRepo} and run unit tests.
Look for test scripts in package.json (npm test, npm run test, etc.).
If no tests exist, set up vitest or jest with a basic test.
Report test results - pass/fail count and any errors.
Commit any test setup changes.`;

      const testResponse = await claudeService.spawnDockerAndDevelop(testPrompt);
      await claudeService.killContainer();
      console.log('[CC-Manager] Unit tests result:', testResponse.success ? 'PASSED' : 'FAILED');

      if (testResponse.success) {
        tasks = kanbanService.getTasksByProject(projectId);
        for (const task of tasks.filter((t) => t.status === 'code_review')) {
          kanbanService.moveTask(task.id, 'done_unit_test', 0);
        }
      } else {
        console.error('[CC-Manager] Unit tests failed:', testResponse.error);
      }
    } catch (err) {
      await claudeService.killContainer();
      console.error('[CC-Manager] Unit tests error:', err);
      return;
    }

    // Phase 4: E2E Tests in Docker
    console.log('[CC-Manager] Phase 4: Running E2E tests');
    try {
      const e2ePrompt = `Clone ${project.githubRepo} and run E2E tests.
If no E2E tests exist, set up playwright with a basic test.
Create docker-compose.test.yml if needed.
Run E2E tests and report results.
Commit any test setup changes.`;

      const e2eResponse = await claudeService.spawnDockerAndDevelop(e2ePrompt);
      await claudeService.killContainer();
      console.log('[CC-Manager] E2E tests result:', e2eResponse.success ? 'PASSED' : 'FAILED');

      if (e2eResponse.success) {
        tasks = kanbanService.getTasksByProject(projectId);
        for (const task of tasks.filter((t) => t.status === 'done_unit_test')) {
          kanbanService.moveTask(task.id, 'done_e2e_testing', 0);
        }
      } else {
        console.error('[CC-Manager] E2E tests failed:', e2eResponse.error);
      }
    } catch (err) {
      await claudeService.killContainer();
      console.error('[CC-Manager] E2E tests error:', err);
      return;
    }

    // Phase 5: Deploy to NAS
    const projectName = project.name.toLowerCase().replace(/\s+/g, '-');
    console.log(`[CC-Manager] Phase 5: Deploying to /volume1/docker/claude-project/${projectName}`);
    try {
      const deployPrompt = `Clone ${project.githubRepo} and deploy to /volume1/docker/claude-project/${projectName}

Steps:
1. Build the project (npm run build, etc.)
2. Copy files to /volume1/docker/claude-project/${projectName}
3. If docker-compose.yml exists, run: cd /volume1/docker/claude-project/${projectName} && docker compose up -d --build

Report what you did.`;

      const deployResponse = await claudeService.spawnDockerAndDevelop(deployPrompt);
      await claudeService.killContainer();
      console.log('[CC-Manager] Deploy result:', deployResponse.success ? 'SUCCESS' : 'FAILED');

      if (deployResponse.success) {
        tasks = kanbanService.getTasksByProject(projectId);
        for (const task of tasks.filter((t) => t.status === 'done_e2e_testing')) {
          kanbanService.moveTask(task.id, 'deploy', 0);
        }
        console.log('[CC-Manager] All tasks deployed successfully!');
      } else {
        console.error('[CC-Manager] Deploy failed:', deployResponse.error);
      }
    } catch (err) {
      await claudeService.killContainer();
      console.error('[CC-Manager] Deploy error:', err);
    }
  };

  processTasks().catch(console.error);
});

// POST /api/projects/:id/continue - Continue workflow from current state
router.post('/:id/continue', async (req, res) => {
  const project = projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!project.githubRepo) {
    res.status(400).json({ error: 'Please link a GitHub repository first' });
    return;
  }

  const tasks = kanbanService.getTasksByProject(req.params.id);
  const statusCounts = {
    todo: tasks.filter(t => t.status === 'todo').length,
    wip: tasks.filter(t => t.status === 'wip').length,
    done: tasks.filter(t => t.status === 'done').length,
    code_review: tasks.filter(t => t.status === 'code_review').length,
    done_unit_test: tasks.filter(t => t.status === 'done_unit_test').length,
    done_e2e_testing: tasks.filter(t => t.status === 'done_e2e_testing').length,
    deploy: tasks.filter(t => t.status === 'deploy').length,
  };

  // Determine next phase based on current state
  let nextPhase = 'unknown';
  if (statusCounts.todo > 0 || statusCounts.wip > 0) {
    nextPhase = 'development';
  } else if (statusCounts.done > 0) {
    nextPhase = 'code_review';
  } else if (statusCounts.code_review > 0) {
    nextPhase = 'unit_tests';
  } else if (statusCounts.done_unit_test > 0) {
    nextPhase = 'e2e_tests';
  } else if (statusCounts.done_e2e_testing > 0) {
    nextPhase = 'deploy';
  } else if (statusCounts.deploy > 0) {
    nextPhase = 'complete';
  }

  res.json({
    success: true,
    message: `Continuing from ${nextPhase}`,
    statusCounts,
    nextPhase
  });

  // Run the appropriate phase in background
  const claudeService = claudeServiceFactory(project);
  const projectId = req.params.id;

  const continueWorkflow = async () => {
    if (nextPhase === 'code_review') {
      // Move done -> code_review and run tests
      for (const task of tasks.filter(t => t.status === 'done')) {
        kanbanService.moveTask(task.id, 'code_review', 0);
      }
      nextPhase = 'unit_tests';
    }

    if (nextPhase === 'unit_tests') {
      console.log('[CC-Manager] Running unit tests...');
      const testResponse = await claudeService.spawnDockerAndDevelop(
        `Clone ${project.githubRepo} and run unit tests. Set up vitest if no tests exist.`
      );
      await claudeService.killContainer();

      if (testResponse.success) {
        const currentTasks = kanbanService.getTasksByProject(projectId);
        for (const task of currentTasks.filter(t => t.status === 'code_review')) {
          kanbanService.moveTask(task.id, 'done_unit_test', 0);
        }
        nextPhase = 'e2e_tests';
      } else {
        console.error('[CC-Manager] Unit tests failed');
        return;
      }
    }

    if (nextPhase === 'e2e_tests') {
      console.log('[CC-Manager] Running E2E tests...');
      const e2eResponse = await claudeService.spawnDockerAndDevelop(
        `Clone ${project.githubRepo} and run E2E tests. Set up playwright if no tests exist.`
      );
      await claudeService.killContainer();

      if (e2eResponse.success) {
        const currentTasks = kanbanService.getTasksByProject(projectId);
        for (const task of currentTasks.filter(t => t.status === 'done_unit_test')) {
          kanbanService.moveTask(task.id, 'done_e2e_testing', 0);
        }
        nextPhase = 'deploy';
      } else {
        console.error('[CC-Manager] E2E tests failed');
        return;
      }
    }

    if (nextPhase === 'deploy') {
      const projectName = project.name.toLowerCase().replace(/\s+/g, '-');
      console.log(`[CC-Manager] Deploying to ${projectName}...`);
      const deployResponse = await claudeService.spawnDockerAndDevelop(
        `Clone ${project.githubRepo} and deploy to /volume1/docker/claude-project/${projectName}. Build and run docker compose if available.`
      );
      await claudeService.killContainer();

      if (deployResponse.success) {
        const currentTasks = kanbanService.getTasksByProject(projectId);
        for (const task of currentTasks.filter(t => t.status === 'done_e2e_testing')) {
          kanbanService.moveTask(task.id, 'deploy', 0);
        }
        console.log('[CC-Manager] Deployment complete!');
      }
    }
  };

  continueWorkflow().catch(console.error);
});

// POST /api/projects/:id/deploy - Deploy project to NAS
router.post('/:id/deploy', async (req, res) => {
  const project = projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const claudeService = claudeServiceFactory(project);
  const projectName = project.name.toLowerCase().replace(/\s+/g, '-');
  const targetPath = '/volume1/docker/claude-project';

  try {
    const response = await claudeService.deployToNas(projectName, targetPath);

    if (!response.success) {
      res.status(500).json({ error: response.error || 'Deployment failed' });
      return;
    }

    // Move all tasks to deploy status
    const allTasks = kanbanService.getTasksByProject(req.params.id);
    for (const task of allTasks) {
      if (task.status !== 'deploy') {
        kanbanService.moveTask(task.id, 'deploy', 0);
      }
    }

    // Update project status to deployed and set the deployed URL
    // The deployed URL is typically the project running on a specific port
    const deployedUrl = `http://192.168.1.100:${3010 + Math.floor(Math.random() * 90)}`; // Placeholder - real URL would come from docker compose
    projectService.updateProject(req.params.id, {
      status: 'deployed',
      deployedUrl: `${targetPath}/${projectName}`,
    });

    res.json({ success: true, output: response.content, path: `${targetPath}/${projectName}` });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ============ Kanban Routes ============

// GET /api/projects/:id/kanban - Get all tasks for a project
router.get('/:id/kanban', (req, res) => {
  const project = projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const tasks = kanbanService.getTasksByProject(req.params.id);
  res.json(tasks);
});

// POST /api/projects/:id/kanban - Create a new task
router.post('/:id/kanban', validateBody(CreateKanbanTaskSchema), (req, res) => {
  const project = projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const task = kanbanService.createTask(req.params.id, req.body);
  res.status(201).json(task);
});

// GET /api/projects/:id/kanban/:taskId - Get a single task
router.get('/:id/kanban/:taskId', (req, res) => {
  const task = kanbanService.getTaskById(req.params.taskId);
  if (!task || task.projectId !== req.params.id) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(task);
});

// PATCH /api/projects/:id/kanban/:taskId - Update a task
router.patch('/:id/kanban/:taskId', validateBody(UpdateKanbanTaskSchema), (req, res) => {
  const task = kanbanService.getTaskById(req.params.taskId);
  if (!task || task.projectId !== req.params.id) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const updated = kanbanService.updateTask(req.params.taskId, req.body);
  res.json(updated);
});

// PUT /api/projects/:id/kanban/:taskId/move - Move task to different column/position
router.put('/:id/kanban/:taskId/move', validateBody(MoveTaskSchema), (req, res) => {
  const task = kanbanService.getTaskById(req.params.taskId);
  if (!task || task.projectId !== req.params.id) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const moved = kanbanService.moveTask(req.params.taskId, req.body.status, req.body.position);
  res.json(moved);
});

// DELETE /api/projects/:id/kanban/:taskId - Delete a task
router.delete('/:id/kanban/:taskId', (req, res) => {
  const task = kanbanService.getTaskById(req.params.taskId);
  if (!task || task.projectId !== req.params.id) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  kanbanService.deleteTask(req.params.taskId);
  res.status(204).send();
});

// ============ Task Comment Routes ============

// GET /api/projects/:id/kanban/:taskId/comments - Get all comments for a task
router.get('/:id/kanban/:taskId/comments', (req, res) => {
  const task = kanbanService.getTaskById(req.params.taskId);
  if (!task || task.projectId !== req.params.id) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const comments = kanbanService.getCommentsByTask(req.params.taskId);
  res.json(comments);
});

// POST /api/projects/:id/kanban/:taskId/comments - Add a comment to a task
router.post('/:id/kanban/:taskId/comments', validateBody(CreateTaskCommentSchema), (req, res) => {
  const task = kanbanService.getTaskById(req.params.taskId);
  if (!task || task.projectId !== req.params.id) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const comment = kanbanService.createComment(req.params.taskId, req.body);
  res.status(201).json(comment);
});

// DELETE /api/projects/:id/kanban/:taskId/comments/:commentId - Delete a comment
router.delete('/:id/kanban/:taskId/comments/:commentId', (req, res) => {
  const task = kanbanService.getTaskById(req.params.taskId);
  if (!task || task.projectId !== req.params.id) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const deleted = kanbanService.deleteComment(req.params.commentId);
  if (!deleted) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }
  res.status(204).send();
});

export default router;
