// S07: Phase 3 — Execution loop

import { join } from 'node:path';
import type {
  SessionDef,
  SessionManifest,
  SessionResult,
  SessionStatus,
  ExecutionState,
} from '../manifest/types.js';
import { topologicalSort } from '../manifest/dag.js';
import { buildContextPayload, buildSessionPrompt } from '../session/context-builder.js';
import { executeWithRetry } from '../session/validator.js';
import { generateHandoff } from '../session/handoff.js';
import { readJsonFile, writeJsonFile, ensureDir } from '../utils/file-ops.js';
import { logger } from '../utils/logger.js';
import type { CasmConfig } from '../config.js';

export interface ExecutionOptions {
  fromSession?: string;
  dryRun?: boolean;
  onSessionStart?: (session: SessionDef) => void;
  onSessionComplete?: (session: SessionDef, result: SessionResult) => void;
  onSessionFail?: (session: SessionDef, result: SessionResult) => void;
}

export interface ExecutionSummary {
  totalSessions: number;
  completed: number;
  failed: number;
  skipped: number;
  totalDuration: number;
  totalTokens: number;
  failedSessions: string[];
}

export async function runExecution(
  manifest: SessionManifest,
  cwd: string,
  casmConfig: CasmConfig,
  options?: ExecutionOptions,
): Promise<ExecutionSummary> {
  const startTime = Date.now();
  const sorted = topologicalSort(manifest.sessions);
  const handoffsDir = join(cwd, casmConfig.output.handoffsDir);

  await ensureDir(join(cwd, '.casm'));
  await ensureDir(handoffsDir);

  // Initialize execution state
  const state: ExecutionState = {
    projectDir: cwd,
    manifestPath: join(cwd, '.casm', 'manifest.json'),
    startedAt: new Date().toISOString(),
    sessions: {},
  };

  for (const session of sorted) {
    state.sessions[session.id] = { status: 'pending' };
  }

  // If resuming, mark sessions before fromSession as skipped
  let foundFrom = !options?.fromSession;
  if (options?.fromSession) {
    for (const session of sorted) {
      if (session.id === options.fromSession) {
        foundFrom = true;
        break;
      }
      state.sessions[session.id] = { status: 'skipped' };
    }

    if (!foundFrom) {
      throw new Error(`Session "${options.fromSession}" not found in manifest`);
    }
  }

  // Dry run
  if (options?.dryRun) {
    displayDryRun(manifest);
    return {
      totalSessions: sorted.length,
      completed: 0,
      failed: 0,
      skipped: sorted.length,
      totalDuration: 0,
      totalTokens: 0,
      failedSessions: [],
    };
  }

  const completedIds = new Set<string>();
  const failedIds = new Set<string>();
  let totalTokens = 0;

  // Pre-populate completed set from skipped (resume scenario — treat pre-fromSession as completed for dependency checks)
  for (const session of sorted) {
    if (state.sessions[session.id].status === 'skipped' && options?.fromSession) {
      completedIds.add(session.id);
    }
  }

  for (const session of sorted) {
    const sessionState = state.sessions[session.id];

    if (sessionState.status === 'skipped') {
      continue;
    }

    // Check if dependencies are met
    const depsBlocked = session.depends_on.some(
      (dep) => failedIds.has(dep) || (!completedIds.has(dep) && state.sessions[dep]?.status !== 'skipped'),
    );

    if (depsBlocked) {
      logger.warn(`Skipping ${session.id} — dependency failed or not completed`);
      state.sessions[session.id] = { status: 'skipped' };
      await saveExecutionState(state, cwd);
      continue;
    }

    // Execute session
    logger.info(`Starting session ${session.id}: ${session.name}`);
    options?.onSessionStart?.(session);
    state.sessions[session.id] = { status: 'running' };
    await saveExecutionState(state, cwd);

    const completedSessionIds = [...completedIds];
    const payload = await buildContextPayload(session, cwd, handoffsDir, completedSessionIds);
    const prompt = buildSessionPrompt(payload);

    const result = await executeWithRetry(session, prompt, cwd, casmConfig);
    totalTokens += result.tokensUsed;

    if (result.success) {
      completedIds.add(session.id);
      state.sessions[session.id] = {
        status: 'completed',
        result,
        completedAt: new Date().toISOString(),
      };
      await generateHandoff(session, result, handoffsDir);
      await saveExecutionState(state, cwd);
      options?.onSessionComplete?.(session, result);
      logger.success(`Session ${session.id} completed (${result.tokensUsed} tokens, ${(result.duration / 1000).toFixed(1)}s)`);
    } else {
      failedIds.add(session.id);
      state.sessions[session.id] = {
        status: 'failed',
        result,
        completedAt: new Date().toISOString(),
      };
      await saveExecutionState(state, cwd);
      options?.onSessionFail?.(session, result);
      logger.error(`Session ${session.id} failed: ${result.error}`);
    }
  }

  const totalDuration = Date.now() - startTime;
  const statuses = Object.values(state.sessions);

  const summary: ExecutionSummary = {
    totalSessions: sorted.length,
    completed: statuses.filter((s) => s.status === 'completed').length,
    failed: statuses.filter((s) => s.status === 'failed').length,
    skipped: statuses.filter((s) => s.status === 'skipped').length,
    totalDuration,
    totalTokens,
    failedSessions: [...failedIds],
  };

  return summary;
}

export function displayDryRun(manifest: SessionManifest): void {
  const sorted = topologicalSort(manifest.sessions);

  logger.info(`Dry run — ${sorted.length} sessions in execution order:\n`);

  for (let i = 0; i < sorted.length; i++) {
    const session = sorted[i];
    const deps = session.depends_on.length > 0
      ? ` (depends on: ${session.depends_on.join(', ')})`
      : '';
    logger.info(`  ${i + 1}. [${session.id}] ${session.name}${deps}`);
    logger.info(`     Est. tokens: ${session.estimated_tokens}, Max turns: ${session.max_turns}`);
    logger.info(`     Validation: ${session.validation.type}${session.validation.command ? ` — ${session.validation.command}` : ''}`);
  }

  const totalTokens = sorted.reduce((sum, s) => sum + s.estimated_tokens, 0);
  logger.info(`\n  Total estimated tokens: ${totalTokens}`);
}

export async function loadExecutionState(cwd: string): Promise<ExecutionState | null> {
  const statePath = join(cwd, '.casm', 'state.json');
  try {
    return await readJsonFile<ExecutionState>(statePath);
  } catch {
    return null;
  }
}

export async function saveExecutionState(state: ExecutionState, cwd: string): Promise<void> {
  const statePath = join(cwd, '.casm', 'state.json');
  await writeJsonFile(statePath, state);
}
