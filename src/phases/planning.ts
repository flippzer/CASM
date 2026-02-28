// S06: Phase 2 — Planning (PRD → Session Manifest)

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, SDKResultSuccess, SDKResultError } from '@anthropic-ai/claude-agent-sdk';
import ora from 'ora';
import type { CasmConfig } from '../config.js';
import type { SessionManifest } from '../manifest/types.js';
import { parseManifestJson, saveManifest } from '../manifest/parser.js';
import { validateManifest } from '../manifest/dag.js';
import { logger } from '../utils/logger.js';
import { readFileContent } from '../utils/file-ops.js';

const MODEL_MAP: Record<string, string> = {
  opus: 'claude-opus-4-5',
  sonnet: 'claude-sonnet-4-5',
};

export interface PlanningResult {
  manifestPath: string;
  manifest: SessionManifest;
  tokensUsed: number;
  duration: number;
}

/**
 * Phase 2: transforms a PRD into a SessionManifest JSON.
 *
 * 1. Read template from templates/planning-prompt.md
 * 2. Replace {{ARCHITECTURE_CONTENT}} with the contents of architecturePath
 * 3. Call Claude Opus via query() with allowedTools: [] (text response only)
 * 4. Capture message.type === 'result' to get responseText
 * 5. Parse responseText with parseManifestJson()
 * 6. Validate with validateManifest() — throw if invalid
 * 7. Save with saveManifest() to {cwd}/.casm/manifest.json
 * 8. Return complete PlanningResult
 */
export async function runPlanning(
  architecturePath: string,
  cwd: string,
  casmConfig: CasmConfig,
): Promise<PlanningResult> {
  const startTime = Date.now();

  // 1. Read template
  const thisDir = fileURLToPath(new URL('.', import.meta.url));
  const templatePath = resolve(thisDir, '../../templates/planning-prompt.md');
  const template = await readFileContent(templatePath);

  if (!template) {
    throw new Error(`Planning template not found at ${templatePath}`);
  }

  // 2. Read architecture and build prompt
  const architectureContent = await readFileContent(architecturePath);

  if (!architectureContent) {
    throw new Error(`Architecture file not found or empty at ${architecturePath}`);
  }

  const prompt = template.replace('{{ARCHITECTURE_CONTENT}}', architectureContent);

  // 3. Call Claude Opus with no tools (text-only response)
  const model = MODEL_MAP[casmConfig.planningModel] ?? 'claude-opus-4-5';
  const spinner = ora('Running planning phase — generating session manifest...').start();

  let responseText = '';
  let tokensUsed = 0;

  try {
    const q = query({
      prompt,
      options: {
        cwd,
        maxTurns: 3,
        allowedTools: [],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        model,
      },
    });

    for await (const message of q) {
      logPlanningMessage(message);

      if (message.type === 'result') {
        const resultMsg = message as SDKResultSuccess | SDKResultError;
        tokensUsed = resultMsg.usage.input_tokens + resultMsg.usage.output_tokens;

        if (resultMsg.subtype !== 'success') {
          const errorMsg = resultMsg as SDKResultError;
          const errorStr = errorMsg.errors.join('\n') || `Planning session ended with: ${errorMsg.subtype}`;
          spinner.fail('Planning phase failed');
          throw new Error(errorStr);
        }

        responseText = resultMsg.result;
      }
    }

    // 5. Parse the JSON response
    if (!responseText) {
      spinner.fail('Planning phase returned empty response');
      throw new Error('Claude returned an empty response during planning phase');
    }

    const manifest = parseManifestJson(responseText);

    // 6. Validate
    const errors = validateManifest(manifest);
    if (errors.length > 0) {
      spinner.fail('Generated manifest is invalid');
      throw new Error(`Invalid manifest generated:\n  - ${errors.join('\n  - ')}`);
    }

    // 7. Save
    const manifestPath = join(cwd, '.casm', 'manifest.json');
    await saveManifest(manifest, manifestPath);

    const duration = Date.now() - startTime;

    spinner.succeed(
      `Planning complete — ${manifest.total_sessions} sessions generated (${tokensUsed} tokens, ${(duration / 1000).toFixed(1)}s)`,
    );

    // 8. Return
    return {
      manifestPath,
      manifest,
      tokensUsed,
      duration,
    };
  } catch (err: unknown) {
    spinner.fail('Planning phase failed');
    throw err;
  }
}

function logPlanningMessage(message: SDKMessage): void {
  switch (message.type) {
    case 'system':
      logger.verbose(`[planning] system:${message.subtype}`);
      break;
    case 'assistant':
      logger.verbose('[planning] assistant message');
      break;
    case 'result':
      logger.verbose(`[planning] result:${message.subtype}`);
      break;
    default:
      logger.verbose(`[planning] ${message.type}`);
  }
}
