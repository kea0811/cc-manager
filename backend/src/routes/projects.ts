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
import { dependencyService } from '../services/dependencyService.js';
import { MockClaudeService, createClaudeService, ClaudeService, StreamEvent, CodeReviewResult } from '../services/claudeService.js';
import { computeDiff, DiffResult } from '../services/diffService.js';
import { parallelExecutionService } from '../services/parallelExecutionService.js';
import { ChildProcess } from 'child_process';
import type { DevPhase } from '../types/index.js';

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
router.get('/', async (_req, res) => {
  const projects = await projectService.getAllProjects();
  res.json(projects);
});

// POST /api/projects - Create a new project
router.post('/', validateBody(CreateProjectSchema), async (req, res) => {
  const project = await projectService.createProject(req.body);
  res.status(201).json(project);
});

// GET /api/projects/:id - Get a single project
router.get('/:id', async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(project);
});

// PATCH /api/projects/:id - Update a project
router.patch('/:id', validateBody(UpdateProjectSchema), async (req, res) => {
  const project = await projectService.updateProject(req.params.id, req.body);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(project);
});

// DELETE /api/projects/:id - Delete a project
router.delete('/:id', async (req, res) => {
  const deleted = await projectService.deleteProject(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.status(204).send();
});

// PUT /api/projects/:id/editor - Update editor content
router.put('/:id/editor', validateBody(UpdateEditorSchema), async (req, res) => {
  const project = await projectService.updateEditorContent(req.params.id, req.body.content);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(project);
});

// GET /api/projects/:id/chat - Get chat history
router.get('/:id/chat', async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const messages = await chatService.getChatHistory(req.params.id);
  res.json(messages);
});

// POST /api/projects/:id/chat - Add chat message
const ChatMessageBodySchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});

router.post('/:id/chat', validateBody(ChatMessageBodySchema), async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const message = await chatService.addChatMessage(req.params.id, req.body);
  res.status(201).json(message);
});

// DELETE /api/projects/:id/chat - Clear chat history
router.delete('/:id/chat', async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  await chatService.deleteChatHistory(req.params.id);
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
  const project = await projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  // Store the user message
  const userMessage = await chatService.addChatMessage(req.params.id, {
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
    const errorMessage = await chatService.addChatMessage(req.params.id, {
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
      updatedProject = await projectService.updateEditorContent(req.params.id, markdown) || project;
    }
  }

  // Store assistant response with full explanation (thoughts + suggestions)
  const assistantMessage = await chatService.addChatMessage(req.params.id, {
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
router.get('/:id/stream', async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
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
  const userMessage = await chatService.addChatMessage(req.params.id, {
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
          // Content can be a string or an array of content blocks
          const messageContent = event.message.content as unknown;
          if (typeof messageContent === 'string') {
            fullContent += messageContent;
          } else if (Array.isArray(messageContent)) {
            // Extract text from content blocks
            for (const block of messageContent) {
              if (block && typeof block === 'object' && 'text' in block) {
                fullContent += (block as { text: string }).text;
              }
            }
          }
        }
        if (event.type === 'tool_use' && event.tool_name) {
          currentToolName = event.tool_name;
        }
      },
      onError: async (error: Error) => {
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);

        // Save error as assistant message
        const errorMessage = await chatService.addChatMessage(req.params.id, {
          role: 'assistant',
          content: `Error: ${error.message}`,
        });
        res.write(`data: ${JSON.stringify({ type: 'assistant_message', message: errorMessage })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
        activeStreams.delete(streamId);
      },
      onComplete: async (completeContent: string) => {
        // Parse response for markdown extraction
        const { explanation, markdown } = extractMarkdownFromResponse(completeContent);

        // Update editor if markdown found
        let editorUpdate = null;
        let newTasksCreated: { title: string }[] = [];
        if (markdown) {
          const diff = computeDiff(project.editorContent, markdown);
          if (diff.hasChanges) {
            const updatedProject = await projectService.updateEditorContent(req.params.id, markdown);
            editorUpdate = {
              content: updatedProject?.editorContent || markdown,
              diff,
            };

            // Auto-create tasks for development/deployed projects with GitHub repo
            if (project.githubRepo && (project.status === 'development' || project.status === 'deployed')) {
              try {
                // Get existing tasks
                const existingTasks = await kanbanService.getTasksByProject(req.params.id);
                const existingTitles = new Set(existingTasks.map(t => t.title.toLowerCase()));

                // Parse PRD for tasks
                const taskClaudeService = claudeServiceFactory(project);
                const taskResponse = await taskClaudeService.analyzePRD(markdown);

                if (taskResponse.success && taskResponse.content) {
                  let tasksJson = taskResponse.content;
                  const jsonMatch = tasksJson.match(/```(?:json)?\s*([\s\S]*?)```/);
                  if (jsonMatch) tasksJson = jsonMatch[1].trim();
                  const arrayMatch = tasksJson.match(/\[[\s\S]*\]/);
                  if (arrayMatch) tasksJson = arrayMatch[0];

                  const parsedTasks: { title: string; description?: string }[] = JSON.parse(tasksJson);
                  const newTasks = parsedTasks.filter(t => !existingTitles.has(t.title.toLowerCase()));

                  // Create new tasks
                  for (const task of newTasks) {
                    await kanbanService.createTask(req.params.id, {
                      title: task.title,
                      description: task.description,
                      status: 'todo',
                    });
                    newTasksCreated.push({ title: task.title });
                  }
                }
              } catch (taskErr) {
                console.error('[Stream] Auto task creation failed:', taskErr);
              }
            }
          }
        }

        // Save assistant message
        const assistantMessage = await chatService.addChatMessage(req.params.id, {
          role: 'assistant',
          content: explanation || 'Response completed.',
        });

        // Send final events
        res.write(`data: ${JSON.stringify({ type: 'assistant_message', message: assistantMessage })}\n\n`);
        if (editorUpdate) {
          res.write(`data: ${JSON.stringify({ type: 'editor_update', ...editorUpdate })}\n\n`);
        }
        if (newTasksCreated.length > 0) {
          res.write(`data: ${JSON.stringify({ type: 'tasks_created', tasks: newTasksCreated, count: newTasksCreated.length })}\n\n`);
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

// Store subscribers for development events (allows reconnection)
interface DevSubscriber {
  res: import('express').Response;
  id: string;
}
const developmentSubscribers = new Map<string, DevSubscriber[]>();

// Broadcast event to all subscribers of a project
const broadcastDevEvent = (projectId: string, type: string, data: unknown) => {
  const subscribers = developmentSubscribers.get(projectId) || [];
  const eventData = typeof data === 'object' && data !== null ? data : { value: data };
  const message = `data: ${JSON.stringify({ type, ...eventData as Record<string, unknown> })}\n\n`;

  for (const sub of subscribers) {
    try {
      sub.res.write(message);
    } catch {
      // Client disconnected, will be cleaned up
    }
  }
};

// Helper to update development status in database
const updateDevStatus = async (
  projectId: string,
  updates: {
    isRunning?: boolean;
    phase?: DevPhase;
    message?: string;
    error?: string | null;
    log?: string;
  }
) => {
  const updateData: Record<string, unknown> = {};
  if (updates.isRunning !== undefined) updateData['developmentStatus.isRunning'] = updates.isRunning;
  if (updates.phase !== undefined) updateData['developmentStatus.phase'] = updates.phase;
  if (updates.message !== undefined) updateData['developmentStatus.message'] = updates.message;
  if (updates.error !== undefined) updateData['developmentStatus.error'] = updates.error;

  // If starting, set startedAt
  if (updates.isRunning === true) {
    updateData['developmentStatus.startedAt'] = new Date();
    updateData['developmentStatus.logs'] = [];
    updateData['developmentStatus.error'] = null;
  }

  // If stopping, clear startedAt
  if (updates.isRunning === false) {
    updateData['developmentStatus.startedAt'] = null;
  }

  await projectService.updateProject(projectId, updateData);

  // Add log entry separately (push to array, limit to last 100)
  if (updates.log) {
    const project = await projectService.getProjectById(projectId);
    if (project) {
      const logs = project.developmentStatus?.logs || [];
      logs.push(`[${new Date().toISOString()}] ${updates.log}`);
      // Keep only last 100 logs
      const trimmedLogs = logs.slice(-100);
      await projectService.updateProject(projectId, { 'developmentStatus.logs': trimmedLogs });
    }
  }
};

// GET /api/projects/:id/development-status - Get current development status
router.get('/:id/development-status', async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  res.json({
    ...project.developmentStatus,
    // Include whether there's an active stream for this project
    hasActiveStream: Array.from(activeDevelopmentStreams.keys()).some(id => id.includes(req.params.id)),
  });
});

// GET /api/projects/:id/develop-stream - SSE endpoint for streaming development
router.get('/:id/develop-stream', async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!project.githubRepo) {
    res.status(400).json({ error: 'GitHub repo not configured' });
    return;
  }

  const projectId = req.params.id;
  const subscriberId = `sub-${projectId}-${Date.now()}`;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Add this client as a subscriber
  const subscribers = developmentSubscribers.get(projectId) || [];
  subscribers.push({ res, id: subscriberId });
  developmentSubscribers.set(projectId, subscribers);

  // Handle client disconnect - remove from subscribers
  req.on('close', () => {
    const subs = developmentSubscribers.get(projectId) || [];
    developmentSubscribers.set(projectId, subs.filter(s => s.id !== subscriberId));
  });

  // Check if development is already running - if so, just subscribe (reconnect mode)
  if (project.developmentStatus?.isRunning) {
    // Send reconnect confirmation with current status
    res.write(`data: ${JSON.stringify({
      type: 'reconnected',
      phase: project.developmentStatus.phase,
      message: project.developmentStatus.message,
    })}\n\n`);
    return; // Keep connection open, events will be broadcast
  }

  // Development not running - start it
  const streamId = `dev-${projectId}-${Date.now()}`;
  let isAborted = false;
  let currentContainerName: string | null = null;

  // Mark development as started
  await updateDevStatus(projectId, { isRunning: true, phase: 'setup', message: 'Starting development...', log: 'Development started' });

  // Helper to send SSE events (broadcasts to all subscribers)
  const sendEvent = (type: string, data: unknown) => {
    if (!isAborted) {
      broadcastDevEvent(projectId, type, data);
    }
  };

  // Abort handler
  const abort = async () => {
    isAborted = true;
    if (currentContainerName) {
      const claudeService = claudeServiceFactory(project);
      await claudeService.killContainerByName(currentContainerName);
    }
    // Don't clear status on disconnect - development continues in background
  };

  activeDevelopmentStreams.set(streamId, { abort });

  const claudeService = claudeServiceFactory(project);

  try {
    // Send initial state
    sendEvent('init', { projectId, projectName: project.name });

    // Get all tasks
    let tasks = await kanbanService.getTasksByProject(projectId);
    const todoTasks = tasks.filter(t => t.status === 'todo');

    sendEvent('tasks', {
      total: todoTasks.length,
      tasks: todoTasks.map(t => ({ id: t.id, title: t.title }))
    });

    // Phase 1: Develop all todo tasks
    await updateDevStatus(projectId, { phase: 'development', message: 'Starting development phase', log: 'Development phase started' });
    sendEvent('phase', { phase: 'development' as DevPhase, message: 'Starting development phase' });

    for (let i = 0; i < todoTasks.length && !isAborted; i++) {
      const task = todoTasks[i];
      currentContainerName = `claude-dev-${Date.now()}`;

      // Move to WIP
      await kanbanService.moveTask(task.id, 'wip', 0);
      await updateDevStatus(projectId, { message: `Developing task ${i + 1}/${todoTasks.length}: ${task.title}`, log: `Started task: ${task.title}` });
      sendEvent('task_start', {
        taskId: task.id,
        taskTitle: task.title,
        taskIndex: i + 1,
        totalTasks: todoTasks.length
      });

      const branchInstruction = task.branchName
        ? `\nBRANCH: You are working on branch "${task.branchName}". Ensure you are on this branch.`
        : '';

      const prompt = `You are developing a feature for an EXISTING project. The codebase already has code from previous tasks.

TASK: ${task.title}
DESCRIPTION: ${task.description || ''}${branchInstruction}

PROJECT REQUIREMENTS (for context):
${project.editorContent}

CRITICAL: BUILD ON EXISTING CODE
- This is an existing project with code already written
- DO NOT rewrite or delete existing files unless necessary
- Add to or modify existing code to implement this task
- Reuse existing utilities, components, and patterns
- Check what already exists before creating new files

MANDATORY REQUIREMENTS:
1. Implement this task by building on the existing codebase
2. Write comprehensive unit tests with 100% code coverage
3. Use the project's existing test framework (vitest, jest, etc.) or set one up if none exists
4. Run tests and verify they pass before committing
5. Commit with message: "feat: ${task.title}"

UI/UX REQUIREMENTS (when working on frontend/UI components):
- Use modern UI design principles (clean spacing, visual hierarchy, consistent typography)
- Apply appropriate color palettes with proper contrast ratios for accessibility
- Use professional font pairings (prefer Google Fonts)
- Implement responsive design for all screen sizes
- Follow platform-specific UX guidelines (web, mobile)
- Add smooth transitions and micro-interactions where appropriate
- Ensure WCAG 2.1 AA accessibility compliance
- Use appropriate UI patterns (cards, modals, forms, navigation)

TEST COVERAGE REQUIREMENTS:
- All new functions MUST have unit tests
- Cover edge cases and error handling
- Use mocking for external dependencies
- Target 100% line and branch coverage

WORKFLOW:
1. Implement the feature code
2. Write unit tests for all new code
3. Run: npm run test (or the project's test command)
4. Run: npm run test:coverage (if available) to verify coverage
5. Stage and commit all changes

Focus only on this specific task. Be thorough but concise.`;

      const result = await claudeService.streamDockerDevelop(
        prompt,
        currentContainerName,
        {
          onSetup: (phase) => sendEvent('setup', { message: phase }),
          onEvent: (event) => sendEvent('claude', event),
          onCommit: async (commitUrl) => {
            await kanbanService.updateTaskCommitUrl(task.id, commitUrl);
            sendEvent('commit', { taskId: task.id, commitUrl });
          },
          onError: (error) => sendEvent('error', { message: error.message }),
          onComplete: () => sendEvent('task_claude_complete', { taskId: task.id }),
        },
        { freshClone: i === 0 } // Only fresh clone for first task
      );

      // Cleanup container
      await claudeService.killContainerByName(currentContainerName);
      currentContainerName = null;

      if (result.success) {
        await kanbanService.moveTask(task.id, 'done', 0);
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
    await updateDevStatus(projectId, { phase: 'code_review', message: 'Moving to code review', log: 'Code review phase started' });
    sendEvent('phase', { phase: 'code_review' as DevPhase, message: 'Moving to code review' });
    tasks = await kanbanService.getTasksByProject(projectId);
    const doneTasks = tasks.filter(t => t.status === 'done');
    for (const task of doneTasks) {
      await kanbanService.moveTask(task.id, 'code_review', 0);
      sendEvent('task_moved', { taskId: task.id, status: 'code_review' });
    }

    // Phase 3: Unit Tests
    await updateDevStatus(projectId, { phase: 'unit_tests', message: 'Running unit tests', log: 'Unit tests phase started' });
    sendEvent('phase', { phase: 'unit_tests' as DevPhase, message: 'Running unit tests' });
    currentContainerName = `claude-test-${Date.now()}`;

    const testPrompt = `Run unit tests for this project.
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
      },
      { freshClone: false }
    );

    await claudeService.killContainerByName(currentContainerName);
    currentContainerName = null;

    if (testResult.success && !isAborted) {
      tasks = await kanbanService.getTasksByProject(projectId);
      for (const task of tasks.filter(t => t.status === 'code_review')) {
        await kanbanService.moveTask(task.id, 'done_unit_test', 0);
        sendEvent('task_moved', { taskId: task.id, status: 'done_unit_test' });
      }
    }

    if (isAborted) {
      sendEvent('aborted', { message: 'Development aborted by user' });
      res.end();
      return;
    }

    // Phase 4: E2E Tests
    await updateDevStatus(projectId, { phase: 'e2e_tests', message: 'Running E2E tests', log: 'E2E tests phase started' });
    sendEvent('phase', { phase: 'e2e_tests' as DevPhase, message: 'Running E2E tests' });
    currentContainerName = `claude-e2e-${Date.now()}`;

    const e2ePrompt = `Run E2E tests for this project.
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
      },
      { freshClone: false }
    );

    await claudeService.killContainerByName(currentContainerName);
    currentContainerName = null;

    if (e2eResult.success && !isAborted) {
      tasks = await kanbanService.getTasksByProject(projectId);
      for (const task of tasks.filter(t => t.status === 'done_unit_test')) {
        await kanbanService.moveTask(task.id, 'done_e2e_testing', 0);
        sendEvent('task_moved', { taskId: task.id, status: 'done_e2e_testing' });
      }
    }

    if (isAborted) {
      sendEvent('aborted', { message: 'Development aborted by user' });
      res.end();
      return;
    }

    // Development complete - tasks are now in done_e2e_testing
    // Deploy phase requires explicit user action via the Deploy button
    await updateDevStatus(projectId, { isRunning: false, phase: 'complete', message: 'Development and testing complete! Ready for deployment.', log: 'Development pipeline completed - awaiting manual deploy' });
    sendEvent('phase', { phase: 'complete' as DevPhase, message: 'Development and testing complete! Click Deploy when ready.' });
    sendEvent('done', { success: true });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    await updateDevStatus(projectId, { isRunning: false, phase: 'error', message: errorMessage, error: errorMessage, log: `Error: ${errorMessage}` });
    sendEvent('error', { message: errorMessage });
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

  // Update status in database
  await updateDevStatus(projectId, { isRunning: false, phase: 'idle', message: 'Development aborted', log: 'Development aborted by user' });

  res.json({ success: true });
});

// ============ Parallel Development Streaming ============

// Maximum concurrent task executions
const MAX_PARALLEL_TASKS = parseInt(process.env.MAX_PARALLEL_TASKS || '4', 10);

// Store active parallel development streams
const activeParallelStreams = new Map<string, { abort: () => void }>();

// Store parallel execution state for reconnection
interface ParallelTaskState {
  id: string;
  title: string;
  branchName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'merging' | 'merged';
  output: string;
  commitUrl?: string;
  error?: string;
}

interface ParallelExecutionState {
  currentBatch: number;
  totalBatches: number;
  tasks: ParallelTaskState[];
  mergeInProgress: boolean;
}

const parallelExecutionState = new Map<string, ParallelExecutionState>();

// Store subscribers for parallel development (allows reconnection)
interface ParallelDevSubscriber {
  res: import('express').Response;
  id: string;
}
const parallelDevSubscribers = new Map<string, ParallelDevSubscriber[]>();

// Broadcast event to all parallel dev subscribers
const broadcastParallelEvent = (projectId: string, type: string, data: unknown) => {
  const subscribers = parallelDevSubscribers.get(projectId) || [];
  const eventData = typeof data === 'object' && data !== null ? data : { value: data };
  const message = `data: ${JSON.stringify({ type, ...eventData as Record<string, unknown> })}\n\n`;
  for (const sub of subscribers) {
    try { sub.res.write(message); } catch { /* Client disconnected */ }
  }
};

// Update parallel state and broadcast
const updateParallelTaskState = (
  projectId: string,
  taskId: string,
  update: Partial<ParallelTaskState>
) => {
  const state = parallelExecutionState.get(projectId);
  if (state) {
    state.tasks = state.tasks.map(t =>
      t.id === taskId ? { ...t, ...update } : t
    );
    parallelExecutionState.set(projectId, state);
  }
};

// GET /api/projects/:id/develop-parallel-stream - SSE endpoint for parallel development
router.get('/:id/develop-parallel-stream', async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!project.githubRepo) {
    res.status(400).json({ error: 'GitHub repo not configured' });
    return;
  }

  const projectId = req.params.id;
  const devStatus = project.developmentStatus;

  // Check if already running - allow reconnection
  if (devStatus?.isRunning) {
    // Set up SSE for reconnection
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const subscriberId = `sub-${projectId}-${Date.now()}`;
    const subscribers = parallelDevSubscribers.get(projectId) || [];
    subscribers.push({ res, id: subscriberId });
    parallelDevSubscribers.set(projectId, subscribers);

    // Send current state to reconnecting client
    const currentState = parallelExecutionState.get(projectId);
    res.write(`data: ${JSON.stringify({
      type: 'reconnected',
      phase: devStatus.phase,
      message: devStatus.message,
      currentBatch: currentState?.currentBatch || 0,
      totalBatches: currentState?.totalBatches || 0,
      tasks: currentState?.tasks || [],
      mergeInProgress: currentState?.mergeInProgress || false,
    })}\n\n`);

    // Handle disconnect
    req.on('close', () => {
      const subs = parallelDevSubscribers.get(projectId) || [];
      parallelDevSubscribers.set(projectId, subs.filter(s => s.id !== subscriberId));
    });

    return;
  }

  const streamId = `parallel-${projectId}-${Date.now()}`;

  // Set up SSE response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let isAborted = false;

  // Helper to send SSE events
  const sendEvent = (type: string, data: unknown) => {
    if (!isAborted) {
      const eventData = typeof data === 'object' && data !== null ? data : { value: data };
      const message = `data: ${JSON.stringify({ type, ...eventData as Record<string, unknown> })}\n\n`;
      try {
        res.write(message);
      } catch { /* Client disconnected */ }
    }
  };

  // Abort handler
  const abortController = { abort: () => { isAborted = true; } };
  activeParallelStreams.set(streamId, abortController);

  // Handle client disconnect
  req.on('close', () => {
    isAborted = true;
    activeParallelStreams.delete(streamId);
  });

  try {
    // Mark as running
    await updateDevStatus(projectId, {
      isRunning: true,
      phase: 'development',
      message: 'Parallel development started',
      log: 'Starting parallel development...',
    });

    sendEvent('init', { projectId, projectName: project.name, mode: 'parallel' });

    // Get all tasks and compute execution plan
    const allTasks = await kanbanService.getTasksByProject(projectId);
    const todoTasks = allTasks.filter(t => t.status === 'todo');

    if (todoTasks.length === 0) {
      sendEvent('done', { success: true, message: 'No tasks to develop' });
      await updateDevStatus(projectId, { isRunning: false, phase: 'idle', message: 'No tasks' });
      res.end();
      return;
    }

    const executionPlan = parallelExecutionService.getExecutionPlan(todoTasks);

    if (executionPlan.hasCycles) {
      sendEvent('error', { message: 'Circular dependencies detected', cyclicTasks: executionPlan.cyclicTasks });
      await updateDevStatus(projectId, { isRunning: false, phase: 'error', error: 'Circular dependencies' });
      res.end();
      return;
    }

    sendEvent('plan', {
      batches: executionPlan.batches.length,
      totalTasks: executionPlan.totalTasks,
      plan: executionPlan.batches.map((batch, i) => ({
        batchNumber: i + 1,
        taskIds: batch,
        tasks: batch.map(id => {
          const t = todoTasks.find(task => task.id === id);
          return t ? { id: t.id, title: t.title } : null;
        }).filter(Boolean),
      })),
    });

    // Create Claude service for this project
    const claudeService = createClaudeService({ githubRepo: project.githubRepo });

    // Process each batch sequentially, tasks within batch in parallel
    for (let batchIndex = 0; batchIndex < executionPlan.batches.length && !isAborted; batchIndex++) {
      const batchTaskIds = executionPlan.batches[batchIndex];
      const batchTasks = todoTasks.filter(t => batchTaskIds.includes(t.id));
      const batchNumber = batchIndex + 1;

      await updateDevStatus(projectId, {
        message: `Batch ${batchNumber}/${executionPlan.batches.length}: ${batchTasks.length} tasks`,
        log: `Starting batch ${batchNumber}`,
      });

      // Initialize parallel state for this batch
      parallelExecutionState.set(projectId, {
        currentBatch: batchNumber,
        totalBatches: executionPlan.batches.length,
        tasks: batchTasks.map(t => ({
          id: t.id,
          title: t.title,
          branchName: '',
          status: 'pending' as const,
          output: '',
        })),
        mergeInProgress: false,
      });

      const batchStartEvent = {
        batchNumber,
        totalBatches: executionPlan.batches.length,
        taskCount: batchTasks.length,
        tasks: batchTasks.map(t => ({ id: t.id, title: t.title })),
      };
      sendEvent('batch_start', batchStartEvent);
      broadcastParallelEvent(projectId, 'batch_start', batchStartEvent);

      // Execute tasks in parallel with concurrency limit
      const results: Array<{ taskId: string; success: boolean; branchName: string; commitUrl?: string; error?: string }> = [];
      const executing: Promise<void>[] = [];

      for (const task of batchTasks) {
        if (isAborted) break;

        const branchName = parallelExecutionService.generateBranchName(task);

        const executeTask = async () => {
          // Update task with branch name and move to WIP
          await kanbanService.updateTaskBranch(task.id, branchName);
          await kanbanService.moveTask(task.id, 'wip', 0);
          await kanbanService.updateTaskTestStatus(task.id, 'running');

          // Update parallel state
          updateParallelTaskState(projectId, task.id, { branchName, status: 'running' });

          const taskStartEvent = {
            taskId: task.id,
            taskTitle: task.title,
            branchName,
            batchNumber,
          };
          sendEvent('task_start', taskStartEvent);
          broadcastParallelEvent(projectId, 'task_start', taskStartEvent);

          const branchInstruction = `\nBRANCH: You are working on branch "${branchName}". All commits should be on this branch.`;

          const prompt = `You are developing a feature for a project.

TASK: ${task.title}
DESCRIPTION: ${task.description || ''}${branchInstruction}

PROJECT REQUIREMENTS (for context):
${project.editorContent}

MANDATORY REQUIREMENTS:
1. Implement this task with production-quality code
2. Write comprehensive unit tests with 100% code coverage
3. Use the project's existing test framework (vitest, jest, etc.) or set one up if none exists
4. Run tests and verify they pass before committing
5. Commit with message: "feat: ${task.title}"

TEST COVERAGE REQUIREMENTS:
- All new functions MUST have unit tests
- Cover edge cases and error handling
- Use mocking for external dependencies
- Target 100% line and branch coverage

WORKFLOW:
1. Implement the feature code
2. Write unit tests for all new code
3. Run: npm run test (or the project's test command)
4. If tests fail, fix the issues
5. Run: npm run test:coverage (if available) to verify coverage
6. Stage and commit all changes

Focus only on this specific task. Be thorough but concise.`;

          try {
            const result = await claudeService.streamDockerDevelopOnBranch(
              prompt,
              branchName,
              {
                onSetup: (phase) => {
                  // Update state with setup message
                  const state = parallelExecutionState.get(projectId);
                  if (state) {
                    const taskState = state.tasks.find(t => t.id === task.id);
                    if (taskState) {
                      taskState.output += `[Setup] ${phase}\n\n`;
                    }
                  }
                  const setupEvent = { taskId: task.id, message: phase };
                  sendEvent('task_setup', setupEvent);
                  broadcastParallelEvent(projectId, 'task_setup', setupEvent);
                },
                onEvent: (event) => {
                  // Update state with claude output
                  const state = parallelExecutionState.get(projectId);
                  if (state) {
                    const taskState = state.tasks.find(t => t.id === task.id);
                    if (taskState && event.type === 'assistant') {
                      // Extract text from message.content array (Claude API format)
                      const msgEvent = event as { message?: { content?: Array<{ type: string; text?: string }> | string } };
                      const content = msgEvent.message?.content;
                      if (content) {
                        // Handle both array format and string format
                        if (Array.isArray(content)) {
                          const textContent = content
                            .filter(block => block.type === 'text' && block.text)
                            .map(block => block.text)
                            .join('');
                          if (textContent) taskState.output += textContent;
                        } else if (typeof content === 'string') {
                          taskState.output += content;
                        }
                      }
                    }
                  }
                  const claudeEvent = { taskId: task.id, branchName, event };
                  sendEvent('task_claude', claudeEvent);
                  broadcastParallelEvent(projectId, 'task_claude', claudeEvent);
                },
                onCommit: async (commitUrl) => {
                  await kanbanService.updateTaskCommitUrl(task.id, commitUrl);
                  updateParallelTaskState(projectId, task.id, { commitUrl });
                  const commitEvent = { taskId: task.id, commitUrl, branchName };
                  sendEvent('task_commit', commitEvent);
                  broadcastParallelEvent(projectId, 'task_commit', commitEvent);
                },
                onError: (error) => {
                  updateParallelTaskState(projectId, task.id, { error: error.message });
                  const errorEvent = { taskId: task.id, error: error.message };
                  sendEvent('task_error', errorEvent);
                  broadcastParallelEvent(projectId, 'task_error', errorEvent);
                },
                onComplete: () => {},
              },
              { freshClone: true }
            );

            if (result.success) {
              await kanbanService.updateTaskTestStatus(task.id, 'passed');
              await kanbanService.moveTask(task.id, 'done', 0);
              updateParallelTaskState(projectId, task.id, { status: 'completed', commitUrl: result.commitUrl });
              results.push({ taskId: task.id, success: true, branchName, commitUrl: result.commitUrl });
              const completeEvent = { taskId: task.id, success: true, branchName, commitUrl: result.commitUrl };
              sendEvent('task_complete', completeEvent);
              broadcastParallelEvent(projectId, 'task_complete', completeEvent);
            } else {
              await kanbanService.updateTaskTestStatus(task.id, 'failed');
              updateParallelTaskState(projectId, task.id, { status: 'failed', error: 'Development failed' });
              results.push({ taskId: task.id, success: false, branchName, error: 'Development failed' });
              const completeEvent = { taskId: task.id, success: false, branchName, error: 'Development failed' };
              sendEvent('task_complete', completeEvent);
              broadcastParallelEvent(projectId, 'task_complete', completeEvent);
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            await kanbanService.updateTaskTestStatus(task.id, 'failed');
            updateParallelTaskState(projectId, task.id, { status: 'failed', error: errorMsg });
            results.push({ taskId: task.id, success: false, branchName, error: errorMsg });
            const completeEvent = { taskId: task.id, success: false, branchName, error: errorMsg };
            sendEvent('task_complete', completeEvent);
            broadcastParallelEvent(projectId, 'task_complete', completeEvent);
          }
        };

        executing.push(executeTask());

        // Respect concurrency limit
        if (executing.length >= MAX_PARALLEL_TASKS) {
          await Promise.race(executing);
          // Remove completed promises (check by trying to race with an immediate resolve)
          const stillRunning: Promise<void>[] = [];
          for (const p of executing) {
            const isComplete = await Promise.race([p.then(() => true), Promise.resolve(false)]);
            if (!isComplete) stillRunning.push(p);
          }
          executing.length = 0;
          executing.push(...stillRunning);
        }
      }

      // Wait for remaining tasks in this batch
      await Promise.all(executing);

      const successCount = results.filter(r => r.success).length;
      const failedCount = results.filter(r => !r.success).length;

      const batchCompleteEvent = {
        batchNumber,
        totalBatches: executionPlan.batches.length,
        successCount,
        failedCount,
        results,
      };
      sendEvent('batch_complete', batchCompleteEvent);
      broadcastParallelEvent(projectId, 'batch_complete', batchCompleteEvent);

      // Merge successful branches to main
      if (successCount > 0 && !isAborted) {
        // Update state for merging
        const state = parallelExecutionState.get(projectId);
        if (state) {
          state.mergeInProgress = true;
          for (const r of results.filter(r => r.success)) {
            const t = state.tasks.find(t => t.id === r.taskId);
            if (t) t.status = 'merging';
          }
        }

        const mergeStartEvent = { batchNumber, branches: results.filter(r => r.success).map(r => r.branchName) };
        sendEvent('merge_start', mergeStartEvent);
        broadcastParallelEvent(projectId, 'merge_start', mergeStartEvent);

        for (const result of results.filter(r => r.success)) {
          try {
            const mergeResult = await claudeService.mergeBranchToMain(result.branchName);
            if (mergeResult.success) {
              await kanbanService.updateTaskMergeStatus(result.taskId, 'merged');
              updateParallelTaskState(projectId, result.taskId, { status: 'merged' });
              const mergeCompleteEvent = { taskId: result.taskId, branchName: result.branchName, commitUrl: mergeResult.commitUrl };
              sendEvent('merge_complete', mergeCompleteEvent);
              broadcastParallelEvent(projectId, 'merge_complete', mergeCompleteEvent);
            } else {
              await kanbanService.updateTaskMergeStatus(result.taskId, 'conflict');
              updateParallelTaskState(projectId, result.taskId, { status: 'failed', error: mergeResult.error });
              const mergeConflictEvent = { taskId: result.taskId, branchName: result.branchName, error: mergeResult.error };
              sendEvent('merge_conflict', mergeConflictEvent);
              broadcastParallelEvent(projectId, 'merge_conflict', mergeConflictEvent);
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Merge failed';
            await kanbanService.updateTaskMergeStatus(result.taskId, 'conflict');
            updateParallelTaskState(projectId, result.taskId, { status: 'failed', error: errorMsg });
            const mergeConflictEvent = { taskId: result.taskId, branchName: result.branchName, error: errorMsg };
            sendEvent('merge_conflict', mergeConflictEvent);
            broadcastParallelEvent(projectId, 'merge_conflict', mergeConflictEvent);
          }
        }

        // Update merge in progress
        const stateAfterMerge = parallelExecutionState.get(projectId);
        if (stateAfterMerge) stateAfterMerge.mergeInProgress = false;

        const mergeBatchCompleteEvent = { batchNumber };
        sendEvent('merge_batch_complete', mergeBatchCompleteEvent);
        broadcastParallelEvent(projectId, 'merge_batch_complete', mergeBatchCompleteEvent);

        // Code Review Phase - review each merged task
        const mergedTasks = results.filter(r => r.success);
        if (mergedTasks.length > 0 && !isAborted) {
          const reviewStartEvent = { batchNumber, taskCount: mergedTasks.length };
          sendEvent('review_start', reviewStartEvent);
          broadcastParallelEvent(projectId, 'review_start', reviewStartEvent);

          const MAX_REVIEW_RETRIES = 3;
          const QUALITY_THRESHOLD = 9.5;

          for (const mergedTask of mergedTasks) {
            if (isAborted) break;

            const taskData = batchTasks.find(t => t.id === mergedTask.taskId);
            if (!taskData) continue;

            let reviewPassed = false;
            let retryCount = 0;
            let lastReview: CodeReviewResult | null = null;

            while (!reviewPassed && retryCount < MAX_REVIEW_RETRIES && !isAborted) {
              const reviewingEvent = {
                taskId: mergedTask.taskId,
                taskTitle: taskData.title,
                attempt: retryCount + 1,
                maxAttempts: MAX_REVIEW_RETRIES,
              };
              sendEvent('review_task_start', reviewingEvent);
              broadcastParallelEvent(projectId, 'review_task_start', reviewingEvent);

              // Run code review
              const reviewResult = await claudeService.reviewCode(
                taskData.title,
                taskData.description || '',
                project.editorContent,
                {
                  onProgress: (message) => {
                    const progressEvent = { taskId: mergedTask.taskId, message };
                    sendEvent('review_progress', progressEvent);
                    broadcastParallelEvent(projectId, 'review_progress', progressEvent);
                  },
                }
              );

              lastReview = reviewResult;

              if (reviewResult.passed && reviewResult.qualityScore >= QUALITY_THRESHOLD) {
                reviewPassed = true;
                const passedEvent = {
                  taskId: mergedTask.taskId,
                  taskTitle: taskData.title,
                  qualityScore: reviewResult.qualityScore,
                  passed: true,
                  summary: reviewResult.summary,
                };
                sendEvent('review_task_complete', passedEvent);
                broadcastParallelEvent(projectId, 'review_task_complete', passedEvent);

                // Update task coverage/quality score
                await kanbanService.updateTaskTestStatus(mergedTask.taskId, 'passed', reviewResult.qualityScore * 10);
              } else {
                retryCount++;

                if (retryCount < MAX_REVIEW_RETRIES) {
                  // Quality below threshold - fix and retry
                  const fixingEvent = {
                    taskId: mergedTask.taskId,
                    qualityScore: reviewResult.qualityScore,
                    issues: reviewResult.issues || [],
                    suggestions: reviewResult.suggestions || [],
                    attempt: retryCount,
                  };
                  sendEvent('review_fix_start', fixingEvent);
                  broadcastParallelEvent(projectId, 'review_fix_start', fixingEvent);

                  // Fix code quality issues
                  await claudeService.fixCodeQuality(
                    taskData.title,
                    reviewResult.issues || [],
                    reviewResult.suggestions || [],
                    {
                      onProgress: (message) => {
                        const progressEvent = { taskId: mergedTask.taskId, message };
                        sendEvent('review_fix_progress', progressEvent);
                        broadcastParallelEvent(projectId, 'review_fix_progress', progressEvent);
                      },
                    }
                  );

                  const fixCompleteEvent = { taskId: mergedTask.taskId, attempt: retryCount };
                  sendEvent('review_fix_complete', fixCompleteEvent);
                  broadcastParallelEvent(projectId, 'review_fix_complete', fixCompleteEvent);
                }
              }
            }

            // Final result after all retries
            if (!reviewPassed && lastReview) {
              const failedEvent = {
                taskId: mergedTask.taskId,
                taskTitle: taskData.title,
                qualityScore: lastReview.qualityScore,
                passed: false,
                summary: lastReview.summary,
                issues: lastReview.issues,
                retriesExhausted: true,
              };
              sendEvent('review_task_failed', failedEvent);
              broadcastParallelEvent(projectId, 'review_task_failed', failedEvent);
            }
          }

          const reviewBatchCompleteEvent = { batchNumber };
          sendEvent('review_batch_complete', reviewBatchCompleteEvent);
          broadcastParallelEvent(projectId, 'review_batch_complete', reviewBatchCompleteEvent);

          // Small delay to allow UI to process review events before done event
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }

    if (isAborted) {
      const abortedEvent = { message: 'Development aborted by user' };
      sendEvent('aborted', abortedEvent);
      broadcastParallelEvent(projectId, 'aborted', abortedEvent);
      await updateDevStatus(projectId, { isRunning: false, phase: 'idle', message: 'Aborted' });
      parallelExecutionState.delete(projectId);
    } else {
      // All batches complete
      await updateDevStatus(projectId, {
        isRunning: false,
        phase: 'idle',
        message: 'Parallel development complete',
        log: 'All batches completed successfully',
      });

      // Update project status
      await projectService.updateProject(projectId, { status: 'development' });

      // Small delay to ensure all previous events are processed by UI
      await new Promise(resolve => setTimeout(resolve, 300));

      const doneEvent = { success: true, message: 'Parallel development complete' };
      sendEvent('done', doneEvent);
      broadcastParallelEvent(projectId, 'done', doneEvent);
      parallelExecutionState.delete(projectId);
    }

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    await updateDevStatus(projectId, { isRunning: false, phase: 'error', message: errorMessage, error: errorMessage });
    const errorEvent = { message: errorMessage };
    sendEvent('error', errorEvent);
    broadcastParallelEvent(projectId, 'error', errorEvent);
    const doneEvent = { success: false };
    sendEvent('done', doneEvent);
    broadcastParallelEvent(projectId, 'done', doneEvent);
    parallelExecutionState.delete(projectId);
  } finally {
    activeParallelStreams.delete(streamId);
    parallelDevSubscribers.delete(projectId);
    res.end();
  }
});

// POST /api/projects/:id/develop-parallel-stream/abort - Abort parallel development
router.post('/:id/develop-parallel-stream/abort', async (req, res) => {
  const projectId = req.params.id;

  for (const [streamId, stream] of activeParallelStreams.entries()) {
    if (streamId.includes(projectId)) {
      stream.abort();
      activeParallelStreams.delete(streamId);
    }
  }

  await updateDevStatus(projectId, { isRunning: false, phase: 'idle', message: 'Parallel development aborted' });
  parallelExecutionState.delete(projectId);
  parallelDevSubscribers.delete(projectId);

  res.json({ success: true });
});

// GET /api/projects/:id/diff - Get diff between two content versions
const DiffQuerySchema = z.object({
  oldContent: z.string(),
  newContent: z.string(),
});

router.post('/:id/diff', validateBody(DiffQuerySchema), async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
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
  const project = await projectService.getProjectById(req.params.id);
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

    let tasks: { title: string; description?: string; dependencies?: string[] }[];
    try {
      tasks = JSON.parse(tasksJson);
    } catch {
      res.status(500).json({ error: 'Failed to parse tasks from Claude response', raw: response.content });
      return;
    }

    // Create kanban tasks (initially without dependencies)
    const createdTasks = await Promise.all(
      tasks.map((task) =>
        kanbanService.createTask(req.params.id, {
          title: task.title,
          description: task.description,
          status: 'todo',
        })
      )
    );

    // Resolve dependencies by title and update tasks
    // Claude returns dependencies as task titles, we need to convert to IDs
    const titleToId = new Map(createdTasks.map(t => [t.title.toLowerCase(), t.id]));

    for (let i = 0; i < tasks.length; i++) {
      const taskData = tasks[i];
      const createdTask = createdTasks[i];

      if (taskData.dependencies && taskData.dependencies.length > 0) {
        // Resolve dependency titles to IDs
        const resolvedDeps = taskData.dependencies
          .map(depTitle => titleToId.get(depTitle.toLowerCase()))
          .filter((id): id is string => id !== undefined);

        if (resolvedDeps.length > 0) {
          // Update task with resolved dependencies
          await kanbanService.updateTaskDependencies(createdTask.id, resolvedDeps);
          createdTasks[i] = { ...createdTask, dependencies: resolvedDeps };
        }
      }
    }

    // Update project status to development if it has a repo
    if (project.githubRepo && project.status === 'draft') {
      await projectService.updateProject(req.params.id, { status: 'development' });
    }

    res.json({ success: true, tasks: createdTasks });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/parse-new-tasks - Parse PRD and add new tasks (for deployed/development projects)
router.post('/:id/parse-new-tasks', async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
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
    // Get existing tasks to avoid duplicates
    const existingTasks = await kanbanService.getTasksByProject(req.params.id);
    const existingTitles = new Set(existingTasks.map(t => t.title.toLowerCase()));

    const response = await claudeService.analyzePRD(project.editorContent);

    if (!response.success) {
      res.status(500).json({ error: response.error || 'Failed to analyze PRD' });
      return;
    }

    // Parse the JSON response
    let tasksJson = response.content || '[]';
    const jsonMatch = tasksJson.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      tasksJson = jsonMatch[1].trim();
    }
    const arrayMatch = tasksJson.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      tasksJson = arrayMatch[0];
    }

    let tasks: { title: string; description?: string; dependencies?: string[] }[];
    try {
      tasks = JSON.parse(tasksJson);
    } catch {
      res.status(500).json({ error: 'Failed to parse tasks from Claude response', raw: response.content });
      return;
    }

    // Filter out tasks that already exist (by title)
    const newTasks = tasks.filter(t => !existingTitles.has(t.title.toLowerCase()));

    if (newTasks.length === 0) {
      res.json({ success: true, tasks: [], message: 'No new tasks found. All tasks from PRD already exist.' });
      return;
    }

    // Create new kanban tasks
    const createdTasks = await Promise.all(
      newTasks.map((task) =>
        kanbanService.createTask(req.params.id, {
          title: task.title,
          description: task.description,
          status: 'todo',
        })
      )
    );

    // Resolve dependencies (including existing tasks)
    const allTasks = [...existingTasks, ...createdTasks];
    const titleToId = new Map(allTasks.map(t => [t.title.toLowerCase(), t.id]));

    for (let i = 0; i < newTasks.length; i++) {
      const taskData = newTasks[i];
      const createdTask = createdTasks[i];

      if (taskData.dependencies && taskData.dependencies.length > 0) {
        const resolvedDeps = taskData.dependencies
          .map(depTitle => titleToId.get(depTitle.toLowerCase()))
          .filter((id): id is string => id !== undefined);

        if (resolvedDeps.length > 0) {
          await kanbanService.updateTaskDependencies(createdTask.id, resolvedDeps);
          createdTasks[i] = { ...createdTask, dependencies: resolvedDeps };
        }
      }
    }

    res.json({ success: true, tasks: createdTasks, message: `Created ${createdTasks.length} new tasks` });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/develop-next - Develop the next task in WIP or move one from Todo
router.post('/:id/develop-next', async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!project.githubRepo) {
    res.status(400).json({ error: 'Please link a GitHub repository first' });
    return;
  }

  const allTasks = await kanbanService.getTasksByProject(req.params.id);

  // Find task to work on: first check WIP, then get first from Todo
  let task = allTasks.find((t) => t.status === 'wip');

  if (!task) {
    const todoTask = allTasks.find((t) => t.status === 'todo');
    if (!todoTask) {
      res.json({ success: true, message: 'No tasks to develop', complete: true });
      return;
    }
    // Move to WIP
    task = await kanbanService.moveTask(todoTask.id, 'wip', 0);
    if (!task) {
      res.status(500).json({ error: 'Failed to move task to WIP' });
      return;
    }
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
    const updatedTask = await kanbanService.moveTask(task.id, 'done', 0);

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
  const project = await projectService.getProjectById(req.params.id);
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
      const allTasks = await kanbanService.getTasksByProject(projectId);
      const todoTask = allTasks.find((t) => t.status === 'todo');

      if (!todoTask) break;

      // Move to WIP
      const wipTask = await kanbanService.moveTask(todoTask.id, 'wip', 0);
      if (!wipTask) continue;

      try {
        // Build prompt for this task with test coverage requirements
        const branchInstruction = wipTask.branchName
          ? `\nBRANCH: You are working on branch "${wipTask.branchName}". Ensure you are on this branch.`
          : '';

        const prompt = `You are developing a feature for a project.

TASK: ${wipTask.title}
DESCRIPTION: ${wipTask.description || ''}${branchInstruction}

PROJECT REQUIREMENTS (for context):
${project.editorContent}

MANDATORY REQUIREMENTS:
1. Implement this task with production-quality code
2. Write comprehensive unit tests with 100% code coverage
3. Use the project's existing test framework (vitest, jest, etc.) or set one up if none exists
4. Run tests and verify they pass before committing
5. Commit with message: "feat: ${wipTask.title}"

UI/UX REQUIREMENTS (when working on frontend/UI components):
- Use modern UI design principles (clean spacing, visual hierarchy, consistent typography)
- Apply appropriate color palettes with proper contrast ratios for accessibility
- Use professional font pairings (prefer Google Fonts)
- Implement responsive design for all screen sizes
- Follow platform-specific UX guidelines (web, mobile)
- Add smooth transitions and micro-interactions where appropriate
- Ensure WCAG 2.1 AA accessibility compliance
- Use appropriate UI patterns (cards, modals, forms, navigation)

TEST COVERAGE REQUIREMENTS:
- All new functions MUST have unit tests
- Cover edge cases and error handling
- Use mocking for external dependencies
- Target 100% line and branch coverage

WORKFLOW:
1. Implement the feature code
2. Write unit tests for all new code
3. Run: npm run test (or the project's test command)
4. Run: npm run test:coverage (if available) to verify coverage
5. Stage and commit all changes

Focus only on this specific task. Be thorough but concise.`;

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
          await kanbanService.updateTaskCommitUrl(wipTask.id, response.commitUrl);
        }

        // Move to done
        await kanbanService.moveTask(wipTask.id, 'done', 0);
      } catch (err) {
        // On error, kill container and leave in WIP for manual review
        await claudeService.killContainer();
        console.error('Task development error:', err);
        return;
      }
    }

    // Phase 2: Code Review - move all done tasks to code_review
    console.log('[CC-Manager] Phase 2: Moving tasks to code_review');
    let tasks = await kanbanService.getTasksByProject(projectId);
    const doneTasks = tasks.filter((t) => t.status === 'done');
    for (const task of doneTasks) {
      await kanbanService.moveTask(task.id, 'code_review', 0);
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
        tasks = await kanbanService.getTasksByProject(projectId);
        for (const task of tasks.filter((t) => t.status === 'code_review')) {
          await kanbanService.moveTask(task.id, 'done_unit_test', 0);
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
        tasks = await kanbanService.getTasksByProject(projectId);
        for (const task of tasks.filter((t) => t.status === 'done_unit_test')) {
          await kanbanService.moveTask(task.id, 'done_e2e_testing', 0);
        }
      } else {
        console.error('[CC-Manager] E2E tests failed:', e2eResponse.error);
      }
    } catch (err) {
      await claudeService.killContainer();
      console.error('[CC-Manager] E2E tests error:', err);
      return;
    }

    // Development complete - tasks are now in done_e2e_testing
    // Deploy phase requires explicit user action via the Deploy button
    console.log('[CC-Manager] Development and testing complete! Ready for manual deployment.');
  };

  processTasks().catch(console.error);
});

// POST /api/projects/:id/continue - Continue workflow from current state
router.post('/:id/continue', async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!project.githubRepo) {
    res.status(400).json({ error: 'Please link a GitHub repository first' });
    return;
  }

  const tasks = await kanbanService.getTasksByProject(req.params.id);
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
        await kanbanService.moveTask(task.id, 'code_review', 0);
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
        const currentTasks = await kanbanService.getTasksByProject(projectId);
        for (const task of currentTasks.filter(t => t.status === 'code_review')) {
          await kanbanService.moveTask(task.id, 'done_unit_test', 0);
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
        const currentTasks = await kanbanService.getTasksByProject(projectId);
        for (const task of currentTasks.filter(t => t.status === 'done_unit_test')) {
          await kanbanService.moveTask(task.id, 'done_e2e_testing', 0);
        }
        nextPhase = 'deploy';
      } else {
        console.error('[CC-Manager] E2E tests failed');
        return;
      }
    }

    // Deploy phase is handled by explicit /deploy endpoint
    // Don't auto-deploy from continue workflow
    if (nextPhase === 'deploy') {
      console.log('[CC-Manager] Tasks ready for deployment. Use Deploy button to deploy.');
    }
  };

  continueWorkflow().catch(console.error);
});

// POST /api/projects/:id/deploy - Deploy project to NAS
router.post('/:id/deploy', async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
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
    const allTasks = await kanbanService.getTasksByProject(req.params.id);
    for (const task of allTasks) {
      if (task.status !== 'deploy') {
        await kanbanService.moveTask(task.id, 'deploy', 0);
      }
    }

    // Update project status to deployed and set the deployed URL
    // The deployed URL is typically the project running on a specific port
    await projectService.updateProject(req.params.id, {
      status: 'deployed',
      deployedUrl: `${targetPath}/${projectName}`,
    });

    res.json({ success: true, output: response.content, path: `${targetPath}/${projectName}` });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/projects/:id/commits - Get commit summary for a project
router.get('/:id/commits', async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const summary = await kanbanService.getProjectCommitSummary(req.params.id);
  res.json(summary);
});

// ============ Kanban Routes ============

// GET /api/projects/:id/kanban - Get all tasks for a project
router.get('/:id/kanban', async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const tasks = await kanbanService.getTasksByProject(req.params.id);
  res.json(tasks);
});

// POST /api/projects/:id/kanban - Create a new task
router.post('/:id/kanban', validateBody(CreateKanbanTaskSchema), async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const task = await kanbanService.createTask(req.params.id, req.body);
  res.status(201).json(task);
});

// GET /api/projects/:id/kanban/:taskId - Get a single task
router.get('/:id/kanban/:taskId', async (req, res) => {
  const task = await kanbanService.getTaskById(req.params.taskId);
  if (!task || task.projectId !== req.params.id) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(task);
});

// PATCH /api/projects/:id/kanban/:taskId - Update a task
router.patch('/:id/kanban/:taskId', validateBody(UpdateKanbanTaskSchema), async (req, res) => {
  const task = await kanbanService.getTaskById(req.params.taskId);
  if (!task || task.projectId !== req.params.id) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const updated = await kanbanService.updateTask(req.params.taskId, req.body);
  res.json(updated);
});

// PUT /api/projects/:id/kanban/:taskId/move - Move task to different column/position
router.put('/:id/kanban/:taskId/move', validateBody(MoveTaskSchema), async (req, res) => {
  const task = await kanbanService.getTaskById(req.params.taskId);
  if (!task || task.projectId !== req.params.id) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const moved = await kanbanService.moveTask(req.params.taskId, req.body.status, req.body.position);
  res.json(moved);
});

// DELETE /api/projects/:id/kanban/:taskId - Delete a task
router.delete('/:id/kanban/:taskId', async (req, res) => {
  const task = await kanbanService.getTaskById(req.params.taskId);
  if (!task || task.projectId !== req.params.id) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  await kanbanService.deleteTask(req.params.taskId);
  res.status(204).send();
});

// POST /api/projects/:id/kanban/clear-conflicts - Clear all merge conflicts
router.post('/:id/kanban/clear-conflicts', async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const count = await kanbanService.clearAllMergeConflicts(req.params.id);
  res.json({ cleared: count });
});

// ============ Task Comment Routes ============

// GET /api/projects/:id/kanban/:taskId/comments - Get all comments for a task
router.get('/:id/kanban/:taskId/comments', async (req, res) => {
  const task = await kanbanService.getTaskById(req.params.taskId);
  if (!task || task.projectId !== req.params.id) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const comments = await kanbanService.getCommentsByTask(req.params.taskId);
  res.json(comments);
});

// POST /api/projects/:id/kanban/:taskId/comments - Add a comment to a task
router.post('/:id/kanban/:taskId/comments', validateBody(CreateTaskCommentSchema), async (req, res) => {
  const task = await kanbanService.getTaskById(req.params.taskId);
  if (!task || task.projectId !== req.params.id) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const comment = await kanbanService.createComment(req.params.taskId, req.body);
  res.status(201).json(comment);
});

// DELETE /api/projects/:id/kanban/:taskId/comments/:commentId - Delete a comment
router.delete('/:id/kanban/:taskId/comments/:commentId', async (req, res) => {
  const task = await kanbanService.getTaskById(req.params.taskId);
  if (!task || task.projectId !== req.params.id) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const deleted = await kanbanService.deleteComment(req.params.commentId);
  if (!deleted) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }
  res.status(204).send();
});

// ============ Parallel Development Routes ============

// GET /api/projects/:id/execution-plan - Get batched execution plan based on dependencies
router.get('/:id/execution-plan', async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const tasks = await kanbanService.getTasksByProject(req.params.id);
  const todoTasks = tasks.filter(t => t.status === 'todo');

  const executionPlan = dependencyService.getExecutionOrder(todoTasks);

  // Map task IDs to task details for better frontend display
  const batchesWithDetails = executionPlan.batches.map(batch =>
    batch.map(taskId => {
      const task = todoTasks.find(t => t.id === taskId);
      return task ? { id: task.id, title: task.title, dependencies: task.dependencies } : null;
    }).filter(Boolean)
  );

  res.json({
    batches: batchesWithDetails,
    totalTasks: executionPlan.totalTasks,
    totalBatches: executionPlan.batches.length,
    hasCycles: executionPlan.hasCycles,
    cyclicTasks: executionPlan.cyclicTasks,
  });
});

// PUT /api/projects/:id/kanban/:taskId/dependencies - Update task dependencies
const UpdateDependenciesBodySchema = z.object({
  dependencyIds: z.array(z.string()),
});

router.put('/:id/kanban/:taskId/dependencies', validateBody(UpdateDependenciesBodySchema), async (req, res) => {
  const task = await kanbanService.getTaskById(req.params.taskId);
  if (!task || task.projectId !== req.params.id) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  // Validate that all dependency IDs exist and belong to the same project
  const allTasks = await kanbanService.getTasksByProject(req.params.id);
  const validTaskIds = new Set(allTasks.map(t => t.id));

  const invalidDeps = req.body.dependencyIds.filter((id: string) => !validTaskIds.has(id));
  if (invalidDeps.length > 0) {
    res.status(400).json({ error: `Invalid dependency IDs: ${invalidDeps.join(', ')}` });
    return;
  }

  // Prevent self-dependency
  if (req.body.dependencyIds.includes(req.params.taskId)) {
    res.status(400).json({ error: 'A task cannot depend on itself' });
    return;
  }

  // Check for cycles
  const validation = dependencyService.validateNoCycles(
    req.params.taskId,
    req.body.dependencyIds,
    allTasks
  );

  if (!validation.valid) {
    res.status(400).json({
      error: 'Adding these dependencies would create a circular dependency',
      cyclePath: validation.cyclePath,
    });
    return;
  }

  const updated = await kanbanService.updateTaskDependencies(req.params.taskId, req.body.dependencyIds);
  res.json(updated);
});

// GET /api/projects/:id/kanban/:taskId/dependencies - Get task dependencies and dependents
router.get('/:id/kanban/:taskId/dependencies', async (req, res) => {
  const task = await kanbanService.getTaskById(req.params.taskId);
  if (!task || task.projectId !== req.params.id) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const allTasks = await kanbanService.getTasksByProject(req.params.id);

  // Get tasks this task depends on
  const dependencies = dependencyService.getDependencyTasks(req.params.taskId, allTasks);

  // Get tasks that depend on this task
  const dependents = dependencyService.getDependentTasks(req.params.taskId, allTasks);

  // Check if dependencies are satisfied
  const areSatisfied = dependencyService.areDependenciesSatisfied(req.params.taskId, allTasks);

  res.json({
    taskId: task.id,
    dependencies: dependencies.map(t => ({ id: t.id, title: t.title, status: t.status })),
    dependents: dependents.map(t => ({ id: t.id, title: t.title, status: t.status })),
    areDependenciesSatisfied: areSatisfied,
  });
});

export default router;
