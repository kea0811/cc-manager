import { execSync, exec, spawn, ChildProcess } from 'child_process';
import { writeFileSync, unlinkSync, chmodSync, mkdirSync, existsSync, rmSync } from 'fs';
import { EventEmitter } from 'events';
import { promisify } from 'util';
import { randomUUID } from 'crypto';

const execAsync = promisify(exec);

// Stream event types from Claude Code's stream-json output
export type StreamEventType =
  | 'assistant'     // Claude's text response
  | 'tool_use'      // Claude is calling a tool
  | 'tool_result'   // Result from tool execution
  | 'result'        // Final result
  | 'error'         // Error occurred
  | 'system'        // System messages (init, etc)
  | 'text';         // Raw text (non-JSON lines)

// Content block type from Claude API
interface ContentBlock {
  type: string;
  text?: string;
}

export interface StreamEvent {
  type: StreamEventType;
  content?: string;
  message?: { content: string | ContentBlock[] };
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  subtype?: string;
}

// Helper to extract text from message content (can be string or array of content blocks)
function extractTextFromContent(content: string | ContentBlock[] | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is ContentBlock & { text: string } =>
        block.type === 'text' && typeof block.text === 'string'
      )
      .map(block => block.text)
      .join('');
  }
  return '';
}

export interface StreamCallbacks {
  onEvent: (event: StreamEvent) => void;
  onError: (error: Error) => void;
  onComplete: (fullContent: string) => void;
}

export interface ClaudeResponse {
  success: boolean;
  content?: string;
  error?: string;
  containerId?: string;
  commitUrl?: string;
}

export interface ClaudeConfig {
  token: string;
  projectPath?: string;
  ralphMode?: boolean;
  githubRepo?: string;
}

export interface CodeReviewResult {
  success: boolean;
  qualityScore: number;
  passed: boolean;
  issues?: string[];
  suggestions?: string[];
  summary?: string;
  fullReview?: string;
  error?: string;
}

// Support both env var names for compatibility
const CLAUDE_CODE_TOKEN = process.env.CLAUDE_CODE_TOKEN || process.env.CLAUDE_CODE_OAUTH_TOKEN || '';

export class ClaudeService extends EventEmitter {
  private token: string;
  private projectPath: string;
  private ralphMode: boolean;
  private githubRepo: string;
  private containerId: string | null = null;

  constructor(config: ClaudeConfig) {
    super();
    this.token = config.token || CLAUDE_CODE_TOKEN;
    this.projectPath = config.projectPath || process.cwd();
    this.ralphMode = config.ralphMode || false;
    this.githubRepo = config.githubRepo || '';
  }

  // Spawn a Docker container, clone repo, and run Claude Code
  async spawnDockerAndDevelop(prompt: string): Promise<ClaudeResponse> {
    if (!this.token) {
      return { success: false, error: 'Claude Code token not configured' };
    }

    if (!this.githubRepo) {
      return { success: false, error: 'GitHub repo not configured' };
    }

    // Extract repo name from URL for workspace directory
    const repoMatch = this.githubRepo.match(/\/([^\/]+?)(\.git)?$/);
    const repoName = repoMatch ? repoMatch[1] : 'repo';
    const workDir = `/workspace/${repoName}`;

    try {
      console.log(`[ClaudeService] Development in workspace: ${workDir}`);
      console.log(`[ClaudeService] Repo: ${this.githubRepo}`);

      // Check if repo already exists, if not clone it
      try {
        await execAsync(`test -d "${workDir}/.git"`, { timeout: 5000 });
        console.log(`[ClaudeService] Repo already cloned, pulling latest...`);
        await execAsync(`cd "${workDir}" && git fetch origin && git reset --hard origin/main || git reset --hard origin/master`, { timeout: 60000 });
      } catch {
        console.log(`[ClaudeService] Cloning repository...`);
        await execAsync(`rm -rf "${workDir}" && git clone ${this.githubRepo} "${workDir}"`, { timeout: 120000 });
        console.log(`[ClaudeService] Clone successful`);
      }

      // Create temp file for the prompt to avoid shell escaping issues
      const timestamp = Date.now();
      const tmpFile = `/tmp/claude-dev-prompt-${timestamp}.txt`;
      writeFileSync(tmpFile, prompt);

      // Run Claude Code directly (no Docker-in-Docker)
      console.log(`[ClaudeService] Running Claude Code...`);
      const scriptContent = `#!/bin/bash
export CLAUDE_CODE_OAUTH_TOKEN="${this.token}"
cd "${workDir}"
cat "${tmpFile}" | claude --dangerously-skip-permissions -p - --output-format text 2>&1
`;
      const tmpScript = `/tmp/claude-dev-run-${timestamp}.sh`;
      writeFileSync(tmpScript, scriptContent);
      chmodSync(tmpScript, '755');

      const output = execSync(tmpScript, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 600000,
        encoding: 'utf8',
      });

      // Clean up temp files
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
      try { unlinkSync(tmpScript); } catch { /* ignore */ }

      console.log(`[ClaudeService] Claude Code completed`);

      // Push changes to GitHub and capture commit hash
      console.log(`[ClaudeService] Pushing changes to GitHub...`);
      let commitUrl: string | undefined;
      try {
        // First, commit any uncommitted changes (Claude may or may not have committed)
        try {
          await execAsync(`cd "${workDir}" && git add -A && git diff --cached --quiet || git commit -m 'Development by CC Manager'`, { timeout: 30000 });
        } catch {
          // Ignore commit errors - there might be nothing to commit
        }

        // Always try to push (Claude commits but doesn't push)
        const pushCmd = `cd "${workDir}" && git push 2>&1 && git rev-parse HEAD`;
        const { stdout: pushOutput } = await execAsync(pushCmd, { timeout: 60000 });
        console.log(`[ClaudeService] Push output: ${pushOutput}`);

        // Extract commit hash from output (last line with 40 char hex)
        const lines = pushOutput.trim().split('\n');
        const commitHash = lines.find(line => /^[a-f0-9]{40}$/.test(line.trim()));

        if (commitHash && this.githubRepo) {
          // Convert SSH URL to HTTPS commit URL
          // git@github.com:user/repo.git -> https://github.com/user/repo/commit/hash
          const baseUrl = this.githubRepo
            .replace(/^git@([^:]+):/, 'https://$1/')
            .replace(/\.git$/, '');
          commitUrl = `${baseUrl}/commit/${commitHash.trim()}`;
          console.log(`[ClaudeService] Commit URL: ${commitUrl}`);
        }
      } catch (pushErr) {
        console.log(`[ClaudeService] Push skipped or failed:`, pushErr instanceof Error ? pushErr.message : pushErr);
      }

      return { success: true, content: output.trim(), commitUrl };
    } catch (err) {
      console.error(`[ClaudeService] Error:`, err instanceof Error ? err.message : err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  // Kill and remove the Docker container
  async killContainer(): Promise<void> {
    if (this.containerId) {
      try {
        console.log(`[ClaudeService] Killing container ${this.containerId}`);
        await execAsync(`docker rm -f ${this.containerId}`);
        console.log(`[ClaudeService] Container removed`);
      } catch (err) {
        console.error(`[ClaudeService] Error removing container:`, err);
      }
      this.containerId = null;
    }
  }

  // Kill container by name (for cleanup)
  async killContainerByName(containerName: string): Promise<void> {
    try {
      await execAsync(`docker rm -f ${containerName}`);
    } catch {
      // Ignore errors - container might not exist
    }
  }

  // Streaming version of development (runs directly in backend container)
  async streamDockerDevelop(
    prompt: string,
    _containerName: string, // Kept for API compatibility but not used
    callbacks: StreamCallbacks & {
      onSetup?: (phase: string) => void;
      onCommit?: (commitUrl: string) => void;
    },
    options: { freshClone?: boolean } = {}
  ): Promise<{ success: boolean; commitUrl?: string }> {
    if (!this.token) {
      callbacks.onError(new Error('Claude Code token not configured'));
      return { success: false };
    }

    if (!this.githubRepo) {
      callbacks.onError(new Error('GitHub repo not configured'));
      return { success: false };
    }

    // Extract repo name from URL for workspace directory
    const repoMatch = this.githubRepo.match(/\/([^\/]+?)(\.git)?$/);
    const repoName = repoMatch ? repoMatch[1] : 'repo';
    const workDir = `/workspace/${repoName}`;

    try {
      // Phase 1: Clone repository only if it doesn't exist or freshClone is requested
      callbacks.onSetup?.('Preparing repository...');
      console.log(`[ClaudeService] Stream development in workspace: ${workDir}`);

      let repoExists = false;
      try {
        await execAsync(`test -d "${workDir}/.git"`, { timeout: 5000 });
        repoExists = true;
      } catch {
        repoExists = false;
      }

      if (!repoExists || options.freshClone) {
        console.log(`[ClaudeService] Cloning repository...`);
        callbacks.onSetup?.('Cloning repository...');
        await execAsync(`rm -rf "${workDir}" && git clone ${this.githubRepo} "${workDir}"`, { timeout: 120000 });
      } else {
        console.log(`[ClaudeService] Using existing repo (preserving local changes)`);
        callbacks.onSetup?.('Using existing repository...');
      }

      // Phase 2: Write prompt to file and run Claude Code with streaming
      callbacks.onSetup?.('Running Claude Code...');
      const timestamp = Date.now();
      const tmpFile = `/tmp/claude-stream-prompt-${timestamp}.txt`;
      writeFileSync(tmpFile, prompt);

      // Spawn Claude Code with streaming output (runs directly, no Docker-in-Docker)
      return new Promise((resolve) => {
        let fullContent = '';
        let buffer = '';

        const child = spawn('bash', ['-c', `
          export CLAUDE_CODE_OAUTH_TOKEN="${this.token}"
          cd "${workDir}"
          cat "${tmpFile}" | claude --dangerously-skip-permissions --verbose -p - --output-format stream-json 2>&1
        `]);

        child.stdout.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line) as StreamEvent;
              if (event.type === 'assistant' && event.message?.content) {
                fullContent += extractTextFromContent(event.message.content);
              }
              callbacks.onEvent(event);
            } catch {
              callbacks.onEvent({ type: 'text', content: line });
            }
          }
        });

        child.stderr.on('data', (data: Buffer) => {
          callbacks.onEvent({ type: 'text', content: data.toString() });
        });

        child.on('close', async (code) => {
          // Clean up temp file
          try { unlinkSync(tmpFile); } catch { /* ignore */ }

          // Process remaining buffer
          if (buffer.trim()) {
            try {
              const event = JSON.parse(buffer) as StreamEvent;
              if (event.type === 'assistant' && event.message?.content) {
                fullContent += extractTextFromContent(event.message.content);
              }
              callbacks.onEvent(event);
            } catch {
              callbacks.onEvent({ type: 'text', content: buffer });
            }
          }

          if (code !== 0 && code !== null) {
            callbacks.onComplete(fullContent);
            resolve({ success: false });
            return;
          }

          // Phase 3: Push changes
          callbacks.onSetup?.('Pushing changes to GitHub...');
          let commitUrl: string | undefined;
          try {
            // First, commit any uncommitted changes (Claude may or may not have committed)
            try {
              await execAsync(`cd "${workDir}" && git add -A && git diff --cached --quiet || git commit -m 'Development by CC Manager'`, { timeout: 30000 });
            } catch {
              // Ignore commit errors - there might be nothing to commit
            }

            // Always try to push (Claude commits but doesn't push)
            const pushCmd = `cd "${workDir}" && git push 2>&1 && git rev-parse HEAD`;
            const { stdout: pushOutput } = await execAsync(pushCmd, { timeout: 60000 });
            console.log(`[ClaudeService] Push output: ${pushOutput}`);

            const lines = pushOutput.trim().split('\n');
            const commitHash = lines.find(line => /^[a-f0-9]{40}$/.test(line.trim()));

            if (commitHash && this.githubRepo) {
              const baseUrl = this.githubRepo
                .replace(/^git@([^:]+):/, 'https://$1/')
                .replace(/\.git$/, '');
              commitUrl = `${baseUrl}/commit/${commitHash.trim()}`;
              callbacks.onCommit?.(commitUrl);
              console.log(`[ClaudeService] Commit URL: ${commitUrl}`);
            }
          } catch (pushErr) {
            // Push might fail if no changes or SSH/network issues
            console.error(`[ClaudeService] Push failed:`, pushErr instanceof Error ? pushErr.message : pushErr);
          }

          callbacks.onComplete(fullContent);
          resolve({ success: true, commitUrl });
        });

        child.on('error', (err) => {
          // Clean up temp file on error
          try { unlinkSync(tmpFile); } catch { /* ignore */ }
          callbacks.onError(err);
          resolve({ success: false });
        });
      });
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      return { success: false };
    }
  }

  async sendMessage(message: string): Promise<ClaudeResponse> {
    if (!this.token) {
      return { success: false, error: 'Claude Code token not configured' };
    }

    try {
      // Create temp file for the prompt (preserve newlines for better formatting)
      const timestamp = Date.now();
      const tmpFile = `/tmp/claude-prompt-${timestamp}.txt`;
      const tmpScript = `/tmp/claude-run-${timestamp}.sh`;

      writeFileSync(tmpFile, message);

      // Build command with proper flags (ralph mode removed - not a valid Claude flag)

      // Shell script that pipes the prompt to Claude Code via stdin
      // This avoids command line length limits for long prompts
      const scriptContent = `#!/bin/bash
export CLAUDE_CODE_OAUTH_TOKEN="${this.token}"
cd "${this.projectPath}"
cat "${tmpFile}" | claude --dangerously-skip-permissions -p - --output-format text 2>&1
`;

      writeFileSync(tmpScript, scriptContent);
      chmodSync(tmpScript, '755');

      // Execute with timeout
      const output = execSync(tmpScript, {
        timeout: 300000, // 5 minute timeout
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf8',
      });

      // Clean up temp files
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
      try { unlinkSync(tmpScript); } catch { /* ignore */ }

      return { success: true, content: output.trim() };
    } catch (err) {
      const error = err as Error & { stderr?: string; stdout?: string; status?: number };
      console.error('[ClaudeService] sendMessage error:', {
        message: error.message,
        stderr: error.stderr,
        stdout: error.stdout,
        status: error.status,
      });
      return {
        success: false,
        error: error.stderr || error.stdout || error.message || 'Unknown error',
      };
    }
  }

  async processRequirement(userMessage: string, currentContent: string): Promise<ClaudeResponse> {
    const prompt = `You are helping update a project requirements document.

Current document content:
\`\`\`markdown
${currentContent}
\`\`\`

User input: "${userMessage}"

First, briefly explain your understanding and any suggestions you have.
Then provide the updated markdown content in a code block.
Be helpful and conversational while being concise.`;

    return this.sendMessage(prompt);
  }

  // Streaming version of sendMessage using spawn and stream-json output
  streamMessage(
    message: string,
    callbacks: StreamCallbacks
  ): { process: ChildProcess; abort: () => void } {
    if (!this.token) {
      callbacks.onError(new Error('Claude Code token not configured'));
      return { process: null as unknown as ChildProcess, abort: () => {} };
    }

    // Clean prompt
    const cleanPrompt = message.trim();

    // Build command with stream-json output format
    // Build args array for unbuffer + claude command
    // unbuffer forces line-buffered output for proper streaming
    const claudeArgs = ['--dangerously-skip-permissions', '--verbose', '-p', cleanPrompt, '--output-format', 'stream-json'];

    // Use unbuffer to force unbuffered output from claude CLI
    const child = spawn('unbuffer', ['claude', ...claudeArgs], {
      cwd: this.projectPath,
      env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: this.token },
    });

    let fullContent = '';
    let buffer = '';

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();

      // Process complete lines (JSONL format)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line) as StreamEvent;

          // Accumulate assistant content
          if (event.type === 'assistant' && event.message?.content) {
            fullContent += extractTextFromContent(event.message.content);
          }

          callbacks.onEvent(event);
        } catch {
          // Non-JSON line, emit as text
          callbacks.onEvent({ type: 'text', content: line });
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      callbacks.onEvent({ type: 'error', content: data.toString() });
    });

    child.on('error', (err: Error) => {
      callbacks.onError(err);
    });

    child.on('close', (code: number | null) => {
      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer) as StreamEvent;
          if (event.type === 'assistant' && event.message?.content) {
            fullContent += extractTextFromContent(event.message.content);
          }
          callbacks.onEvent(event);
        } catch {
          callbacks.onEvent({ type: 'text', content: buffer });
        }
      }

      if (code !== 0 && code !== null) {
        callbacks.onError(new Error(`Process exited with code ${code}`));
      } else {
        callbacks.onComplete(fullContent);
      }
    });

    return {
      process: child,
      abort: () => {
        child.kill('SIGTERM');
      }
    };
  }

  // Streaming version of processRequirement
  streamProcessRequirement(
    userMessage: string,
    currentContent: string,
    callbacks: StreamCallbacks
  ): { process: ChildProcess; abort: () => void } {
    const prompt = `You are helping update a project requirements document.

Current document content:
\`\`\`markdown
${currentContent}
\`\`\`

User input: "${userMessage}"

First, briefly explain your understanding and any suggestions you have.
Then provide the updated markdown content in a code block.
Be helpful and conversational while being concise.`;

    return this.streamMessage(prompt, callbacks);
  }

  async analyzePRD(prdContent: string): Promise<ClaudeResponse> {
    const prompt = `Analyze this Product Requirements Document and break it down into development tasks.

PRD Content:
\`\`\`markdown
${prdContent}
\`\`\`

Extract specific, actionable development tasks from this PRD.
Return ONLY a valid JSON array of tasks, with no additional text before or after.

Each task should have:
- "title": A short, clear task title (max 100 chars)
- "description": Detailed description of what needs to be done
- "dependencies": Array of task TITLES that must be completed before this task (empty array if none)

IMPORTANT: Identify dependencies based on:
1. Data model requirements (create model/schema before using it)
2. API dependencies (backend API before frontend that calls it)
3. Shared utilities (create helpers/utils before features using them)
4. Testing infrastructure (setup test framework before specific tests)
5. Configuration (setup config before features needing it)

Example format:
[
  {"title": "Set up project structure", "description": "Initialize the project with necessary folders and configuration files", "dependencies": []},
  {"title": "Create database schema", "description": "Define MongoDB models for users and posts", "dependencies": ["Set up project structure"]},
  {"title": "Create user authentication API", "description": "Implement login/signup endpoints with JWT tokens", "dependencies": ["Create database schema"]},
  {"title": "Build login page", "description": "Create React login form component", "dependencies": ["Create user authentication API"]}
]

Return ONLY the JSON array, no markdown code blocks, no explanations.`;

    return this.sendMessage(prompt);
  }

  async developTask(
    taskTitle: string,
    taskDescription: string,
    prdContent: string,
    branchName?: string
  ): Promise<ClaudeResponse> {
    const branchInstruction = branchName
      ? `\nBRANCH: You are working on branch "${branchName}". Make sure you are on this branch before making changes.`
      : '';

    const prompt = `You are developing a feature for a project.

TASK: ${taskTitle}
DESCRIPTION: ${taskDescription}${branchInstruction}

PROJECT REQUIREMENTS (for context):
${prdContent}

MANDATORY REQUIREMENTS:
1. Implement this task with production-quality code
2. Write comprehensive unit tests with 100% code coverage
3. Use the project's existing test framework (vitest, jest, etc.) or set one up if none exists
4. Run tests and verify they pass before committing
5. Commit with message: "feat: ${taskTitle}"

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
4. If tests fail, fix the issues
5. Run: npm run test:coverage (if available) to verify coverage
6. Stage and commit all changes

Focus only on this specific task. Be thorough but concise.`;

    return this.sendMessage(prompt);
  }

  async commitChanges(taskTitle: string): Promise<ClaudeResponse> {
    const prompt = `Stage all changes and commit them with message: "feat: ${taskTitle}"

If there are no changes to commit, just say "No changes to commit".
Do not push to remote.`;

    return this.sendMessage(prompt);
  }

  async runUnitTests(): Promise<ClaudeResponse> {
    const prompt = `Run unit tests for this project.

Look for test scripts in package.json (npm test, npm run test, etc.) or other test runners.
If no tests exist, set up a basic test framework appropriate for the project.
Report test results - pass/fail count and any errors.`;

    return this.sendMessage(prompt);
  }

  async runE2ETests(): Promise<ClaudeResponse> {
    const prompt = `Run E2E tests for this project.

Steps:
1. Check if there's a docker-compose.test.yml or similar test configuration
2. If not, create a basic E2E test setup with playwright or cypress
3. Run the E2E tests
4. Report test results and any failures.`;

    return this.sendMessage(prompt);
  }

  // Streaming development on a specific feature branch (for parallel execution)
  async streamDockerDevelopOnBranch(
    prompt: string,
    branchName: string,
    callbacks: StreamCallbacks & {
      onSetup?: (phase: string) => void;
      onCommit?: (commitUrl: string) => void;
    },
    options: { freshClone?: boolean; workDir?: string } = {}
  ): Promise<{ success: boolean; commitUrl?: string }> {
    if (!this.token) {
      callbacks.onError(new Error('Claude Code token not configured'));
      return { success: false };
    }

    if (!this.githubRepo) {
      callbacks.onError(new Error('GitHub repo not configured'));
      return { success: false };
    }

    // Extract repo name from URL for workspace directory
    const repoMatch = this.githubRepo.match(/\/([^\/]+?)(\.git)?$/);
    const repoName = repoMatch ? repoMatch[1] : 'repo';
    // Use unique work directory per branch to allow parallel execution
    const workDir = options.workDir || `/workspace/${repoName}-${branchName.replace(/\//g, '-')}`;

    try {
      // Phase 1: Clone repository to unique directory
      callbacks.onSetup?.(`Preparing branch ${branchName}...`);
      console.log(`[ClaudeService] Stream development on branch ${branchName} in: ${workDir}`);

      let repoExists = false;
      try {
        await execAsync(`test -d "${workDir}/.git"`, { timeout: 5000 });
        repoExists = true;
      } catch {
        repoExists = false;
      }

      if (!repoExists || options.freshClone) {
        console.log(`[ClaudeService] Cloning repository for branch ${branchName}...`);
        callbacks.onSetup?.('Cloning repository...');
        await execAsync(`rm -rf "${workDir}" && git clone ${this.githubRepo} "${workDir}"`, { timeout: 120000 });
      }

      // Create or checkout the feature branch
      callbacks.onSetup?.(`Checking out branch ${branchName}...`);
      try {
        // Try to checkout existing branch first
        await execAsync(`cd "${workDir}" && git fetch origin && git checkout ${branchName}`, { timeout: 30000 });
        console.log(`[ClaudeService] Checked out existing branch: ${branchName}`);
      } catch {
        // Branch doesn't exist, create it from main/master
        console.log(`[ClaudeService] Creating new branch: ${branchName}`);
        await execAsync(`cd "${workDir}" && git checkout -b ${branchName}`, { timeout: 30000 });
      }

      // Phase 2: Write prompt to file and run Claude Code with streaming
      callbacks.onSetup?.('Running Claude Code...');
      const timestamp = Date.now();
      const tmpFile = `/tmp/claude-stream-prompt-${timestamp}.txt`;
      writeFileSync(tmpFile, prompt);

      // Spawn Claude Code with streaming output
      return new Promise((resolve) => {
        let fullContent = '';
        let buffer = '';

        const child = spawn('bash', ['-c', `
          export CLAUDE_CODE_OAUTH_TOKEN="${this.token}"
          cd "${workDir}"
          cat "${tmpFile}" | claude --dangerously-skip-permissions --verbose -p - --output-format stream-json 2>&1
        `]);

        child.stdout.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line) as StreamEvent;
              if (event.type === 'assistant' && event.message?.content) {
                fullContent += extractTextFromContent(event.message.content);
              }
              callbacks.onEvent(event);
            } catch {
              callbacks.onEvent({ type: 'text', content: line });
            }
          }
        });

        child.stderr.on('data', (data: Buffer) => {
          callbacks.onEvent({ type: 'text', content: data.toString() });
        });

        child.on('close', async (code) => {
          // Clean up temp file
          try { unlinkSync(tmpFile); } catch { /* ignore */ }

          // Process remaining buffer
          if (buffer.trim()) {
            try {
              const event = JSON.parse(buffer) as StreamEvent;
              if (event.type === 'assistant' && event.message?.content) {
                fullContent += extractTextFromContent(event.message.content);
              }
              callbacks.onEvent(event);
            } catch {
              callbacks.onEvent({ type: 'text', content: buffer });
            }
          }

          if (code !== 0 && code !== null) {
            callbacks.onComplete(fullContent);
            resolve({ success: false });
            return;
          }

          // Phase 3: Push the feature branch
          callbacks.onSetup?.(`Pushing branch ${branchName}...`);
          let commitUrl: string | undefined;
          try {
            // Commit any uncommitted changes
            try {
              await execAsync(`cd "${workDir}" && git add -A && git diff --cached --quiet || git commit -m 'Development by CC Manager'`, { timeout: 30000 });
            } catch {
              // Ignore commit errors
            }

            // Push the feature branch
            const pushCmd = `cd "${workDir}" && git push -u origin ${branchName} 2>&1 && git rev-parse HEAD`;
            const { stdout: pushOutput } = await execAsync(pushCmd, { timeout: 60000 });
            console.log(`[ClaudeService] Push output for ${branchName}: ${pushOutput}`);

            const lines = pushOutput.trim().split('\n');
            const commitHash = lines.find(line => /^[a-f0-9]{40}$/.test(line.trim()));

            if (commitHash && this.githubRepo) {
              const baseUrl = this.githubRepo
                .replace(/^git@([^:]+):/, 'https://$1/')
                .replace(/\.git$/, '');
              commitUrl = `${baseUrl}/commit/${commitHash.trim()}`;
              callbacks.onCommit?.(commitUrl);
              console.log(`[ClaudeService] Branch ${branchName} commit URL: ${commitUrl}`);
            }
          } catch (pushErr) {
            console.error(`[ClaudeService] Push failed for branch ${branchName}:`, pushErr instanceof Error ? pushErr.message : pushErr);
          }

          callbacks.onComplete(fullContent);
          resolve({ success: true, commitUrl });
        });

        child.on('error', (err) => {
          try { unlinkSync(tmpFile); } catch { /* ignore */ }
          callbacks.onError(err);
          resolve({ success: false });
        });
      });
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      return { success: false };
    }
  }

  // Merge a feature branch into main
  async mergeBranchToMain(
    branchName: string,
    workDir?: string
  ): Promise<{ success: boolean; error?: string; commitUrl?: string }> {
    const repoMatch = this.githubRepo.match(/\/([^\/]+?)(\.git)?$/);
    const repoName = repoMatch ? repoMatch[1] : 'repo';
    const dir = workDir || `/workspace/${repoName}`;

    try {
      console.log(`[ClaudeService] Merging branch ${branchName} into main...`);

      // Checkout main and pull latest
      await execAsync(`cd "${dir}" && git checkout main || git checkout master`, { timeout: 30000 });
      await execAsync(`cd "${dir}" && git pull origin main || git pull origin master`, { timeout: 60000 });

      // Fetch the feature branch from remote (it was pushed during parallel development)
      console.log(`[ClaudeService] Fetching branch ${branchName} from remote...`);
      await execAsync(`cd "${dir}" && git fetch origin ${branchName}`, { timeout: 60000 });

      // Delete local branch if exists, then create fresh from remote
      try {
        await execAsync(`cd "${dir}" && git branch -D ${branchName}`, { timeout: 10000 });
      } catch {
        // Branch might not exist locally, ignore
      }
      await execAsync(`cd "${dir}" && git checkout -b ${branchName} origin/${branchName}`, { timeout: 30000 });

      // Rebase feature branch onto latest main to incorporate previous merges
      console.log(`[ClaudeService] Rebasing ${branchName} onto main...`);
      try {
        await execAsync(`cd "${dir}" && git rebase main`, { timeout: 120000 });
      } catch (rebaseErr) {
        // If rebase fails, abort and use Claude to resolve conflicts
        console.log(`[ClaudeService] Rebase failed, using Claude to resolve conflicts...`);
        await execAsync(`cd "${dir}" && git rebase --abort`, { timeout: 10000 }).catch(() => {});
        await execAsync(`cd "${dir}" && git checkout main || git checkout master`, { timeout: 30000 });

        // Start merge (will have conflicts)
        try {
          await execAsync(`cd "${dir}" && git merge --no-commit ${branchName}`, { timeout: 60000 });
        } catch {
          // Expected to fail with conflicts, continue
        }

        // Get list of conflicting files
        const { stdout: conflictFiles } = await execAsync(
          `cd "${dir}" && git diff --name-only --diff-filter=U`,
          { timeout: 10000 }
        );
        const conflicts = conflictFiles.trim().split('\n').filter(f => f.trim());

        if (conflicts.length > 0) {
          console.log(`[ClaudeService] Resolving ${conflicts.length} conflicting files with Claude...`);

          // Use Claude to resolve each conflict
          for (const file of conflicts) {
            const { stdout: conflictContent } = await execAsync(
              `cd "${dir}" && cat "${file}"`,
              { timeout: 10000 }
            );

            // Call Claude to resolve the conflict
            const resolvedContent = await this.resolveConflictWithClaude(file, conflictContent);

            // Write resolved content
            const fs = await import('fs/promises');
            await fs.writeFile(`${dir}/${file}`, resolvedContent);

            // Stage the resolved file
            await execAsync(`cd "${dir}" && git add "${file}"`, { timeout: 10000 });
          }

          // Commit the merge
          await execAsync(
            `cd "${dir}" && git commit -m "Merge ${branchName} (conflicts resolved by Claude)"`,
            { timeout: 30000 }
          );
        } else {
          // No conflicts, just commit
          await execAsync(`cd "${dir}" && git commit -m "Merge ${branchName}"`, { timeout: 30000 });
        }

        // Push and return
        const { stdout: pushOutput } = await execAsync(`cd "${dir}" && git push && git rev-parse HEAD`, { timeout: 60000 });
        const lines = pushOutput.trim().split('\n');
        const commitHash = lines.find(line => /^[a-f0-9]{40}$/.test(line.trim()));

        let commitUrl: string | undefined;
        if (commitHash && this.githubRepo) {
          const baseUrl = this.githubRepo
            .replace(/^git@([^:]+):/, 'https://$1/')
            .replace(/\.git$/, '');
          commitUrl = `${baseUrl}/commit/${commitHash.trim()}`;
        }

        // Cleanup
        try {
          await execAsync(`cd "${dir}" && git branch -d ${branchName}`, { timeout: 30000 });
          await execAsync(`cd "${dir}" && git push origin --delete ${branchName}`, { timeout: 30000 });
        } catch { /* ignore */ }

        console.log(`[ClaudeService] Successfully merged ${branchName} with Claude conflict resolution`);
        return { success: true, commitUrl };
      }

      // Push rebased branch
      console.log(`[ClaudeService] Pushing rebased branch ${branchName}...`);
      await execAsync(`cd "${dir}" && git push -f origin ${branchName}`, { timeout: 60000 });

      // Checkout main and merge
      console.log(`[ClaudeService] Checking out main and merging ${branchName}...`);
      await execAsync(`cd "${dir}" && git checkout main || git checkout master`, { timeout: 30000 });

      // Try the merge - might have conflicts if other branches were merged first
      try {
        const mergeCmd = `cd "${dir}" && git merge --no-ff ${branchName} -m "Merge ${branchName}"`;
        await execAsync(mergeCmd, { timeout: 60000 });
      } catch (mergeErr) {
        // Merge failed - check for conflicts and resolve with Claude
        console.log(`[ClaudeService] Post-rebase merge failed, checking for conflicts...`);
        const { stdout: conflictFiles } = await execAsync(
          `cd "${dir}" && git diff --name-only --diff-filter=U`,
          { timeout: 10000 }
        );
        const conflicts = conflictFiles.trim().split('\n').filter(f => f.trim());

        if (conflicts.length > 0) {
          console.log(`[ClaudeService] Resolving ${conflicts.length} post-rebase conflicts with Claude...`);
          for (const file of conflicts) {
            const { stdout: conflictContent } = await execAsync(`cd "${dir}" && cat "${file}"`, { timeout: 10000 });
            const resolvedContent = await this.resolveConflictWithClaude(file, conflictContent);
            const fs = await import('fs/promises');
            await fs.writeFile(`${dir}/${file}`, resolvedContent);
            await execAsync(`cd "${dir}" && git add "${file}"`, { timeout: 10000 });
          }
          // Commit the resolved merge
          await execAsync(
            `cd "${dir}" && git commit -m "Merge ${branchName} (conflicts resolved by Claude)"`,
            { timeout: 30000 }
          );
        } else {
          // No conflicts but merge failed for another reason - rethrow
          throw mergeErr;
        }
      }

      // Push the merge
      console.log(`[ClaudeService] Pushing merge to remote...`);
      const { stdout: pushOutput } = await execAsync(`cd "${dir}" && git push && git rev-parse HEAD`, { timeout: 60000 });
      const lines = pushOutput.trim().split('\n');
      const commitHash = lines.find(line => /^[a-f0-9]{40}$/.test(line.trim()));

      let commitUrl: string | undefined;
      if (commitHash && this.githubRepo) {
        const baseUrl = this.githubRepo
          .replace(/^git@([^:]+):/, 'https://$1/')
          .replace(/\.git$/, '');
        commitUrl = `${baseUrl}/commit/${commitHash.trim()}`;
      }

      // Delete the feature branch (local and remote)
      try {
        await execAsync(`cd "${dir}" && git branch -d ${branchName}`, { timeout: 30000 });
        await execAsync(`cd "${dir}" && git push origin --delete ${branchName}`, { timeout: 30000 });
      } catch {
        // Ignore branch deletion errors
      }

      console.log(`[ClaudeService] Successfully merged ${branchName} into main`);
      return { success: true, commitUrl };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[ClaudeService] Merge failed for ${branchName}:`, error);
      return { success: false, error };
    }
  }

  // Use Claude to resolve merge conflicts
  private async resolveConflictWithClaude(filename: string, conflictContent: string): Promise<string> {
    console.log(`[ClaudeService] Asking Claude to resolve conflict in ${filename}...`);

    const prompt = `You are resolving a git merge conflict. The file "${filename}" has the following content with conflict markers:

\`\`\`
${conflictContent}
\`\`\`

Please resolve this merge conflict by:
1. Understanding what both versions are trying to accomplish
2. Combining the changes intelligently - keep ALL functionality from both sides
3. If there are duplicate functions or code blocks, merge them properly
4. Remove all conflict markers (<<<<<<, =======, >>>>>>>)

Return ONLY the resolved file content, no explanations. The output should be valid, working code.`;

    try {
      console.log(`[ClaudeService] Running Claude to resolve conflict in ${filename}...`);
      console.log(`[ClaudeService] Token available: ${!!this.token}`);

      const result = await this.runClaudeCommand(prompt, {
        timeout: 60000,
        maxTokens: 8000,
      });

      console.log(`[ClaudeService] Claude returned ${result.length} chars for ${filename}`);

      // Clean up the response - remove markdown code blocks if present
      let resolved = result.trim();
      if (resolved.startsWith('```')) {
        const lines = resolved.split('\n');
        lines.shift(); // Remove first ```
        if (lines[lines.length - 1] === '```') {
          lines.pop(); // Remove last ```
        }
        resolved = lines.join('\n');
      }

      console.log(`[ClaudeService] Conflict in ${filename} resolved successfully`);
      return resolved;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[ClaudeService] Failed to resolve conflict in ${filename}:`, errorMsg);
      console.error(`[ClaudeService] Falling back to 'theirs' strategy for ${filename}`);
      // Fall back to keeping the incoming changes (theirs)
      return conflictContent
        .replace(/<<<<<<< HEAD[\s\S]*?=======/g, '')
        .replace(/>>>>>>> .*/g, '');
    }
  }

  // Run a simple Claude command and get the response
  private async runClaudeCommand(prompt: string, options?: { timeout?: number; maxTokens?: number }): Promise<string> {
    const repoMatch = this.githubRepo.match(/\/([^\/]+?)(\.git)?$/);
    const repoName = repoMatch ? repoMatch[1] : 'repo';
    const dir = `/workspace/${repoName}`;

    return new Promise((resolve, reject) => {
      const claudeArgs = [
        '--dangerously-skip-permissions',
        '-p', prompt,
        '--output-format', 'text',
        '--max-turns', '1'
      ];

      const child = spawn('unbuffer', ['claude', ...claudeArgs], {
        cwd: dir,
        env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: this.token },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Claude command timed out'));
      }, options?.timeout || 120000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Claude exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  // Code review and quality check
  async reviewCode(
    taskTitle: string,
    taskDescription: string,
    projectRequirements: string,
    callbacks: {
      onProgress?: (message: string) => void;
      onResult?: (result: CodeReviewResult) => void;
    }
  ): Promise<CodeReviewResult> {
    if (!this.token) {
      return { success: false, qualityScore: 0, passed: false, error: 'Claude Code token not configured' };
    }

    if (!this.githubRepo) {
      return { success: false, qualityScore: 0, passed: false, error: 'GitHub repo not configured' };
    }

    const repoMatch = this.githubRepo.match(/\/([^\/]+?)(\.git)?$/);
    const repoName = repoMatch ? repoMatch[1] : 'repo';
    const workDir = `/workspace/${repoName}`;

    try {
      callbacks.onProgress?.('Starting code review...');

      // Pull latest changes
      await execAsync(`cd "${workDir}" && git pull origin main || git pull origin master`, { timeout: 60000 });

      const prompt = `You are a senior code reviewer. Review the code in this repository for a specific task.

TASK: ${taskTitle}
DESCRIPTION: ${taskDescription || 'No description provided'}

PROJECT REQUIREMENTS:
${projectRequirements}

REVIEW INSTRUCTIONS:
1. Find and read the files related to this task
2. Check if the implementation matches the task requirements
3. Evaluate code quality on these criteria:
   - Code correctness and completeness
   - Error handling
   - Code readability and maintainability
   - Best practices and patterns
   - Test coverage (if tests exist)
   - Security considerations

4. Provide a quality score from 0-10 (one decimal place)
5. List any issues found
6. If score < 9.5, suggest specific improvements

IMPORTANT: At the end of your review, output a JSON block in this exact format:
\`\`\`json
{
  "qualityScore": 9.5,
  "passed": true,
  "issues": ["issue 1", "issue 2"],
  "suggestions": ["suggestion 1"],
  "summary": "Brief summary of the review"
}
\`\`\`

The "passed" field should be true if qualityScore >= 9.5, false otherwise.`;

      callbacks.onProgress?.('Running Claude code review...');

      const timestamp = Date.now();
      const tmpFile = `/tmp/claude-review-${timestamp}.txt`;
      writeFileSync(tmpFile, prompt);

      return new Promise((resolve) => {
        let fullOutput = '';

        const child = spawn('bash', ['-c', `
          export CLAUDE_CODE_OAUTH_TOKEN="${this.token}"
          cd "${workDir}"
          cat "${tmpFile}" | claude --dangerously-skip-permissions -p - --output-format text 2>&1
        `]);

        child.stdout.on('data', (chunk: Buffer) => {
          fullOutput += chunk.toString();
        });

        child.stderr.on('data', (data: Buffer) => {
          fullOutput += data.toString();
        });

        child.on('close', (code) => {
          try { unlinkSync(tmpFile); } catch { /* ignore */ }

          callbacks.onProgress?.('Parsing review results...');

          // Parse the JSON result from the output
          const jsonMatch = fullOutput.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            try {
              const result = JSON.parse(jsonMatch[1]) as {
                qualityScore: number;
                passed: boolean;
                issues: string[];
                suggestions: string[];
                summary: string;
              };

              const reviewResult: CodeReviewResult = {
                success: true,
                qualityScore: result.qualityScore,
                passed: result.passed,
                issues: result.issues,
                suggestions: result.suggestions,
                summary: result.summary,
                fullReview: fullOutput,
              };

              callbacks.onResult?.(reviewResult);
              resolve(reviewResult);
              return;
            } catch (parseErr) {
              console.error('[ClaudeService] Failed to parse review JSON:', parseErr);
            }
          }

          // If no valid JSON found, try to extract score from text
          const scoreMatch = fullOutput.match(/(?:quality\s*score|score)[:\s]*(\d+(?:\.\d+)?)/i);
          const score = scoreMatch ? parseFloat(scoreMatch[1]) : 5.0;

          const reviewResult: CodeReviewResult = {
            success: code === 0,
            qualityScore: score,
            passed: score >= 9.5,
            fullReview: fullOutput,
            summary: 'Review completed but could not parse structured result',
          };

          callbacks.onResult?.(reviewResult);
          resolve(reviewResult);
        });

        child.on('error', (err) => {
          try { unlinkSync(tmpFile); } catch { /* ignore */ }
          resolve({
            success: false,
            qualityScore: 0,
            passed: false,
            error: err.message,
          });
        });
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error('[ClaudeService] Code review failed:', error);
      return { success: false, qualityScore: 0, passed: false, error };
    }
  }

  // Fix code quality issues
  async fixCodeQuality(
    taskTitle: string,
    issues: string[],
    suggestions: string[],
    callbacks: {
      onProgress?: (message: string) => void;
    }
  ): Promise<{ success: boolean; commitUrl?: string; error?: string }> {
    if (!this.token || !this.githubRepo) {
      return { success: false, error: 'Not configured' };
    }

    const repoMatch = this.githubRepo.match(/\/([^\/]+?)(\.git)?$/);
    const repoName = repoMatch ? repoMatch[1] : 'repo';
    const workDir = `/workspace/${repoName}`;

    const prompt = `Fix the following code quality issues for task: ${taskTitle}

ISSUES TO FIX:
${issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

SUGGESTIONS TO IMPLEMENT:
${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Instructions:
1. Read the relevant files
2. Fix all the issues listed above
3. Implement the suggestions where appropriate
4. Ensure code quality is excellent (target: 9.5+/10)
5. Run tests if they exist
6. Commit your changes with message: "fix: improve code quality for ${taskTitle}"`;

    callbacks.onProgress?.('Fixing code quality issues...');

    const timestamp = Date.now();
    const tmpFile = `/tmp/claude-fix-${timestamp}.txt`;
    writeFileSync(tmpFile, prompt);

    return new Promise((resolve) => {
      const child = spawn('bash', ['-c', `
        export CLAUDE_CODE_OAUTH_TOKEN="${this.token}"
        cd "${workDir}"
        cat "${tmpFile}" | claude --dangerously-skip-permissions -p - --output-format text 2>&1
      `]);

      child.on('close', async (code) => {
        try { unlinkSync(tmpFile); } catch { /* ignore */ }

        if (code !== 0) {
          resolve({ success: false, error: 'Claude fix failed' });
          return;
        }

        // Push the fixes
        callbacks.onProgress?.('Pushing fixes...');
        try {
          await execAsync(`cd "${workDir}" && git add -A && git diff --cached --quiet || git commit -m 'fix: improve code quality for ${taskTitle}'`, { timeout: 30000 });
          const { stdout: pushOutput } = await execAsync(`cd "${workDir}" && git push && git rev-parse HEAD`, { timeout: 60000 });

          const lines = pushOutput.trim().split('\n');
          const commitHash = lines.find(line => /^[a-f0-9]{40}$/.test(line.trim()));

          let commitUrl: string | undefined;
          if (commitHash && this.githubRepo) {
            const baseUrl = this.githubRepo
              .replace(/^git@([^:]+):/, 'https://$1/')
              .replace(/\.git$/, '');
            commitUrl = `${baseUrl}/commit/${commitHash.trim()}`;
          }

          resolve({ success: true, commitUrl });
        } catch (pushErr) {
          resolve({ success: false, error: 'Failed to push fixes' });
        }
      });

      child.on('error', (err) => {
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
        resolve({ success: false, error: err.message });
      });
    });
  }

  async deployToNas(projectName: string, targetPath: string): Promise<ClaudeResponse> {
    const prompt = `Deploy the project to ${targetPath}/${projectName}

Steps:
1. Build the project if it has a build step (npm run build, etc.)
2. Copy the necessary files to ${targetPath}/${projectName}
3. If there's a docker-compose.yml, run: cd ${targetPath}/${projectName} && docker compose up -d --build

Report what you did and any errors encountered.`;

    return this.sendMessage(prompt);
  }

  stop(): void {
    // No-op: execSync is synchronous, no process to stop
  }
}

// Factory function for creating service instances
export const createClaudeService = (config?: Partial<ClaudeConfig>): ClaudeService => {
  return new ClaudeService({
    token: config?.token || CLAUDE_CODE_TOKEN,
    projectPath: config?.projectPath,
    ralphMode: config?.ralphMode,
    githubRepo: config?.githubRepo,
  });
};

// Mock service for testing/development without Claude Code
export class MockClaudeService extends ClaudeService {
  async sendMessage(message: string): Promise<ClaudeResponse> {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      success: true,
      content: `[Mock Response] Processed: "${message.substring(0, 50)}..."`,
    };
  }

  async processRequirement(userMessage: string, currentContent: string): Promise<ClaudeResponse> {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const updatedContent = currentContent
      ? `${currentContent}\n\n## New Input\n- ${userMessage}`
      : `# Project Requirements\n\n## Initial Input\n- ${userMessage}`;
    return { success: true, content: updatedContent };
  }

  async spawnDockerAndDevelop(prompt: string): Promise<ClaudeResponse> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    console.log(`[MockClaudeService] Simulating development for prompt: ${prompt.substring(0, 50)}...`);
    return {
      success: true,
      content: `[Mock] Development completed for: ${prompt.substring(0, 50)}...`,
    };
  }

  async killContainer(): Promise<void> {
    console.log(`[MockClaudeService] Simulating container cleanup`);
  }
}
