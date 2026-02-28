#!/usr/bin/env node
// S08: CLI entry point

import { Command } from 'commander';
import { resolve, basename } from 'node:path';
import { loadConfig } from './config.js';
import { logger, setVerbose } from './utils/logger.js';
import {
  runFullPipeline,
  runPlanPipeline,
  runSplitAndExecute,
  runExecuteOnly,
} from './orchestrator.js';
import { loadExecutionState } from './phases/execution.js';
import type { OrchestratorOptions } from './orchestrator.js';

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  process.exit(1);
});

function requireApiKey(): void {
  if (!process.env['ANTHROPIC_API_KEY']) {
    logger.error('ANTHROPIC_API_KEY environment variable is not set.');
    logger.error('Get your API key at https://console.anthropic.com/');
    process.exit(1);
  }
}

function resolveOptions(opts: { dir?: string; config?: string; verbose?: boolean; dryRun?: boolean; from?: string }): OrchestratorOptions {
  const cwd = resolve(opts.dir ?? process.cwd());
  const casmConfig = loadConfig(cwd);

  if (opts.verbose) {
    setVerbose(true);
  }

  return {
    cwd,
    casmConfig,
    dryRun: opts.dryRun,
    fromSession: opts.from,
  };
}

const program = new Command();

program
  .name('casm')
  .description('Claude Code Autonomous Session Manager')
  .version('1.0.0');

program
  .command('run')
  .description('Full pipeline: Idea -> PRD -> Manifest -> Execution')
  .argument('<idea>', 'The project idea to implement')
  .option('-d, --dir <path>', 'Target project directory', process.cwd())
  .option('-c, --config <path>', 'Path to .casmrc.json')
  .option('--dry-run', 'Show planned sessions without executing')
  .option('-v, --verbose', 'Verbose output')
  .action(async (idea: string, opts: { dir?: string; config?: string; dryRun?: boolean; verbose?: boolean }) => {
    try {
      requireApiKey();
      const options = resolveOptions(opts);
      const result = await runFullPipeline(idea, options);
      process.exit(result.success ? 0 : 1);
    } catch (err: unknown) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('plan')
  .description('Phase 1+2 only: generates PRD + manifest, no execution')
  .argument('<idea>', 'The project idea to plan')
  .option('-d, --dir <path>', 'Target project directory', process.cwd())
  .option('-o, --output <path>', 'Output directory for architecture.md and manifest.json')
  .option('-v, --verbose', 'Verbose output')
  .action(async (idea: string, opts: { dir?: string; output?: string; verbose?: boolean }) => {
    try {
      requireApiKey();
      const options = resolveOptions(opts);
      const result = await runPlanPipeline(idea, options);
      process.exit(result.success ? 0 : 1);
    } catch (err: unknown) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('split')
  .description('Phase 2 only: PRD -> manifest')
  .argument('<architecture-file>', 'Path to architecture.md')
  .option('-d, --dir <path>', 'Target project directory', process.cwd())
  .option('-o, --output <path>', 'Output path for manifest.json')
  .option('-v, --verbose', 'Verbose output')
  .action(async (architectureFile: string, opts: { dir?: string; output?: string; verbose?: boolean }) => {
    try {
      requireApiKey();
      const options = resolveOptions(opts);
      options.architecturePath = resolve(architectureFile);
      options.skipExecution = true;
      const result = await runSplitAndExecute(options);
      process.exit(result.success ? 0 : 1);
    } catch (err: unknown) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('execute')
  .description('Phase 3 only: execute an existing manifest')
  .argument('<manifest-file>', 'Path to manifest.json')
  .option('-d, --dir <path>', 'Target project directory', process.cwd())
  .option('--from <session-id>', 'Resume from a specific session (e.g. S04)')
  .option('--dry-run', 'Show planned sessions without executing')
  .option('-v, --verbose', 'Verbose output')
  .action(async (manifestFile: string, opts: { dir?: string; from?: string; dryRun?: boolean; verbose?: boolean }) => {
    try {
      requireApiKey();
      const options = resolveOptions(opts);
      options.manifestPath = resolve(manifestFile);
      const result = await runExecuteOnly(options);
      process.exit(result.success ? 0 : 1);
    } catch (err: unknown) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show current execution state')
  .option('-d, --dir <path>', 'Target project directory', process.cwd())
  .action(async (opts: { dir?: string }) => {
    try {
      const cwd = resolve(opts.dir ?? process.cwd());
      const state = await loadExecutionState(cwd);

      if (!state) {
        console.log('No CASM execution found in this directory');
        process.exit(0);
      }

      const projectName = basename(state.projectDir);
      console.log(`\nCASM Status \u2014 Project: ${projectName}`);
      console.log('\u2500'.repeat(50));

      for (const [sessionId, sessionState] of Object.entries(state.sessions)) {
        const status = sessionState.status;
        let icon: string;
        let label: string;

        switch (status) {
          case 'completed':
            icon = '\u2705';
            label = 'completed';
            break;
          case 'running':
            icon = '\u23f3';
            label = 'running';
            break;
          case 'failed':
            icon = '\u274c';
            label = 'failed';
            break;
          case 'skipped':
            icon = '\u23ed\ufe0f';
            label = 'skipped';
            break;
          default:
            icon = '\u23f8\ufe0f';
            label = 'pending';
        }

        let details = '';
        if (sessionState.result) {
          const dur = (sessionState.result.duration / 1000).toFixed(0);
          const tokens = (sessionState.result.tokensUsed / 1000).toFixed(1);
          details = `  (${dur}s, ${tokens}K tokens)`;
        }

        console.log(`  ${sessionId}  ${icon} ${label}${details}`);
      }

      console.log('\u2500'.repeat(50));
      console.log('');
      process.exit(0);
    } catch (err: unknown) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
