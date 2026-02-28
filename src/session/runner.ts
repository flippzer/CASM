// S03: Session runner

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, SDKSystemMessage, SDKResultSuccess, SDKResultError } from '@anthropic-ai/claude-agent-sdk';
import type { SessionDef, SessionResult, SessionRunConfig } from '../manifest/types.js';
import type { CasmConfig } from '../config.js';
import { logger } from '../utils/logger.js';

const MODEL_MAP: Record<string, SessionRunConfig['model']> = {
  sonnet: 'claude-sonnet-4-5',
  haiku: 'claude-haiku-4-5',
  opus: 'claude-opus-4-5',
};

export function buildRunConfig(
  session: SessionDef,
  prompt: string,
  cwd: string,
  casmConfig: CasmConfig,
): SessionRunConfig {
  return {
    id: session.id,
    prompt,
    cwd,
    maxTurns: session.max_turns ?? casmConfig.maxTurnsPerSession,
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'MultiEdit'],
    permissionMode: casmConfig.permissionMode,
    model: MODEL_MAP[casmConfig.model] ?? 'claude-sonnet-4-5',
  };
}

export async function runSession(config: SessionRunConfig): Promise<SessionResult> {
  const startTime = Date.now();
  let sessionId = config.id;
  let resultText = '';
  let tokensUsed = 0;
  let filesModified: string[] = [];

  try {
    logger.session(config.id, `Starting session (model: ${config.model}, maxTurns: ${config.maxTurns})`);

    const q = query({
      prompt: config.prompt,
      options: {
        cwd: config.cwd,
        maxTurns: config.maxTurns,
        allowedTools: config.allowedTools,
        permissionMode: config.permissionMode,
        allowDangerouslySkipPermissions: config.permissionMode === 'bypassPermissions',
        model: config.model,
        systemPrompt: config.systemPrompt,
      },
    });

    for await (const message of q) {
      logMessage(config.id, message);

      if (message.type === 'system' && message.subtype === 'init') {
        const initMsg = message as SDKSystemMessage;
        sessionId = initMsg.session_id;
        logger.session(config.id, `Session initialized: ${sessionId}`);
      }

      if (message.type === 'result') {
        const resultMsg = message as SDKResultSuccess | SDKResultError;
        tokensUsed = resultMsg.usage.input_tokens + resultMsg.usage.output_tokens;

        if (resultMsg.subtype === 'success') {
          resultText = (resultMsg as SDKResultSuccess).result;
        } else {
          const errorMsg = resultMsg as SDKResultError;
          const errorStr = errorMsg.errors.join('\n') || `Session ended with: ${errorMsg.subtype}`;
          logger.error(`Session ${config.id} failed: ${errorStr}`);
          return {
            sessionId,
            success: false,
            tokensUsed,
            filesModified,
            result: '',
            error: errorStr,
            attempts: 1,
            duration: Date.now() - startTime,
            validationOutput: '',
          };
        }
      }
    }

    logger.session(config.id, `Session completed (${tokensUsed} tokens)`);

    return {
      sessionId,
      success: true,
      tokensUsed,
      filesModified,
      result: resultText,
      attempts: 1,
      duration: Date.now() - startTime,
      validationOutput: '',
    };
  } catch (err: unknown) {
    const errorStr = err instanceof Error ? err.message : String(err);
    logger.error(`Session ${config.id} threw: ${errorStr}`);

    return {
      sessionId,
      success: false,
      tokensUsed,
      filesModified,
      result: '',
      error: errorStr,
      attempts: 1,
      duration: Date.now() - startTime,
      validationOutput: '',
    };
  }
}

function logMessage(id: string, message: SDKMessage): void {
  switch (message.type) {
    case 'system':
      logger.session(id, `system:${message.subtype}`);
      break;
    case 'assistant':
      logger.verbose(`[${id}] assistant message`);
      break;
    case 'result':
      logger.session(id, `result:${message.subtype}`);
      break;
    default:
      logger.verbose(`[${id}] ${message.type}`);
  }
}
