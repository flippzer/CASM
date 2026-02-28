// S03: Context builder

import { join } from 'node:path';
import type { SessionDef } from '../manifest/types.js';
import { readFileContent } from '../utils/file-ops.js';
import { estimateTokens, TOKEN_BUDGETS } from '../utils/token-estimator.js';
import { loadHandoffSummary } from './handoff.js';

export interface ContextPayload {
  architectureSummary: string;
  contextFileContents: string;
  handoffSummary: string;
  taskPrompt: string;
  constraints: string;
}

export function buildSessionPrompt(payload: ContextPayload): string {
  return `## PROJECT ARCHITECTURE (Reference Only — Do Not Modify)
${payload.architectureSummary}

## FILES YOU MUST READ FOR CONTEXT
${payload.contextFileContents}

## WHAT PREVIOUS SESSIONS ACCOMPLISHED
${payload.handoffSummary}

## YOUR TASK FOR THIS SESSION
${payload.taskPrompt}

## IMPLEMENTATION REQUIREMENTS
- Write COMPLETE, PRODUCTION-QUALITY code. No placeholders, no TODOs.
- Follow the project's established patterns.
- Include proper error handling and edge case coverage.
- If you need a type from another file, import it — do not redefine it.
- If a dependency doesn't exist yet, create a minimal stub with a TODO comment.

## VALIDATION
When done, run the validation command from your session definition.
Fix any issues and re-run until it passes.

## SCOPE BOUNDARIES — DO NOT VIOLATE
${payload.constraints}
- Do NOT modify files outside your output files.
- Do NOT install new dependencies unless required by YOUR task.
- Do NOT refactor existing code.`;
}

export async function buildContextPayload(
  session: SessionDef,
  cwd: string,
  handoffsDir: string,
  completedSessionIds: string[],
): Promise<ContextPayload> {
  const architectureSummary = await loadArchitectureSummary(cwd);

  const fileContents = await loadContextFiles(session.context_files, cwd);

  const handoffSummary = await loadHandoffSummary(completedSessionIds, handoffsDir);

  const constraints = buildConstraints(session);

  const payload: ContextPayload = {
    architectureSummary,
    contextFileContents: fileContents,
    handoffSummary: handoffSummary || 'No previous sessions completed yet.',
    taskPrompt: session.prompt,
    constraints,
  };

  const totalTokens = estimateTokens(buildSessionPrompt(payload));
  if (totalTokens > TOKEN_BUDGETS.SESSION_PROMPT) {
    const parts = [
      { name: 'architectureSummary', content: payload.architectureSummary, priority: 2 },
      { name: 'contextFileContents', content: payload.contextFileContents, priority: 1 },
      { name: 'handoffSummary', content: payload.handoffSummary, priority: 3 },
    ];
    const overhead = estimateTokens(payload.taskPrompt) + estimateTokens(payload.constraints) + TOKEN_BUDGETS.CONTEXT_OVERHEAD;
    const budgetForParts = TOKEN_BUDGETS.SESSION_PROMPT - overhead;
    const trimmed = enforceTokenBudget(parts, budgetForParts);

    payload.contextFileContents = trimmed;
  }

  return payload;
}

export function enforceTokenBudget(
  parts: { name: string; content: string; priority: number }[],
  maxTokens: number,
): string {
  const sorted = [...parts].sort((a, b) => a.priority - b.priority);

  let remaining = maxTokens;
  const kept: string[] = [];

  for (const part of sorted) {
    const tokens = estimateTokens(part.content);
    if (tokens <= remaining) {
      kept.push(part.content);
      remaining -= tokens;
    } else if (remaining > 0) {
      const truncated = truncateToTokens(part.content, remaining);
      kept.push(truncated + `\n\n[... ${part.name} truncated to fit token budget]`);
      remaining = 0;
    }
  }

  return kept.join('\n\n');
}

function truncateToTokens(text: string, maxTokens: number): string {
  const lines = text.split('\n');
  let result = '';
  let currentTokens = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line);
    if (currentTokens + lineTokens > maxTokens) {
      break;
    }
    result += (result ? '\n' : '') + line;
    currentTokens += lineTokens;
  }

  return result;
}

async function loadArchitectureSummary(cwd: string): Promise<string> {
  const candidates = ['ARCHITECTURE.md', 'architecture.md', 'docs/architecture.md'];
  for (const candidate of candidates) {
    const content = await readFileContent(join(cwd, candidate));
    if (content) {
      return content;
    }
  }
  return 'No architecture document found.';
}

async function loadContextFiles(contextFiles: string[], cwd: string): Promise<string> {
  const sections: string[] = [];

  for (const filePath of contextFiles) {
    const fullPath = join(cwd, filePath);
    const content = await readFileContent(fullPath);
    if (content) {
      sections.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\``);
    } else {
      sections.push(`### ${filePath}\n[File not found or empty]`);
    }
  }

  return sections.join('\n\n');
}

function buildConstraints(session: SessionDef): string {
  const lines: string[] = [];

  if (session.output_files.length > 0) {
    lines.push(`- Only modify these files: ${session.output_files.join(', ')}`);
  }

  if (session.validation.command) {
    lines.push(`- Validation command: ${session.validation.command}`);
  }

  return lines.join('\n');
}
