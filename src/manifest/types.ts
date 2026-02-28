// S02: Manifest types

export interface ValidationRule {
  type: 'command' | 'file_exists' | 'type_check' | 'test' | 'none';
  command?: string;
  files?: string[];
  expected_exit_code?: number;
}

export interface SessionDef {
  id: string;
  name: string;
  description: string;
  depends_on: string[];
  context_files: string[];
  output_files: string[];
  validation: ValidationRule;
  estimated_tokens: number;
  max_turns: number;
  prompt: string;
}

export interface SessionManifest {
  project: string;
  version: string;
  total_sessions: number;
  execution_model: 'sequential' | 'parallel';
  sessions: SessionDef[];
  created_at: string;
  architecture_file?: string;
}

export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface SessionResult {
  sessionId: string;
  success: boolean;
  tokensUsed: number;
  filesModified: string[];
  result: string;
  error?: string;
  attempts: number;
  duration: number;
  validationOutput: string;
}

export interface ExecutionState {
  projectDir: string;
  manifestPath: string;
  startedAt: string;
  sessions: Record<string, {
    status: SessionStatus;
    result?: SessionResult;
    completedAt?: string;
  }>;
}

export interface SessionHandoff {
  sessionId: string;
  sessionName: string;
  status: 'completed' | 'failed';
  filesCreated: string[];
  filesModified: string[];
  keyDecisions: string[];
  interfacesExposed: string[];
  validationResult: string;
  notesForDownstream: string;
}

export interface SessionRunConfig {
  id: string;
  prompt: string;
  cwd: string;
  maxTurns: number;
  allowedTools: string[];
  permissionMode: 'bypassPermissions' | 'acceptEdits';
  systemPrompt?: string;
  model: 'claude-opus-4-5' | 'claude-sonnet-4-5' | 'claude-haiku-4-5';
}
