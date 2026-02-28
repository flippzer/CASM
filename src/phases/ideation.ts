// S05: Phase 1 — Ideation (Idea → PRD)

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, SDKResultSuccess, SDKResultError } from '@anthropic-ai/claude-agent-sdk';
import ora from 'ora';
import type { CasmConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { readFileContent, fileExists } from '../utils/file-ops.js';

const MODEL_MAP: Record<string, string> = {
  opus: 'claude-opus-4-5',
  sonnet: 'claude-sonnet-4-5',
};

export interface IdeationResult {
  architecturePath: string;
  content: string;
  tokensUsed: number;
  duration: number;
}

/**
 * Phase 1: transforms a raw idea into an architectural PRD.
 *
 * 1. Read template from templates/ideation-prompt.md
 * 2. Replace {{PROJECT_IDEA}} with the user's idea
 * 3. Call Claude Opus via query() with allowedTools: ['Write']
 * 4. Claude Opus saves architecture.md itself inside cwd
 * 5. Verify architecture.md exists after execution
 * 6. Return the IdeationResult
 */
export async function runIdeation(
  idea: string,
  cwd: string,
  casmConfig: CasmConfig,
): Promise<IdeationResult> {
  const startTime = Date.now();

  // 1. Resolve template path relative to this file's location
  const thisDir = fileURLToPath(new URL('.', import.meta.url));
  const templatePath = resolve(thisDir, '../../templates/ideation-prompt.md');
  const template = await readFileContent(templatePath);

  if (!template) {
    throw new Error(`Ideation template not found at ${templatePath}`);
  }

  // 2. Build prompt
  const prompt = template.replace('{{PROJECT_IDEA}}', idea);

  // 3. Call Claude Opus
  const model = MODEL_MAP[casmConfig.planningModel] ?? 'claude-opus-4-5';
  const architecturePath = join(cwd, 'architecture.md');

  const spinner = ora('Running ideation phase — generating architecture PRD...').start();

  let tokensUsed = 0;

  try {
    const q = query({
      prompt,
      options: {
        cwd,
        maxTurns: 10,
        allowedTools: ['Write'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        model,
      },
    });

    for await (const message of q) {
      logIdeationMessage(message);

      if (message.type === 'result') {
        const resultMsg = message as SDKResultSuccess | SDKResultError;
        tokensUsed = resultMsg.usage.input_tokens + resultMsg.usage.output_tokens;

        if (resultMsg.subtype !== 'success') {
          const errorMsg = resultMsg as SDKResultError;
          const errorStr = errorMsg.errors.join('\n') || `Ideation session ended with: ${errorMsg.subtype}`;
          spinner.fail('Ideation phase failed');
          throw new Error(errorStr);
        }
      }
    }

    // 5. Verify architecture.md exists
    if (!fileExists(architecturePath)) {
      spinner.fail('architecture.md was not created');
      throw new Error(`Claude did not create architecture.md at ${architecturePath}`);
    }

    const content = await readFileContent(architecturePath);
    const duration = Date.now() - startTime;

    spinner.succeed(`Ideation complete — architecture.md generated (${tokensUsed} tokens, ${(duration / 1000).toFixed(1)}s)`);

    return {
      architecturePath,
      content,
      tokensUsed,
      duration,
    };
  } catch (err: unknown) {
    spinner.fail('Ideation phase failed');
    throw err;
  }
}

/** Reads an existing architecture.md file (for --split without --plan). */
export async function loadArchitecture(architecturePath: string): Promise<string> {
  if (!fileExists(architecturePath)) {
    throw new Error(`Architecture file not found: ${architecturePath}`);
  }

  const content = await readFileContent(architecturePath);

  if (!content) {
    throw new Error(`Architecture file is empty: ${architecturePath}`);
  }

  return content;
}

function logIdeationMessage(message: SDKMessage): void {
  switch (message.type) {
    case 'system':
      logger.verbose(`[ideation] system:${message.subtype}`);
      break;
    case 'assistant':
      logger.verbose('[ideation] assistant message');
      break;
    case 'result':
      logger.verbose(`[ideation] result:${message.subtype}`);
      break;
    default:
      logger.verbose(`[ideation] ${message.type}`);
  }
}
