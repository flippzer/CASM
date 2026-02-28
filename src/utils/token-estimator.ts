import { readFile } from 'node:fs/promises';
import { encoding_for_model } from 'tiktoken';

export const TOKEN_BUDGETS = {
  SESSION_PROMPT: 30000,
  SESSION_TOTAL: 80000,
  CONTEXT_OVERHEAD: 3000,
} as const;

let encoder: ReturnType<typeof encoding_for_model> | null = null;

function getEncoder(): ReturnType<typeof encoding_for_model> {
  if (!encoder) {
    encoder = encoding_for_model('gpt-4o');
  }
  return encoder;
}

export function estimateTokens(text: string): number {
  const enc = getEncoder();
  const tokens = enc.encode(text);
  return tokens.length;
}

export async function estimateFileTokens(filePath: string): Promise<number> {
  const content = await readFile(filePath, 'utf-8');
  return estimateTokens(content);
}

export function estimatePromptTokens(parts: string[]): number {
  return parts.reduce((sum, part) => sum + estimateTokens(part), 0);
}
