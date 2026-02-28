// S07: Main orchestrator — coordinates all three phases

import { join } from 'node:path';
import type { CasmConfig } from './config.js';
import type { IdeationResult } from './phases/ideation.js';
import type { PlanningResult } from './phases/planning.js';
import type { ExecutionSummary } from './phases/execution.js';
import { runIdeation, loadArchitecture } from './phases/ideation.js';
import { runPlanning } from './phases/planning.js';
import { runExecution } from './phases/execution.js';
import { loadManifest } from './manifest/parser.js';
import { ensureDir } from './utils/file-ops.js';
import { logger } from './utils/logger.js';

export interface OrchestratorOptions {
  cwd: string;
  casmConfig: CasmConfig;
  fromSession?: string;
  dryRun?: boolean;
  skipIdeation?: boolean;
  skipPlanning?: boolean;
  skipExecution?: boolean;
  architecturePath?: string;
  manifestPath?: string;
}

export interface PipelineResult {
  ideation?: IdeationResult;
  planning?: PlanningResult;
  execution?: ExecutionSummary;
  success: boolean;
  error?: string;
}

export async function runFullPipeline(
  idea: string,
  options: OrchestratorOptions,
): Promise<PipelineResult> {
  const pipelineStart = Date.now();
  const result: PipelineResult = { success: false };

  await ensureDir(join(options.cwd, '.casm'));

  try {
    // Phase 1: Ideation
    if (!options.skipIdeation) {
      logger.info('Phase 1: Ideation — generating architecture PRD...');
      const phaseStart = Date.now();
      result.ideation = await runIdeation(idea, options.cwd, options.casmConfig);
      logger.success(`Phase 1 complete (${((Date.now() - phaseStart) / 1000).toFixed(1)}s)`);
    }

    // Phase 2: Planning
    if (!options.skipPlanning) {
      const archPath = options.architecturePath ?? result.ideation?.architecturePath ?? join(options.cwd, 'architecture.md');
      logger.info('Phase 2: Planning — generating session manifest...');
      const phaseStart = Date.now();
      result.planning = await runPlanning(archPath, options.cwd, options.casmConfig);
      logger.success(`Phase 2 complete (${((Date.now() - phaseStart) / 1000).toFixed(1)}s)`);
    }

    // Phase 3: Execution
    if (!options.skipExecution) {
      const manifestPath = options.manifestPath ?? result.planning?.manifestPath ?? join(options.cwd, '.casm', 'manifest.json');
      const manifest = result.planning?.manifest ?? await loadManifest(manifestPath);
      logger.info('Phase 3: Execution — running sessions...');
      const phaseStart = Date.now();
      result.execution = await runExecution(manifest, options.cwd, options.casmConfig, {
        fromSession: options.fromSession,
        dryRun: options.dryRun,
      });
      logger.success(`Phase 3 complete (${((Date.now() - phaseStart) / 1000).toFixed(1)}s)`);
    }

    result.success = !result.execution || result.execution.failed === 0;
    printSummary(result, Date.now() - pipelineStart);
    return result;
  } catch (err: unknown) {
    result.error = err instanceof Error ? err.message : String(err);
    result.success = false;
    logger.error(`Pipeline failed: ${result.error}`);
    return result;
  }
}

export async function runPlanPipeline(
  idea: string,
  options: OrchestratorOptions,
): Promise<PipelineResult> {
  return runFullPipeline(idea, { ...options, skipExecution: true });
}

export async function runSplitAndExecute(
  options: OrchestratorOptions,
): Promise<PipelineResult> {
  const pipelineStart = Date.now();
  const result: PipelineResult = { success: false };

  await ensureDir(join(options.cwd, '.casm'));

  try {
    // Load existing architecture
    const archPath = options.architecturePath ?? join(options.cwd, '.casm', 'architecture.md');
    await loadArchitecture(archPath);

    // Phase 2: Planning
    logger.info('Phase 2: Planning — generating session manifest...');
    const planStart = Date.now();
    result.planning = await runPlanning(archPath, options.cwd, options.casmConfig);
    logger.success(`Phase 2 complete (${((Date.now() - planStart) / 1000).toFixed(1)}s)`);

    // Phase 3: Execution
    if (!options.skipExecution) {
      logger.info('Phase 3: Execution — running sessions...');
      const execStart = Date.now();
      result.execution = await runExecution(
        result.planning.manifest,
        options.cwd,
        options.casmConfig,
        {
          fromSession: options.fromSession,
          dryRun: options.dryRun,
        },
      );
      logger.success(`Phase 3 complete (${((Date.now() - execStart) / 1000).toFixed(1)}s)`);
    }

    result.success = !result.execution || result.execution.failed === 0;
    printSummary(result, Date.now() - pipelineStart);
    return result;
  } catch (err: unknown) {
    result.error = err instanceof Error ? err.message : String(err);
    result.success = false;
    logger.error(`Pipeline failed: ${result.error}`);
    return result;
  }
}

export async function runExecuteOnly(
  options: OrchestratorOptions,
): Promise<PipelineResult> {
  const pipelineStart = Date.now();
  const result: PipelineResult = { success: false };

  await ensureDir(join(options.cwd, '.casm'));

  try {
    const manifestPath = options.manifestPath ?? join(options.cwd, '.casm', 'manifest.json');
    const manifest = await loadManifest(manifestPath);

    logger.info('Phase 3: Execution — running sessions...');
    const execStart = Date.now();
    result.execution = await runExecution(manifest, options.cwd, options.casmConfig, {
      fromSession: options.fromSession,
      dryRun: options.dryRun,
    });
    logger.success(`Phase 3 complete (${((Date.now() - execStart) / 1000).toFixed(1)}s)`);

    result.success = result.execution.failed === 0;
    printSummary(result, Date.now() - pipelineStart);
    return result;
  } catch (err: unknown) {
    result.error = err instanceof Error ? err.message : String(err);
    result.success = false;
    logger.error(`Pipeline failed: ${result.error}`);
    return result;
  }
}

function printSummary(result: PipelineResult, totalDuration: number): void {
  logger.info('');
  logger.info('=== Pipeline Summary ===');

  if (result.ideation) {
    logger.info(`  Ideation:  ${result.ideation.tokensUsed} tokens`);
  }
  if (result.planning) {
    logger.info(`  Planning:  ${result.planning.tokensUsed} tokens, ${result.planning.manifest.total_sessions} sessions`);
  }
  if (result.execution) {
    const exec = result.execution;
    logger.info(`  Execution: ${exec.completed} completed, ${exec.failed} failed, ${exec.skipped} skipped`);
    logger.info(`  Tokens:    ${exec.totalTokens}`);
    if (exec.failedSessions.length > 0) {
      logger.warn(`  Failed:    ${exec.failedSessions.join(', ')}`);
    }
  }

  logger.info(`  Duration:  ${(totalDuration / 1000).toFixed(1)}s`);
  logger.info('');
}
