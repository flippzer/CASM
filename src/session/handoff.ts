// S03: Handoff generator

import { join } from 'node:path';
import type { SessionDef, SessionResult, SessionHandoff } from '../manifest/types.js';
import { readFileContent, writeFileContent, ensureDir } from '../utils/file-ops.js';
import { logger } from '../utils/logger.js';

export async function generateHandoff(
  session: SessionDef,
  result: SessionResult,
  handoffsDir: string,
): Promise<SessionHandoff> {
  await ensureDir(handoffsDir);

  const handoff: SessionHandoff = {
    sessionId: session.id,
    sessionName: session.name,
    status: result.success ? 'completed' : 'failed',
    filesCreated: [],
    filesModified: result.filesModified,
    keyDecisions: extractKeyDecisions(result.result),
    interfacesExposed: extractInterfaces(result.result),
    validationResult: result.validationOutput || 'No validation output',
    notesForDownstream: extractNotes(result.result),
  };

  const filename = `${session.id}-${sanitizeFilename(session.name)}.md`;
  const filePath = join(handoffsDir, filename);
  const markdown = formatHandoffMarkdown(handoff);

  await writeFileContent(filePath, markdown);
  logger.session(session.id, `Handoff saved: ${filePath}`);

  return handoff;
}

export async function loadHandoffSummary(
  completedSessionIds: string[],
  handoffsDir: string,
): Promise<string> {
  if (completedSessionIds.length === 0) {
    return '';
  }

  const summaries: string[] = [];

  for (const sessionId of completedSessionIds) {
    const content = await findHandoffFile(sessionId, handoffsDir);
    if (content) {
      summaries.push(content);
    }
  }

  return summaries.join('\n\n---\n\n');
}

export function formatHandoffMarkdown(handoff: SessionHandoff): string {
  const status = handoff.status === 'completed' ? 'COMPLETED ✅' : 'FAILED ❌';
  const filesList = [...handoff.filesCreated, ...handoff.filesModified]
    .map((f) => `- ${f}`)
    .join('\n') || '- None';
  const decisions = handoff.keyDecisions
    .map((d) => `- ${d}`)
    .join('\n') || '- None';
  const interfaces = handoff.interfacesExposed
    .map((i) => `- ${i}`)
    .join('\n') || '- None';

  return `# Session ${handoff.sessionId}: ${handoff.sessionName} — ${status}

## Files Created/Modified
${filesList}

## Key Decisions
${decisions}

## Interfaces Exposed
${interfaces}

## Validation Result
${handoff.validationResult}

## Notes For Downstream Sessions
${handoff.notesForDownstream || 'None'}
`;
}

function extractKeyDecisions(resultText: string): string[] {
  const decisions: string[] = [];
  const lines = resultText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.toLowerCase().includes('decided') ||
      trimmed.toLowerCase().includes('chose') ||
      trimmed.toLowerCase().includes('decision')
    ) {
      decisions.push(trimmed);
    }
  }

  return decisions.length > 0 ? decisions.slice(0, 10) : ['No explicit decisions extracted from output'];
}

function extractInterfaces(resultText: string): string[] {
  const interfaces: string[] = [];
  const exportRegex = /export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+(\w+)/g;
  let match: RegExpExecArray | null;

  while ((match = exportRegex.exec(resultText)) !== null) {
    interfaces.push(match[1]);
  }

  return interfaces.length > 0 ? interfaces : ['No exports detected in output'];
}

function extractNotes(resultText: string): string {
  const lines = resultText.split('\n');
  const noteLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.toLowerCase().includes('note:') ||
      trimmed.toLowerCase().includes('important:') ||
      trimmed.toLowerCase().includes('warning:') ||
      trimmed.toLowerCase().includes('todo:')
    ) {
      noteLines.push(trimmed);
    }
  }

  return noteLines.slice(0, 5).join('\n') || '';
}

async function findHandoffFile(sessionId: string, handoffsDir: string): Promise<string> {
  // Try reading by prefix match — the filename is {sessionId}-{name}.md
  // Since we don't know the exact name, try a few common patterns
  const { listFiles } = await import('../utils/file-ops.js');
  const files = await listFiles(`${sessionId}-*.md`, handoffsDir);

  for (const file of files) {
    const content = await readFileContent(join(handoffsDir, file));
    if (content) {
      return content;
    }
  }

  return '';
}

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
