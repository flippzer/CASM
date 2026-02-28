import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const CasmConfigSchema = z.object({
  model: z.enum(['sonnet', 'haiku']).default('sonnet'),
  planningModel: z.enum(['opus', 'sonnet']).default('opus'),
  maxRetriesPerSession: z.number().int().min(0).default(2),
  maxTurnsPerSession: z.number().int().min(1).default(50),
  tokenBudgetPerSession: z.number().int().min(1000).default(80000),
  permissionMode: z.enum(['bypassPermissions', 'acceptEdits']).default('bypassPermissions'),
  validation: z.object({
    typeCheck: z.boolean().default(true),
    lint: z.boolean().default(false),
    test: z.boolean().default(false),
  }).default({ typeCheck: true, lint: false, test: false }),
  output: z.object({
    logsDir: z.string().default('.casm/logs'),
    handoffsDir: z.string().default('.casm/handoffs'),
    verbose: z.boolean().default(false),
  }).default({ logsDir: '.casm/logs', handoffsDir: '.casm/handoffs', verbose: false }),
});

export type CasmConfig = z.infer<typeof CasmConfigSchema>;

export const DEFAULT_CONFIG: CasmConfig = CasmConfigSchema.parse({});

export function loadConfig(cwd: string): CasmConfig {
  const configPath = join(cwd, '.casmrc.json');

  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);

  return CasmConfigSchema.parse(parsed);
}
