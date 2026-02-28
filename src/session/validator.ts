// S04: Validator & Retry Logic

import { execa } from 'execa';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { ValidationRule, SessionDef, SessionResult } from '../manifest/types.js';
import type { CasmConfig } from '../config.js';
import { buildRunConfig, runSession } from './runner.js';
import { buildContextPayload, buildSessionPrompt } from './context-builder.js';
import { logger } from '../utils/logger.js';

export interface ValidationResult {
  passed: boolean;
  output: string;
  exitCode: number;
  duration: number;
}

export async function validateSession(
  rule: ValidationRule,
  cwd: string,
): Promise<ValidationResult> {
  const startTime = Date.now();

  switch (rule.type) {
    case 'none':
      return { passed: true, output: 'No validation configured', exitCode: 0, duration: 0 };

    case 'file_exists': {
      const files = rule.files ?? [];
      return validateOutputFiles(files, cwd);
    }

    case 'type_check':
      return runValidationCommand('npx tsc --noEmit', 0, cwd, startTime);

    case 'test':
      return runValidationCommand('npm test', 0, cwd, startTime);

    case 'command': {
      const command = rule.command ?? '';
      const expectedExit = rule.expected_exit_code ?? 0;
      return runValidationCommand(command, expectedExit, cwd, startTime);
    }
  }
}

export async function validateOutputFiles(
  outputFiles: string[],
  cwd: string,
): Promise<ValidationResult> {
  const startTime = Date.now();
  const missing: string[] = [];

  for (const file of outputFiles) {
    const fullPath = join(cwd, file);
    try {
      await access(fullPath);
    } catch {
      missing.push(file);
    }
  }

  const duration = Date.now() - startTime;

  if (missing.length === 0) {
    return {
      passed: true,
      output: `All ${outputFiles.length} output file(s) exist.`,
      exitCode: 0,
      duration,
    };
  }

  return {
    passed: false,
    output: `Missing files: ${missing.join(', ')}`,
    exitCode: 1,
    duration,
  };
}

async function runValidationCommand(
  command: string,
  expectedExitCode: number,
  cwd: string,
  startTime: number,
): Promise<ValidationResult> {
  try {
    const result = await execa({
      cwd,
      shell: true,
      timeout: 120_000,
      reject: false,
    })`${command}`;

    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    const exitCode = result.exitCode ?? 1;
    const passed = exitCode === expectedExitCode;

    return {
      passed,
      output: output || (passed ? 'Validation passed.' : `Exit code ${exitCode} (expected ${expectedExitCode})`),
      exitCode,
      duration: Date.now() - startTime,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      passed: false,
      output: `Validation command failed: ${errorMsg}`,
      exitCode: 1,
      duration: Date.now() - startTime,
    };
  }
}

export function buildRetryPrompt(
  _session: SessionDef,
  originalPrompt: string,
  validationError: string,
  attemptNumber: number,
): string {
  return `${originalPrompt}

---

## RETRY ATTEMPT ${attemptNumber} — PREVIOUS VALIDATION FAILED

The previous implementation attempt failed validation.

Error output:
${validationError}

Instructions:
1. Read the error output carefully.
2. Identify the root cause.
3. Fix the issue(s) in the relevant files.
4. Run the validation command again to confirm the fix.

Do NOT start over from scratch — only fix what is broken.`;
}

export async function executeWithRetry(
  session: SessionDef,
  basePrompt: string,
  cwd: string,
  casmConfig: CasmConfig,
  onAttempt?: (attempt: number, total: number) => void,
): Promise<SessionResult & { finalValidation: ValidationResult }> {
  const maxRetries = casmConfig.maxRetriesPerSession;
  const totalAttempts = maxRetries + 1;
  let lastResult: SessionResult | undefined;
  let lastValidation: ValidationResult | undefined;
  let currentPrompt = basePrompt;
  let totalTokensUsed = 0;
  const overallStartTime = Date.now();

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    onAttempt?.(attempt + 1, totalAttempts);
    logger.session(session.id, `Attempt ${attempt + 1}/${totalAttempts}`);

    const config = buildRunConfig(session, currentPrompt, cwd, casmConfig);
    lastResult = await runSession(config);
    totalTokensUsed += lastResult.tokensUsed;

    if (!lastResult.success) {
      logger.session(session.id, `Session execution failed: ${lastResult.error}`);
      lastValidation = {
        passed: false,
        output: lastResult.error ?? 'Session execution failed',
        exitCode: 1,
        duration: 0,
      };
      break;
    }

    lastValidation = await validateSession(session.validation, cwd);

    if (session.output_files.length > 0 && lastValidation.passed) {
      const fileValidation = await validateOutputFiles(session.output_files, cwd);
      if (!fileValidation.passed) {
        lastValidation = fileValidation;
      }
    }

    if (lastValidation.passed) {
      logger.session(session.id, `Validation passed on attempt ${attempt + 1}`);
      return {
        ...lastResult,
        tokensUsed: totalTokensUsed,
        attempts: attempt + 1,
        duration: Date.now() - overallStartTime,
        validationOutput: lastValidation.output,
        finalValidation: lastValidation,
      };
    }

    logger.session(session.id, `Validation failed: ${lastValidation.output}`);

    if (attempt < maxRetries) {
      currentPrompt = buildRetryPrompt(session, basePrompt, lastValidation.output, attempt + 1);
    }
  }

  logger.session(session.id, `All ${totalAttempts} attempt(s) exhausted`);

  return {
    ...(lastResult as SessionResult),
    success: false,
    tokensUsed: totalTokensUsed,
    attempts: totalAttempts,
    duration: Date.now() - overallStartTime,
    validationOutput: lastValidation?.output ?? '',
    error: lastValidation?.output ?? 'Validation failed after all retries',
    finalValidation: lastValidation as ValidationResult,
  };
}
