import { exec } from 'child_process';
import { promisify } from 'util';
import * as kanbanService from './kanbanService.js';

const execAsync = promisify(exec);

/**
 * Coverage result for a single file
 */
export interface FileCoverage {
  path: string;
  statements: { covered: number; total: number; percentage: number };
  branches: { covered: number; total: number; percentage: number };
  functions: { covered: number; total: number; percentage: number };
  lines: { covered: number; total: number; percentage: number };
  uncoveredLines: number[];
}

/**
 * Overall coverage result
 */
export interface CoverageResult {
  totalCoverage: number;
  passed: boolean;
  files: FileCoverage[];
  uncoveredFiles: string[];
  summary: {
    statements: { covered: number; total: number; percentage: number };
    branches: { covered: number; total: number; percentage: number };
    functions: { covered: number; total: number; percentage: number };
    lines: { covered: number; total: number; percentage: number };
  };
}

/**
 * Service for running and parsing test coverage
 */
export class CoverageService {
  private requiredCoverage = 100;

  /**
   * Parse vitest/jest JSON coverage output
   */
  parseCoverageJson(jsonOutput: string): CoverageResult {
    try {
      const coverage = JSON.parse(jsonOutput);
      const files: FileCoverage[] = [];
      let totalStatements = 0,
        coveredStatements = 0;
      let totalBranches = 0,
        coveredBranches = 0;
      let totalFunctions = 0,
        coveredFunctions = 0;
      let totalLines = 0,
        coveredLines = 0;

      // Handle different coverage output formats (c8, istanbul, vitest)
      const coverageData = coverage.total ? coverage : coverage;

      for (const [filePath, fileData] of Object.entries(coverageData)) {
        if (filePath === 'total') continue;

        const data = fileData as Record<string, Record<string, number>>;

        // Handle istanbul/c8 format
        const stmts = data.s || {};
        const branches = data.b || {};
        const fns = data.f || {};
        const lineMap = data.statementMap || {};

        // Calculate file-level coverage
        const stmtTotal = Object.keys(stmts).length;
        const stmtCovered = Object.values(stmts).filter(v => v > 0).length;

        const branchTotal = Object.keys(branches).length;
        const branchCovered = Object.values(branches).filter(v => {
          if (Array.isArray(v)) return v.every(b => b > 0);
          return v > 0;
        }).length;

        const fnTotal = Object.keys(fns).length;
        const fnCovered = Object.values(fns).filter(v => v > 0).length;

        // Find uncovered lines
        const uncoveredLines: number[] = [];
        for (const [stmtId, count] of Object.entries(stmts)) {
          if (count === 0 && lineMap[stmtId]) {
            const lineInfo = lineMap[stmtId] as { start?: { line?: number } } | number;
            if (typeof lineInfo === 'object' && lineInfo?.start?.line) {
              uncoveredLines.push(lineInfo.start.line);
            } else {
              uncoveredLines.push(parseInt(stmtId));
            }
          }
        }

        totalStatements += stmtTotal;
        coveredStatements += stmtCovered;
        totalBranches += branchTotal;
        coveredBranches += branchCovered;
        totalFunctions += fnTotal;
        coveredFunctions += fnCovered;
        totalLines += stmtTotal;
        coveredLines += stmtCovered;

        files.push({
          path: filePath,
          statements: {
            covered: stmtCovered,
            total: stmtTotal,
            percentage: stmtTotal > 0 ? (stmtCovered / stmtTotal) * 100 : 100,
          },
          branches: {
            covered: branchCovered,
            total: branchTotal,
            percentage: branchTotal > 0 ? (branchCovered / branchTotal) * 100 : 100,
          },
          functions: {
            covered: fnCovered,
            total: fnTotal,
            percentage: fnTotal > 0 ? (fnCovered / fnTotal) * 100 : 100,
          },
          lines: {
            covered: stmtCovered,
            total: stmtTotal,
            percentage: stmtTotal > 0 ? (stmtCovered / stmtTotal) * 100 : 100,
          },
          uncoveredLines,
        });
      }

      // Handle total summary from vitest format
      if (coverage.total) {
        const total = coverage.total;
        totalStatements = total.statements?.total || totalStatements;
        coveredStatements = total.statements?.covered || coveredStatements;
        totalBranches = total.branches?.total || totalBranches;
        coveredBranches = total.branches?.covered || coveredBranches;
        totalFunctions = total.functions?.total || totalFunctions;
        coveredFunctions = total.functions?.covered || coveredFunctions;
        totalLines = total.lines?.total || totalLines;
        coveredLines = total.lines?.covered || coveredLines;
      }

      const totalCoverage =
        totalLines > 0 ? Math.round((coveredLines / totalLines) * 100) : 100;

      return {
        totalCoverage,
        passed: totalCoverage >= this.requiredCoverage,
        files,
        uncoveredFiles: files.filter(f => f.lines.percentage < 100).map(f => f.path),
        summary: {
          statements: {
            covered: coveredStatements,
            total: totalStatements,
            percentage: totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 100,
          },
          branches: {
            covered: coveredBranches,
            total: totalBranches,
            percentage: totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 100,
          },
          functions: {
            covered: coveredFunctions,
            total: totalFunctions,
            percentage: totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 100,
          },
          lines: {
            covered: coveredLines,
            total: totalLines,
            percentage: totalCoverage,
          },
        },
      };
    } catch (error) {
      // Return empty result on parse error
      return {
        totalCoverage: 0,
        passed: false,
        files: [],
        uncoveredFiles: [],
        summary: {
          statements: { covered: 0, total: 0, percentage: 0 },
          branches: { covered: 0, total: 0, percentage: 0 },
          functions: { covered: 0, total: 0, percentage: 0 },
          lines: { covered: 0, total: 0, percentage: 0 },
        },
      };
    }
  }

  /**
   * Run coverage in a Docker container and parse results
   */
  async runCoverageInContainer(
    containerId: string,
    workDir: string = '/app'
  ): Promise<CoverageResult> {
    try {
      // Try vitest first, then jest
      const commands = [
        `docker exec ${containerId} sh -c "cd ${workDir} && npm run test:coverage -- --reporter=json --outputFile=coverage-output.json 2>/dev/null && cat coverage/coverage-final.json 2>/dev/null || cat coverage-output.json 2>/dev/null"`,
        `docker exec ${containerId} sh -c "cd ${workDir} && npx vitest run --coverage --reporter=json 2>/dev/null && cat coverage/coverage-final.json"`,
        `docker exec ${containerId} sh -c "cd ${workDir} && npx jest --coverage --json 2>/dev/null && cat coverage/coverage-final.json"`,
      ];

      let result: CoverageResult | null = null;

      for (const cmd of commands) {
        try {
          const { stdout } = await execAsync(cmd, { timeout: 300000 }); // 5 min timeout
          if (stdout.trim()) {
            result = this.parseCoverageJson(stdout.trim());
            if (result.files.length > 0 || result.totalCoverage > 0) {
              break;
            }
          }
        } catch {
          // Try next command
          continue;
        }
      }

      return (
        result || {
          totalCoverage: 0,
          passed: false,
          files: [],
          uncoveredFiles: [],
          summary: {
            statements: { covered: 0, total: 0, percentage: 0 },
            branches: { covered: 0, total: 0, percentage: 0 },
            functions: { covered: 0, total: 0, percentage: 0 },
            lines: { covered: 0, total: 0, percentage: 0 },
          },
        }
      );
    } catch (error) {
      return {
        totalCoverage: 0,
        passed: false,
        files: [],
        uncoveredFiles: [],
        summary: {
          statements: { covered: 0, total: 0, percentage: 0 },
          branches: { covered: 0, total: 0, percentage: 0 },
          functions: { covered: 0, total: 0, percentage: 0 },
          lines: { covered: 0, total: 0, percentage: 0 },
        },
      };
    }
  }

  /**
   * Generate a prompt for Claude to fix coverage gaps
   */
  generateCoverageFixPrompt(result: CoverageResult): string {
    const uncoveredFiles = result.files.filter(f => f.lines.percentage < 100);

    if (uncoveredFiles.length === 0) {
      return '';
    }

    let prompt = `Your previous implementation has test coverage at ${result.totalCoverage}% but it MUST be 100%.\n\n`;
    prompt += 'Files with insufficient coverage:\n\n';

    for (const file of uncoveredFiles) {
      prompt += `## ${file.path}\n`;
      prompt += `- Line coverage: ${file.lines.percentage.toFixed(1)}% (${file.lines.covered}/${file.lines.total})\n`;
      prompt += `- Branch coverage: ${file.branches.percentage.toFixed(1)}% (${file.branches.covered}/${file.branches.total})\n`;
      prompt += `- Function coverage: ${file.functions.percentage.toFixed(1)}% (${file.functions.covered}/${file.functions.total})\n`;

      if (file.uncoveredLines.length > 0) {
        prompt += `- Uncovered lines: ${file.uncoveredLines.slice(0, 20).join(', ')}`;
        if (file.uncoveredLines.length > 20) {
          prompt += ` and ${file.uncoveredLines.length - 20} more`;
        }
        prompt += '\n';
      }
      prompt += '\n';
    }

    prompt += `\nIMPORTANT: Add more tests to cover ALL the uncovered lines and branches above. Do NOT proceed until coverage is at 100%.\n`;

    return prompt;
  }

  /**
   * Update task with coverage results
   */
  async updateTaskCoverage(
    taskId: string,
    result: CoverageResult
  ): Promise<void> {
    await kanbanService.updateTaskTestStatus(
      taskId,
      result.passed ? 'passed' : 'failed',
      result.totalCoverage
    );
  }

  /**
   * Check if coverage meets requirements
   */
  meetsCoverageRequirement(coverage: number): boolean {
    return coverage >= this.requiredCoverage;
  }

  /**
   * Get required coverage percentage
   */
  getRequiredCoverage(): number {
    return this.requiredCoverage;
  }
}

// Singleton instance
export const coverageService = new CoverageService();
