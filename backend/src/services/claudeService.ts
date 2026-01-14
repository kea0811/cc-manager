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

export interface StreamEvent {
  type: StreamEventType;
  content?: string;
  message?: { content: string };
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  subtype?: string;
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

    const containerName = `claude-dev-${Date.now()}`;
    const workDir = '/workspace';

    try {
      console.log(`[ClaudeService] Starting Docker container: ${containerName}`);
      console.log(`[ClaudeService] Repo: ${this.githubRepo}`);

      // Create and start container with node:20 base image
      // Mount SSH keys and claude-project directory
      const dockerRunCmd = `docker run -d --name ${containerName} \
        -e CLAUDE_CODE_OAUTH_TOKEN="${this.token}" \
        -v /var/services/homes/eran/.ssh:/root/.ssh:ro \
        -v /volume1/docker/claude-project:/volume1/docker/claude-project \
        node:20 \
        tail -f /dev/null`;

      console.log(`[ClaudeService] Creating container...`);
      const { stdout: containerId } = await execAsync(dockerRunCmd);
      this.containerId = containerId.trim();
      console.log(`[ClaudeService] Container ID: ${this.containerId}`);

      // Install git and Claude Code in container
      console.log(`[ClaudeService] Installing dependencies...`);
      await execAsync(`docker exec ${containerName} apt-get update`, { timeout: 120000 });
      await execAsync(`docker exec ${containerName} apt-get install -y git openssh-client`, { timeout: 120000 });
      await execAsync(`docker exec ${containerName} npm install -g @anthropic-ai/claude-code`, { timeout: 180000 });

      // Configure git
      await execAsync(`docker exec ${containerName} git config --global user.email "cc-manager@localhost"`);
      await execAsync(`docker exec ${containerName} git config --global user.name "CC Manager"`);

      // Add GitHub to known hosts
      await execAsync(`docker exec ${containerName} sh -c "mkdir -p /root/.ssh && ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null"`);

      // Clone the repository
      console.log(`[ClaudeService] Cloning repository...`);
      await execAsync(`docker exec ${containerName} git clone ${this.githubRepo} ${workDir}`, { timeout: 120000 });
      console.log(`[ClaudeService] Clone successful`);

      // Escape the prompt for shell
      const escapedPrompt = prompt.replace(/'/g, "'\\''");

      // Run Claude Code inside the container
      console.log(`[ClaudeService] Running Claude Code...`);
      const claudeCmd = `cd ${workDir} && claude --dangerously-skip-permissions -p '${escapedPrompt}' --output-format text 2>&1`;

      const { stdout: output } = await execAsync(
        `docker exec -e CLAUDE_CODE_OAUTH_TOKEN="${this.token}" ${containerName} bash -c "${claudeCmd}"`,
        { maxBuffer: 10 * 1024 * 1024, timeout: 600000 }
      );
      console.log(`[ClaudeService] Claude Code completed`);

      // Push changes to GitHub and capture commit hash
      console.log(`[ClaudeService] Pushing changes to GitHub...`);
      let commitUrl: string | undefined;
      try {
        // Stage, commit, push, and get commit hash
        const pushCmd = `cd ${workDir} && git add -A && git diff --cached --quiet || (git commit -m 'Development by CC Manager' && git push && git rev-parse HEAD)`;
        const { stdout: pushOutput } = await execAsync(`docker exec ${containerName} bash -c "${pushCmd}"`, { timeout: 60000 });
        console.log(`[ClaudeService] Push successful`);

        // Extract commit hash from output (last line with 40 char hex)
        const lines = pushOutput.trim().split('\n');
        const commitHash = lines.find(line => /^[a-f0-9]{40}$/.test(line.trim()));

        if (commitHash && this.githubRepo) {
          // Convert SSH URL to HTTPS commit URL
          // git@github.com:user/repo.git -> https://github.com/user/repo/commit/hash
          let baseUrl = this.githubRepo
            .replace(/^git@([^:]+):/, 'https://$1/')
            .replace(/\.git$/, '');
          commitUrl = `${baseUrl}/commit/${commitHash.trim()}`;
          console.log(`[ClaudeService] Commit URL: ${commitUrl}`);
        }
      } catch (pushErr) {
        console.log(`[ClaudeService] Push skipped or failed:`, pushErr instanceof Error ? pushErr.message : pushErr);
      }

      return { success: true, content: output.trim(), containerId: this.containerId, commitUrl };
    } catch (err) {
      console.error(`[ClaudeService] Error:`, err instanceof Error ? err.message : err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        containerId: this.containerId || undefined,
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

  // Streaming version of Docker development
  async streamDockerDevelop(
    prompt: string,
    containerName: string,
    callbacks: StreamCallbacks & {
      onSetup?: (phase: string) => void;
      onCommit?: (commitUrl: string) => void;
    }
  ): Promise<{ success: boolean; commitUrl?: string }> {
    if (!this.token) {
      callbacks.onError(new Error('Claude Code token not configured'));
      return { success: false };
    }

    if (!this.githubRepo) {
      callbacks.onError(new Error('GitHub repo not configured'));
      return { success: false };
    }

    const workDir = '/workspace';

    try {
      // Phase 1: Create container
      callbacks.onSetup?.('Creating Docker container...');
      const dockerRunCmd = `docker run -d --name ${containerName} \
        -e CLAUDE_CODE_OAUTH_TOKEN="${this.token}" \
        -v /var/services/homes/eran/.ssh:/root/.ssh:ro \
        -v /volume1/docker/claude-project:/volume1/docker/claude-project \
        node:20 \
        tail -f /dev/null`;

      const { stdout: containerId } = await execAsync(dockerRunCmd);
      this.containerId = containerId.trim();

      // Phase 2: Install dependencies
      callbacks.onSetup?.('Installing git and Claude Code...');
      await execAsync(`docker exec ${containerName} apt-get update`, { timeout: 120000 });
      await execAsync(`docker exec ${containerName} apt-get install -y git openssh-client`, { timeout: 120000 });
      await execAsync(`docker exec ${containerName} npm install -g @anthropic-ai/claude-code`, { timeout: 180000 });

      // Configure git
      await execAsync(`docker exec ${containerName} git config --global user.email "cc-manager@localhost"`);
      await execAsync(`docker exec ${containerName} git config --global user.name "CC Manager"`);
      await execAsync(`docker exec ${containerName} sh -c "mkdir -p /root/.ssh && ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null"`);

      // Phase 3: Clone repository
      callbacks.onSetup?.('Cloning repository...');
      await execAsync(`docker exec ${containerName} git clone ${this.githubRepo} ${workDir}`, { timeout: 120000 });

      // Phase 4: Run Claude Code with streaming
      callbacks.onSetup?.('Running Claude Code...');

      // Write prompt to a file in the container to avoid shell escaping issues
      const escapedPrompt = prompt.replace(/'/g, "'\\''").replace(/"/g, '\\"');
      await execAsync(`docker exec ${containerName} bash -c "cat > /tmp/prompt.txt << 'PROMPT_EOF'\n${prompt}\nPROMPT_EOF"`);

      // Spawn Claude Code with streaming output
      return new Promise((resolve) => {
        let fullContent = '';
        let buffer = '';

        const child = spawn('docker', [
          'exec', '-e', `CLAUDE_CODE_OAUTH_TOKEN=${this.token}`,
          containerName, 'bash', '-c',
          `cd ${workDir} && claude --dangerously-skip-permissions -p "$(cat /tmp/prompt.txt)" --output-format stream-json 2>&1`
        ]);

        child.stdout.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line) as StreamEvent;
              if (event.type === 'assistant' && event.message?.content) {
                fullContent += event.message.content;
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
          // Process remaining buffer
          if (buffer.trim()) {
            try {
              const event = JSON.parse(buffer) as StreamEvent;
              if (event.type === 'assistant' && event.message?.content) {
                fullContent += event.message.content;
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

          // Phase 5: Push changes
          callbacks.onSetup?.('Pushing changes to GitHub...');
          let commitUrl: string | undefined;
          try {
            const pushCmd = `cd ${workDir} && git add -A && git diff --cached --quiet || (git commit -m 'Development by CC Manager' && git push && git rev-parse HEAD)`;
            const { stdout: pushOutput } = await execAsync(`docker exec ${containerName} bash -c "${pushCmd}"`, { timeout: 60000 });

            const lines = pushOutput.trim().split('\n');
            const commitHash = lines.find(line => /^[a-f0-9]{40}$/.test(line.trim()));

            if (commitHash && this.githubRepo) {
              const baseUrl = this.githubRepo
                .replace(/^git@([^:]+):/, 'https://$1/')
                .replace(/\.git$/, '');
              commitUrl = `${baseUrl}/commit/${commitHash.trim()}`;
              callbacks.onCommit?.(commitUrl);
            }
          } catch {
            // Push might fail if no changes
          }

          callbacks.onComplete(fullContent);
          resolve({ success: true, commitUrl });
        });

        child.on('error', (err) => {
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
      // Clean prompt - remove problematic characters for shell
      const cleanPrompt = message
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Create temp files for safe execution
      const timestamp = Date.now();
      const tmpFile = `/tmp/claude-prompt-${timestamp}.txt`;
      const tmpScript = `/tmp/claude-run-${timestamp}.sh`;

      writeFileSync(tmpFile, cleanPrompt);

      // Build command with proper flags
      const ralphFlag = this.ralphMode ? '--ralph' : '';

      // Shell script that exports the OAuth token and runs Claude Code
      const scriptContent = `#!/bin/bash
export CLAUDE_CODE_OAUTH_TOKEN="${this.token}"
cd "${this.projectPath}"
PROMPT=$(cat "${tmpFile}")
claude --dangerously-skip-permissions ${ralphFlag} -p "$PROMPT" --output-format text 2>&1
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
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
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

    const timestamp = Date.now();
    const tmpFile = `/tmp/claude-prompt-${timestamp}.txt`;

    // Clean prompt for file storage
    const cleanPrompt = message.trim();
    writeFileSync(tmpFile, cleanPrompt);

    // Build command with stream-json output format
    const ralphFlag = this.ralphMode ? '--ralph' : '';

    // Spawn process instead of execSync
    const child = spawn('bash', ['-c', `
      export CLAUDE_CODE_OAUTH_TOKEN="${this.token}"
      cd "${this.projectPath}"
      PROMPT=$(cat "${tmpFile}")
      claude --dangerously-skip-permissions ${ralphFlag} -p "$PROMPT" --output-format stream-json 2>&1
    `]);

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
            fullContent += event.message.content;
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
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
      callbacks.onError(err);
    });

    child.on('close', (code: number | null) => {
      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer) as StreamEvent;
          if (event.type === 'assistant' && event.message?.content) {
            fullContent += event.message.content;
          }
          callbacks.onEvent(event);
        } catch {
          callbacks.onEvent({ type: 'text', content: buffer });
        }
      }

      try { unlinkSync(tmpFile); } catch { /* ignore */ }

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
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
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

Example format:
[
  {"title": "Set up project structure", "description": "Initialize the project with necessary folders and configuration files"},
  {"title": "Create user authentication", "description": "Implement login/signup with JWT tokens"}
]

Return ONLY the JSON array, no markdown code blocks, no explanations.`;

    return this.sendMessage(prompt);
  }

  async developTask(
    taskTitle: string,
    taskDescription: string,
    prdContent: string
  ): Promise<ClaudeResponse> {
    const prompt = `You are developing a feature for a project.

TASK: ${taskTitle}
DESCRIPTION: ${taskDescription}

PROJECT REQUIREMENTS (for context):
${prdContent}

Implement this task. Write the necessary code, create files, and make the changes needed.
Focus only on this specific task. Be thorough but concise.
After implementing, stage and commit your changes with a descriptive commit message.`;

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
