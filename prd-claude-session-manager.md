# PRD: Claude Code Autonomous Session Manager (CASM)

> **Version:** 1.0.0
> **Date:** February 26, 2026
> **Status:** Draft
> **Author:** AI Architecture Team

---

## 1. Executive Summary

Claude Code Autonomous Session Manager (CASM) is a CLI orchestration tool that solves the fundamental problem of **context degradation in long-running Claude Code sessions**. When developers run large plans in a single Claude Code session, the 200K token context window fills up, triggering auto-compaction at ~83.5% utilization (~167K tokens). This lossy compression causes Claude to lose critical details, produce abstractions instead of concrete implementations, and generate progressively worse output — a phenomenon known as **context rot**.

The current workaround — manually splitting work into sessions, killing terminals between tasks, and copy-pasting context — is tedious, error-prone, and requires constant human monitoring.

CASM automates this entire workflow: it takes a high-level idea, generates an architectural PRD, decomposes the PRD into context-optimized sessions, and executes each session autonomously using the **Claude Agent SDK (TypeScript)**, with clean context boundaries between every session. Each session starts fresh with only the precise context it needs, producing implementation quality equivalent to a focused single-task session.

---

## 2. Problem Statement

### 2.1 The Context Degradation Problem

Claude Code operates within a 200K token context window (standard). The system reserves a ~33K token buffer for compaction operations, leaving ~167K tokens of usable space. As a session progresses:

1. **Token accumulation**: System prompt (~2.7K), tools (~16.8K), CLAUDE.md files (~7.4K), and conversation history consume context progressively.
2. **Auto-compaction triggers at ~83.5%**: When free space hits zero (accounting for the 33K buffer), Claude Code compacts the conversation — a lossy summarization that discards implementation details.
3. **Quality degradation cascade**: Post-compaction, Claude loses awareness of earlier decisions, file states, and architectural constraints. It begins to hallucinate interfaces, duplicate work, and produce increasingly abstract (non-functional) code.
4. **Infinite compaction loops**: In worst cases, repeated compaction creates a death spiral where Claude can no longer reason effectively about the project.

### 2.2 The Manual Workaround (Current State)

Experienced Claude Code users have converged on a manual pattern:

1. Break a project into discrete tasks mentally.
2. Start a Claude Code session for task 1.
3. Wait for completion. Copy/note any outputs.
4. Kill the terminal (fully clearing context).
5. Start a new session for task 2, manually providing prior context.
6. Repeat until done.

**Pain points:**
- Requires constant human monitoring and intervention.
- Context handoff between sessions is manual and error-prone.
- No systematic way to determine optimal session boundaries.
- No automated validation that each session completed successfully.
- Cannot run unattended (e.g., overnight).

### 2.3 Why Existing Solutions Are Insufficient

| Approach | Limitation |
|---|---|
| `/compact` command | Lossy — discards details. Doesn't prevent context rot, only delays it. |
| `--resume` / `--continue` | Resumes the *same* bloated context. Does not solve the root problem. |
| `--max-turns` | Limits iterations but doesn't control context quality. |
| 1M context beta | Delays the problem but doesn't eliminate it. Premium pricing (2x input). Still degrades. |
| Custom subagents | Brittle. Main agent + subagent share parent context, amplifying bloat. |

---

## 3. Proposed Solution: CASM Architecture

### 3.1 Core Architecture

```
┌─────────────────────────────────────────────────────┐
│                   CASM Orchestrator                  │
│              (Node.js / TypeScript CLI)              │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────┐    ┌──────────┐    ┌────────────────┐  │
│  │  Phase 1 │───▶│ Phase 2  │───▶│    Phase 3     │  │
│  │  Ideation│    │ Planning │    │   Execution    │  │
│  │  & PRD   │    │ & Split  │    │   Loop         │  │
│  └─────────┘    └──────────┘    └────────────────┘  │
│       │              │               │               │
│       ▼              ▼               ▼               │
│  ┌─────────┐    ┌──────────┐    ┌────────────────┐  │
│  │ Arch    │    │ Session  │    │  Per-Session    │  │
│  │ Document│    │ Manifest │    │  Clean Context  │  │
│  │ (.md)   │    │ (.json)  │    │  Execution      │  │
│  └─────────┘    └──────────┘    └────────────────┘  │
│                                      │               │
│                                      ▼               │
│                                ┌────────────────┐    │
│                                │  Validation &  │    │
│                                │  Handoff File  │    │
│                                │  Generation    │    │
│                                └────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### 3.2 Technology Choice: Claude Agent SDK (TypeScript)

**Why the Agent SDK over CLI `claude -p`:**

| Factor | Agent SDK | CLI (`claude -p`) |
|---|---|---|
| Session management | Native `createSession()` / `resumeSession()` with V2 preview | Buggy `--resume` in non-interactive mode (GitHub issue #3976) |
| Structured output | Native message streaming with typed objects | Requires `--output-format json` + parsing |
| Permission control | Programmatic `CanUseTool` callbacks, `permissionMode` | `--allowedTools` flag only |
| Context awareness | Access to `SDKSystemMessage` with token usage | No programmatic access to context state |
| Error handling | Try/catch with typed errors, `interrupt()` method | Exit codes only |
| Multi-turn | V2: `send()` / `stream()` / `receive()` pattern | Requires piping and session ID capture |
| Configuration | `settingSources`, `systemPrompt`, `agents` in code | Flags only |

**SDK Installation:**
```bash
npm install @anthropic-ai/claude-agent-sdk
```

**Execution Model:**
Each session runs as an independent `query()` call with `permissionMode: "bypassPermissions"`. No session state carries over. Context is controlled exclusively through the prompt and injected files.

### 3.3 Three-Phase Pipeline

#### Phase 1: Ideation → Architectural PRD Generation

**Input:** User's raw idea (text, markdown, or conversational description).
**Output:** A comprehensive architectural document (`.md`) saved to the project.

The orchestrator invokes a single Claude Agent SDK `query()` to transform the user's idea into a structured PRD containing:
- Project overview and goals
- Technical architecture and technology choices
- File/folder structure
- Data models and interfaces
- API contracts
- Dependency map between components
- Explicit session decomposition hints (which components depend on which)

#### Phase 2: PRD → Session Manifest Generation

**Input:** The architectural PRD from Phase 1.
**Output:** A `session-manifest.json` — a DAG (Directed Acyclic Graph) of sessions with dependencies, context requirements, and validation criteria.

A second independent `query()` call analyzes the PRD and produces a structured JSON manifest:

```json
{
  "project": "my-project",
  "total_sessions": 8,
  "sessions": [
    {
      "id": "S01",
      "name": "project-scaffolding",
      "description": "Initialize project structure, configs, and dependencies",
      "depends_on": [],
      "context_files": ["architecture.md"],
      "output_files": ["package.json", "tsconfig.json", "src/index.ts"],
      "validation": {
        "type": "command",
        "command": "npm run build",
        "expected_exit_code": 0
      },
      "estimated_tokens": 15000,
      "max_turns": 30,
      "prompt": "..."
    },
    {
      "id": "S02",
      "name": "database-models",
      "description": "Create database schema and ORM models",
      "depends_on": ["S01"],
      "context_files": ["architecture.md", "src/index.ts"],
      "output_files": ["src/models/*.ts", "src/db/schema.ts"],
      "validation": {
        "type": "command",
        "command": "npx tsc --noEmit",
        "expected_exit_code": 0
      },
      "estimated_tokens": 25000,
      "max_turns": 50,
      "prompt": "..."
    }
  ]
}
```

**Session Decomposition Principles:**
1. **Single Responsibility**: Each session does ONE logical unit of work (one module, one feature, one layer).
2. **Minimal Context Injection**: Only files that the session *directly needs* are injected. No full project dumps.
3. **Token Budget**: Each session should target < 80K tokens total usage (40% of 200K), leaving generous headroom for reasoning.
4. **Explicit Outputs**: Every session declares what files it will create/modify — this becomes the handoff contract.
5. **Dependency Order**: Sessions form a DAG. Dependent sessions only start after their prerequisites validate successfully.
6. **Validation Gates**: Every session has a pass/fail validation step (type check, test, build, or file existence).

#### Phase 3: Autonomous Execution Loop

The orchestrator walks the session DAG in topological order:

```
For each session in topological_sort(manifest.sessions):
  1. Wait for all depends_on sessions to complete + validate
  2. Gather context: read context_files from disk (current state)
  3. Build prompt: session.prompt + injected file contents + handoff summary
  4. Execute: query({ prompt, options }) — fresh context, no history
  5. Stream output, capture result
  6. Validate: run session.validation command
  7. If validation fails:
     a. Retry up to 2 times with error context injected
     b. If still failing, pause and alert user
  8. Generate handoff summary for downstream sessions
  9. Log session metadata (tokens used, time, files changed)
  10. Proceed to next session
```

---

## 4. Detailed Design

### 4.1 Project Structure

```
casm/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # CLI entry point
│   ├── orchestrator.ts          # Main pipeline controller
│   ├── phases/
│   │   ├── ideation.ts          # Phase 1: Idea → PRD
│   │   ├── planning.ts          # Phase 2: PRD → Session Manifest
│   │   └── execution.ts         # Phase 3: Execute sessions
│   ├── session/
│   │   ├── runner.ts            # Single session executor (SDK wrapper)
│   │   ├── validator.ts         # Post-session validation
│   │   ├── context-builder.ts   # Context injection & prompt assembly
│   │   └── handoff.ts           # Handoff summary generation
│   ├── manifest/
│   │   ├── types.ts             # Session manifest types
│   │   ├── dag.ts               # DAG operations (toposort, validation)
│   │   └── parser.ts            # Manifest JSON parser
│   ├── utils/
│   │   ├── logger.ts            # Structured logging
│   │   ├── token-estimator.ts   # Token count estimation
│   │   └── file-ops.ts          # File read/write helpers
│   └── config.ts                # Configuration and defaults
├── templates/
│   ├── ideation-prompt.md       # Phase 1 system prompt template
│   ├── planning-prompt.md       # Phase 2 system prompt template
│   └── session-prompt.md        # Phase 3 session prompt template
└── .claude/
    └── CLAUDE.md                # Project-level Claude memory
```

### 4.2 Session Runner (Core Engine)

```typescript
// src/session/runner.ts
import { query } from "@anthropic-ai/claude-agent-sdk";

interface SessionConfig {
  id: string;
  prompt: string;
  cwd: string;
  maxTurns: number;
  allowedTools: string[];
  permissionMode: "bypassPermissions" | "acceptEdits";
  systemPrompt?: string;
  model: "sonnet" | "opus" | "haiku";
}

interface SessionResult {
  sessionId: string;
  success: boolean;
  tokensUsed: number;
  filesModified: string[];
  result: string;
  error?: string;
}

async function runSession(config: SessionConfig): Promise<SessionResult> {
  let sessionId = "";
  let tokensUsed = 0;
  let resultText = "";

  try {
    for await (const message of query({
      prompt: config.prompt,
      options: {
        model: config.model,
        cwd: config.cwd,
        maxTurns: config.maxTurns,
        allowedTools: config.allowedTools,
        permissionMode: config.permissionMode,
        systemPrompt: config.systemPrompt
          ? { type: "custom", custom: config.systemPrompt }
          : { type: "preset", preset: "claude_code" },
        settingSources: ["project"],
      },
    })) {
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
      }
      if (message.type === "result") {
        resultText = message.result;
      }
    }

    return {
      sessionId,
      success: true,
      tokensUsed,
      filesModified: [],
      result: resultText,
    };
  } catch (error) {
    return {
      sessionId,
      success: false,
      tokensUsed,
      filesModified: [],
      result: "",
      error: String(error),
    };
  }
}
```

### 4.3 Context Builder (Anti-Bloat Engine)

The context builder is the critical component that prevents context degradation. It constructs the minimal prompt for each session:

```typescript
// src/session/context-builder.ts

interface ContextPayload {
  systemContext: string;    // Architecture overview (condensed)
  fileContents: string;     // Only files this session needs
  handoffSummary: string;   // What previous sessions did
  taskPrompt: string;       // The specific task for this session
  constraints: string;      // Explicit boundaries and rules
}

function buildSessionPrompt(payload: ContextPayload): string {
  return `
## PROJECT ARCHITECTURE (Reference Only — Do Not Modify)
${payload.systemContext}

## CURRENT FILE STATE (Files You May Need to Read/Reference)
${payload.fileContents}

## PREVIOUS SESSION OUTCOMES (What Has Been Done)
${payload.handoffSummary}

## YOUR TASK FOR THIS SESSION
${payload.taskPrompt}

## CONSTRAINTS
${payload.constraints}
- Only create/modify the files listed in your task scope.
- Do NOT refactor or touch files outside your scope.
- If you encounter a dependency that doesn't exist yet, stub it with a TODO comment.
- Write complete, production-quality implementations — no placeholders, no "// implementation here".
- Run any available tests/linters before declaring completion.
`.trim();
}
```

**Token Budget Strategy:**

| Component | Target Budget | Notes |
|---|---|---|
| System context (architecture) | < 5K tokens | Condensed overview, not full PRD |
| Injected file contents | < 20K tokens | Only files this session directly touches |
| Handoff summary | < 3K tokens | Structured bullet points from prior sessions |
| Task prompt + constraints | < 2K tokens | Focused, specific instructions |
| **Total prompt input** | **< 30K tokens** | Leaves 137K+ for reasoning and output |

### 4.4 Handoff File System

After each session, a structured handoff file is generated:

```
.casm/
├── manifest.json              # Session manifest (Phase 2 output)
├── state.json                 # Current execution state
├── handoffs/
│   ├── S01-scaffolding.md     # Session 1 handoff
│   ├── S02-models.md          # Session 2 handoff
│   └── ...
├── logs/
│   ├── S01.log                # Full session log
│   └── ...
└── architecture.md            # Phase 1 output (PRD)
```

Each handoff file follows a strict template:

```markdown
# Session S01: Project Scaffolding — COMPLETED ✅

## Files Created
- `package.json` — Project manifest with all dependencies
- `tsconfig.json` — TypeScript configuration (strict mode)
- `src/index.ts` — Application entry point with Express server setup
- `src/config/env.ts` — Environment variable validation with Zod

## Key Decisions
- Using Express 5.x (async route handler support native)
- PostgreSQL via Drizzle ORM (chosen over Prisma for performance)
- Zod for all runtime validation

## Interfaces Exposed
- `startServer(port: number): Promise<void>` in `src/index.ts`
- `env` typed config object from `src/config/env.ts`

## Validation Result
- `npm run build` → exit code 0 ✅

## Notes for Downstream Sessions
- Database connection string expected in `DATABASE_URL` env var
- Server binds to `env.PORT` (default 3000)
```

### 4.5 Validation System

```typescript
// src/session/validator.ts

interface ValidationRule {
  type: "command" | "file_exists" | "type_check" | "test" | "custom";
  command?: string;
  files?: string[];
  expected_exit_code?: number;
}

async function validateSession(
  rule: ValidationRule,
  cwd: string
): Promise<{ passed: boolean; output: string }> {
  switch (rule.type) {
    case "command":
      const { exitCode, stdout, stderr } = await exec(rule.command!, { cwd });
      return {
        passed: exitCode === (rule.expected_exit_code ?? 0),
        output: stdout + stderr,
      };
    case "file_exists":
      const allExist = rule.files!.every((f) => existsSync(join(cwd, f)));
      return {
        passed: allExist,
        output: allExist ? "All files exist" : "Missing files detected",
      };
    case "type_check":
      return validateSession(
        { type: "command", command: "npx tsc --noEmit", expected_exit_code: 0 },
        cwd
      );
    case "test":
      return validateSession(
        { type: "command", command: "npm test", expected_exit_code: 0 },
        cwd
      );
    default:
      return { passed: true, output: "No validation configured" };
  }
}
```

### 4.6 Retry Logic with Error Context

When a session fails validation, CASM retries with the error injected:

```typescript
async function executeWithRetry(
  session: SessionDef,
  maxRetries: number = 2
): Promise<SessionResult> {
  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const prompt =
      attempt === 0
        ? buildSessionPrompt(session)
        : buildRetryPrompt(session, lastError, attempt);

    const result = await runSession({
      id: session.id,
      prompt,
      cwd: projectDir,
      maxTurns: session.max_turns,
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      permissionMode: "bypassPermissions",
      model: "sonnet",
    });

    const validation = await validateSession(session.validation, projectDir);

    if (validation.passed) {
      return { ...result, success: true };
    }

    lastError = validation.output;
    logger.warn(
      `Session ${session.id} attempt ${attempt + 1} failed: ${lastError}`
    );
  }

  logger.error(`Session ${session.id} failed after ${maxRetries + 1} attempts`);
  return { success: false, error: lastError };
}
```

---

## 5. Session Decomposition Strategy

### 5.1 Standard Decomposition Pattern (Web Application Example)

For a typical full-stack web application, CASM targets the following session structure:

| Session | Scope | Est. Tokens | Depends On |
|---|---|---|---|
| S01 — Scaffolding | Project init, configs, folder structure | ~15K | — |
| S02 — Data Layer | Database schema, ORM models, migrations | ~25K | S01 |
| S03 — Core Business Logic | Domain services, validation, business rules | ~30K | S02 |
| S04 — API Layer | Routes, controllers, middleware, error handling | ~30K | S03 |
| S05 — Authentication | Auth system, JWT, sessions, RBAC | ~25K | S04 |
| S06 — Frontend Foundation | App shell, routing, layout, design system | ~25K | S01 |
| S07 — Frontend Features | Feature pages, forms, state management | ~35K | S06, S04 |
| S08 — Integration & Polish | E2E wiring, error boundaries, final tests | ~30K | All |

### 5.2 Decomposition Rules

1. **One architectural layer per session**: Don't mix database + API + frontend in one session.
2. **One feature domain per session**: Auth is separate from billing is separate from notifications.
3. **Shared types/interfaces go early**: Session 1 or 2 should establish all shared contracts.
4. **Frontend and backend can parallelize**: If no dependency exists, sessions can run concurrently (future enhancement).
5. **Integration session is always last**: Final session wires everything together and runs E2E validation.
6. **Each session < 40K estimated output tokens**: This keeps total context well under the compaction threshold.

---

## 6. User Interface

### 6.1 CLI Commands

```bash
# Full pipeline: idea → PRD → sessions → execute
casm run "Build a SaaS project management app with Kanban boards"

# Phase 1 only: Generate PRD from idea
casm plan "Build a SaaS project management app with Kanban boards"

# Phase 2 only: Generate session manifest from existing PRD
casm split ./architecture.md

# Phase 3 only: Execute sessions from existing manifest
casm execute ./session-manifest.json

# Resume from a specific session (e.g., after S03 failed)
casm execute ./session-manifest.json --from S04

# Dry run: Show planned sessions without executing
casm execute ./session-manifest.json --dry-run

# Status: Show current execution progress
casm status
```

### 6.2 Configuration (`.casmrc.json`)

```json
{
  "model": "sonnet",
  "planningModel": "opus",
  "maxRetriesPerSession": 2,
  "maxTurnsPerSession": 50,
  "tokenBudgetPerSession": 80000,
  "permissionMode": "bypassPermissions",
  "validation": {
    "typeCheck": true,
    "lint": false,
    "test": false
  },
  "output": {
    "logsDir": ".casm/logs",
    "handoffsDir": ".casm/handoffs",
    "verbose": false
  }
}
```

---

## 7. Session Prompts Reference

Below are the exact prompts to use in Claude Code for each phase of the system. These prompts are designed to be used directly and can serve as the foundation for the CASM templates.

---

### 7.1 Phase 1 Prompt: Idea → Architectural PRD

> **When to use:** Paste your raw project idea and this prompt into a fresh Claude Code session (or use as the `ideation-prompt.md` template).

```markdown
You are a senior software architect. I will give you a project idea. Your job is to produce
a comprehensive architectural PRD document that another AI agent (Claude Code) can use to
implement the project in isolated sessions.

## YOUR TASK

Analyze the following project idea and produce a complete architectural document covering:

1. **Project Overview**: One paragraph summary, target users, core value proposition.
2. **Technical Stack**: Language, framework, database, hosting, and rationale for each choice.
3. **System Architecture**: High-level architecture diagram (in ASCII/mermaid), component
   breakdown, data flow description.
4. **File & Folder Structure**: Complete tree of every file and directory the project will
   contain, with a one-line description of each file's purpose.
5. **Data Models**: Every entity/model with all fields, types, relationships, and constraints.
   Use TypeScript interfaces or equivalent.
6. **API Contracts**: Every endpoint (REST/GraphQL) with method, path, request body, response
   body, auth requirements, and error cases. Use OpenAPI-style descriptions.
7. **Business Logic**: Key algorithms, workflows, state machines, validation rules. Be specific
   — describe the logic, not just "handles X".
8. **Authentication & Authorization**: Auth strategy, token management, role definitions,
   permission matrix.
9. **Frontend Architecture** (if applicable): Component hierarchy, state management strategy,
   routing structure, key UI flows.
10. **Dependency Map**: Which components depend on which others. This will be used to determine
    session execution order. Represent as a list of edges: "component A → depends on → component B".
11. **Testing Strategy**: Unit test approach, integration test approach, E2E test approach, what
    to test per component.
12. **Session Decomposition Hints**: Suggest how this project should be split into 6-12
    implementation sessions. Each session should:
    - Do ONE logical unit of work
    - Target < 40K output tokens
    - Have clear input dependencies and output deliverables
    - Include a validation command (build, test, type-check)

## RULES
- Be EXHAUSTIVE. Every file, every field, every endpoint must be specified.
- No hand-waving. "Handle errors appropriately" is not acceptable — specify the error handling.
- Use concrete types, not `any`. Use real library names, not "some ORM".
- The document must be self-contained: an implementer should need NOTHING else.
- Output as a single Markdown document.

## PROJECT IDEA
<INSERT_YOUR_IDEA_HERE>
```

---

### 7.2 Phase 2 Prompt: PRD → Session Manifest

> **When to use:** In a fresh Claude Code session, provide the architecture document from Phase 1 and this prompt.

```markdown
You are a session planning specialist for an AI coding agent orchestration system. Your job is
to analyze an architectural PRD and decompose it into isolated, context-optimized implementation
sessions.

## YOUR TASK

Read the attached architectural document and produce a JSON session manifest. Each session must
be an independent unit of work that can be executed in a fresh Claude Code context with ZERO
prior conversation history.

## OUTPUT FORMAT

Produce ONLY valid JSON matching this schema:

{
  "project": "<project-name>",
  "total_sessions": <number>,
  "execution_model": "sequential",
  "sessions": [
    {
      "id": "S01",
      "name": "<kebab-case-name>",
      "description": "<what this session accomplishes>",
      "depends_on": [],
      "context_files": ["<files to inject into prompt — paths relative to project root>"],
      "output_files": ["<files this session will create or modify>"],
      "validation": {
        "type": "command",
        "command": "<shell command to validate success>",
        "expected_exit_code": 0
      },
      "estimated_tokens": <estimated total tokens for this session>,
      "max_turns": <max agent turns allowed>,
      "prompt": "<THE COMPLETE PROMPT for this session — see rules below>"
    }
  ]
}

## SESSION DECOMPOSITION RULES

1. **Single Responsibility**: Each session does ONE thing — one layer, one feature, one module.
2. **Fresh Context**: Each session starts from ZERO. The prompt must contain ALL information
   the agent needs. Never assume the agent "remembers" anything.
3. **Token Budget**: Each session should estimate < 80K total tokens (input + output + reasoning).
   The prompt itself should be < 30K tokens.
4. **Explicit File Scope**: List every file the session will create or modify. The session
   MUST NOT touch files outside this scope.
5. **Dependency Order**: Sessions form a DAG. If S03 depends on S02, S02 must complete and
   validate before S03 starts.
6. **Validation Required**: Every session must have a validation step. Prefer `tsc --noEmit`
   for TypeScript, `npm test` if tests exist, or file existence checks.
7. **Prompt Completeness**: The `prompt` field must be a COMPLETE instruction that includes:
   - What to implement (specific files, functions, interfaces)
   - What conventions to follow (naming, patterns, error handling)
   - What NOT to do (scope boundaries)
   - References to architecture decisions (inline, not "see document")
   - Expected output format and quality bar

## ARCHITECTURE DOCUMENT
<PASTE_ARCHITECTURE_DOCUMENT_HERE>
```

---

### 7.3 Phase 3 Prompts: Individual Session Execution

> **When to use:** Each of these is a template. The orchestrator fills in the variables and runs each in a fresh `query()` call. If running manually, open a new Claude Code terminal for each session.

#### Session Template (Generic)

```markdown
# Session <SESSION_ID>: <SESSION_NAME>

## ROLE
You are an expert software engineer implementing one specific part of a larger project.
You are working in an isolated session — you have NO memory of previous sessions.
Everything you need to know is in this prompt.

## PROJECT ARCHITECTURE SUMMARY
<CONDENSED_ARCHITECTURE — max 5K tokens, covering only what this session needs>

## FILES ALREADY IN THE PROJECT
The following files already exist and were created by previous sessions. You can read them
but should NOT modify them unless explicitly listed in your task scope.

<LIST_OF_EXISTING_FILES_WITH_ONE_LINE_DESCRIPTIONS>

## FILES YOU MUST READ FOR CONTEXT
<INJECTED_CONTENTS_OF_CONTEXT_FILES — only files this session directly depends on>

## WHAT PREVIOUS SESSIONS ACCOMPLISHED
<HANDOFF_SUMMARIES — structured bullet points, max 3K tokens total>

## YOUR TASK
<SPECIFIC_TASK_DESCRIPTION>

Create/modify ONLY these files:
<LIST_OF_OUTPUT_FILES>

## IMPLEMENTATION REQUIREMENTS
- Write COMPLETE, PRODUCTION-QUALITY code. No placeholders, no TODOs, no "implement later".
- Follow the project's established patterns (see existing files for reference).
- Include proper error handling, input validation, and edge case coverage.
- Add JSDoc/TSDoc comments for all public interfaces.
- If you need a type/interface from another file, import it — do not redefine it.
- If a dependency doesn't exist yet (created by a future session), create a minimal stub
  file with a TODO comment explaining what it should contain.

## VALIDATION
When you are done, run: <VALIDATION_COMMAND>
If it fails, fix the issues and run it again until it passes.

## SCOPE BOUNDARIES — DO NOT VIOLATE
- Do NOT modify files outside your output scope.
- Do NOT install new dependencies unless absolutely required by YOUR task.
- Do NOT refactor existing code — only add/modify within your scope.
- Do NOT create tests unless testing is part of your task scope.
```

#### Session 1 Example: Project Scaffolding

```markdown
# Session S01: Project Scaffolding

## ROLE
You are an expert software engineer. Initialize the project from scratch.

## TASK
Set up the complete project foundation:

1. Initialize the project with `npm init`
2. Install ALL dependencies listed below (and only these):
   - Runtime: express@5, drizzle-orm, pg, zod, jsonwebtoken, bcrypt, cors, helmet
   - Dev: typescript, @types/node, @types/express, tsx, vitest, drizzle-kit, eslint
3. Create `tsconfig.json` with strict mode, ESNext target, NodeNext module resolution
4. Create `package.json` scripts:
   - `dev`: `tsx watch src/index.ts`
   - `build`: `tsc`
   - `start`: `node dist/index.js`
   - `test`: `vitest run`
   - `db:generate`: `drizzle-kit generate`
   - `db:migrate`: `drizzle-kit migrate`
5. Create the folder structure:
   ```
   src/
   ├── index.ts          (Express app setup, middleware, server start)
   ├── config/
   │   └── env.ts        (Zod-validated environment variables)
   ├── db/
   │   └── index.ts      (Database connection pool)
   ├── models/            (empty - future session)
   ├── routes/            (empty - future session)
   ├── middleware/         (empty - future session)
   ├── services/          (empty - future session)
   └── utils/
       └── errors.ts     (Custom error classes: AppError, NotFoundError, ValidationError)
   ```
6. Implement `src/index.ts`: Express app with cors, helmet, JSON parsing, health check
   endpoint (`GET /health`), and global error handler.
7. Implement `src/config/env.ts`: Zod schema validating PORT, DATABASE_URL, JWT_SECRET,
   NODE_ENV.
8. Implement `src/db/index.ts`: Drizzle PostgreSQL connection using env.DATABASE_URL.
9. Implement `src/utils/errors.ts`: AppError base class with statusCode and isOperational,
   plus NotFoundError and ValidationError subclasses.

## VALIDATION
Run: `npx tsc --noEmit`
Expected: exit code 0

## SCOPE
Create ONLY the files listed above. Do not create models, routes, or services.
```

#### Session N Example: API Routes

```markdown
# Session S04: API Routes & Controllers

## ROLE
You are an expert backend engineer implementing REST API routes.

## PROJECT CONTEXT
This is an Express 5 + TypeScript + Drizzle ORM project.
Auth uses JWT Bearer tokens (implemented in a separate session).

## EXISTING CODE YOU MUST READ
<contents of src/models/*, src/services/*, src/middleware/auth.ts, src/utils/errors.ts>

## WHAT'S BEEN DONE
- S01: Project scaffolded with Express, TypeScript, Drizzle
- S02: Database models created (users, projects, tasks, boards)
- S03: Business logic services (UserService, ProjectService, TaskService, BoardService)

## YOUR TASK
Create the complete REST API layer:

1. `src/routes/index.ts` — Route aggregator mounting all sub-routers
2. `src/routes/auth.routes.ts`:
   - POST /api/auth/register (body: {email, password, name})
   - POST /api/auth/login (body: {email, password})
   - POST /api/auth/refresh (body: {refreshToken})
3. `src/routes/project.routes.ts`:
   - GET /api/projects (query: {page, limit}) — list user's projects
   - POST /api/projects (body: {name, description})
   - GET /api/projects/:id — get project details with boards
   - PUT /api/projects/:id (body: {name?, description?})
   - DELETE /api/projects/:id
4. `src/routes/task.routes.ts`:
   - GET /api/boards/:boardId/tasks (query: {status?, assignee?})
   - POST /api/boards/:boardId/tasks (body: {title, description, assigneeId?})
   - PUT /api/tasks/:id (body: {title?, description?, status?, assigneeId?, position?})
   - DELETE /api/tasks/:id
5. `src/middleware/validate.ts` — Zod validation middleware factory

For each route:
- Use the corresponding Service from src/services/
- Validate request body/params/query with Zod schemas
- Return consistent JSON: { success: true, data: ... } or { success: false, error: ... }
- Use proper HTTP status codes (200, 201, 400, 401, 403, 404, 500)
- Wrap all handlers in try/catch using the AppError hierarchy

## VALIDATION
Run: `npx tsc --noEmit`
Expected: exit code 0

## SCOPE BOUNDARIES
- Do NOT modify any model files.
- Do NOT modify any service files.
- Do NOT implement auth middleware (already exists at src/middleware/auth.ts).
- Do NOT create tests (separate session).
```

---

### 7.4 Standalone Manual Workflow Prompts

If you want to run CASM's workflow manually (without the automation tool), use these prompts in sequence, each in a **fresh terminal**:

#### Manual Step 1: Architecture (Fresh Terminal)

```
I have a project idea: <YOUR_IDEA>

Act as a senior software architect. Create a COMPLETE architectural document covering:
project overview, tech stack, system architecture, full file/folder structure with descriptions,
all data models with TypeScript interfaces, all API endpoints with request/response types,
business logic descriptions, auth strategy, frontend architecture (if applicable), dependency
map, testing strategy, and how to decompose this into 6-12 isolated implementation sessions.

Be exhaustive — every file, every field, every endpoint. No hand-waving.
Save the result to ./architecture.md
```

#### Manual Step 2: Session Plan (Fresh Terminal)

```
Read ./architecture.md

Decompose this architecture into 6-12 implementation sessions. For each session, output:
1. Session ID and name
2. What it implements (specific files and functions)
3. What files it depends on (must read for context)
4. What files it produces
5. Validation command
6. Dependencies on other sessions
7. The COMPLETE prompt I should give Claude Code in a fresh session to implement it

Critical rules:
- Each session starts from ZERO context (fresh terminal)
- Each session prompt must be self-contained with all needed information
- Each session targets < 80K total tokens
- Sessions form a dependency chain — order matters

Save the session plan to ./session-plan.md
```

#### Manual Steps 3-N: Execute Each Session (Fresh Terminal Per Session)

Open a new terminal for each session and paste the corresponding prompt from `session-plan.md`.

**Always kill the terminal between sessions** to ensure a completely fresh context.

---

## 8. Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| Context utilization per session | < 50% of 200K window | Monitor via SDK message tokens |
| Zero auto-compaction events | 0 compactions per session | Log compaction messages |
| Session validation pass rate | > 85% on first attempt | Track validation results |
| Full pipeline completion rate | > 90% unattended | End-to-end test |
| Code quality (type-check pass) | 100% after retries | TypeScript `--noEmit` |
| Time vs manual session cycling | < 50% of manual time | Benchmark comparison |

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| SDK session resume bug (#3976) | Cannot continue failed sessions | CASM uses fresh `query()` per session — no resume needed |
| Prompt exceeds token budget | Reasoning quality degrades | Token estimator pre-validates; split session if over budget |
| Session produces files outside scope | Downstream sessions confused | File-level validation; git diff to detect scope violations |
| Cascading validation failures | Pipeline stuck | Max retry + human escalation + `--from` flag to resume |
| Architecture doc quality | Sessions misaligned | Use Opus for Phase 1 (highest reasoning); human review gate |
| Rapid SDK API changes | Breaking changes | Pin SDK version; abstract behind runner interface |

---

## 10. Future Enhancements

1. **Parallel session execution**: Sessions without mutual dependencies run concurrently.
2. **Git branch per session**: Each session works in an isolated branch, merged on validation.
3. **Interactive approval mode**: Pause after Phase 2 for human review of session plan.
4. **Token usage dashboard**: Real-time visualization of context utilization per session.
5. **Session replay**: Re-run any session with modified prompt without affecting others.
6. **Custom validation plugins**: Support for project-specific validation beyond shell commands.
7. **Multi-model routing**: Use Opus for complex logic sessions, Sonnet for boilerplate sessions, Haiku for validation.
8. **CLAUDE.md auto-generation**: Generate project memory files from handoff summaries.
9. **VS Code extension**: GUI for monitoring and controlling CASM pipelines.
10. **Self-healing sessions**: If a session fails, auto-generate a diagnostic session that analyzes the failure and produces a fix plan.

---

## 11. Appendix: Quick Reference Card

```
┌────────────────────────────────────────────────────────────────┐
│                     CASM QUICK REFERENCE                       │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  INSTALL:   npm install -g casm                                │
│                                                                │
│  FULL RUN:  casm run "your project idea"                       │
│  PLAN ONLY: casm plan "your idea" → architecture.md            │
│  SPLIT:     casm split ./architecture.md → manifest.json       │
│  EXECUTE:   casm execute ./manifest.json                       │
│  RESUME:    casm execute ./manifest.json --from S04            │
│  DRY RUN:   casm execute ./manifest.json --dry-run             │
│                                                                │
│  KEY PRINCIPLE:                                                │
│  Fresh context per session. Never carry conversation history.  │
│  Inject only what's needed. Validate before moving on.         │
│                                                                │
│  TOKEN BUDGET PER SESSION:                                     │
│  Prompt input: < 30K tokens                                    │
│  Total usage:  < 80K tokens (40% of 200K window)               │
│  Compaction:   Should NEVER trigger                            │
│                                                                │
│  TECH STACK:                                                   │
│  Runtime: Node.js 22+ / TypeScript 5.5+                        │
│  SDK:     @anthropic-ai/claude-agent-sdk (latest)              │
│  Model:   Sonnet (execution) / Opus (planning)                 │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```
