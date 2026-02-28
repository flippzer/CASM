# CASM — Claude Code Autonomous Session Manager

CASM is a CLI tool that orchestrates isolated [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions to prevent **context degradation** in large projects.

When Claude Code runs long tasks in a single session, the 200K token context window fills up, triggering auto-compaction — a lossy summarization that causes Claude to lose critical details and produce progressively worse output. CASM solves this by decomposing work into independent, context-optimized sessions that each start fresh with only the files and information they need.

## How It Works

CASM runs a three-phase pipeline:

1. **Ideation** — Takes your project idea and generates a comprehensive architectural PRD
2. **Planning** — Decomposes the PRD into a DAG of isolated sessions with dependencies, context requirements, and validation criteria
3. **Execution** — Walks the session DAG in topological order, running each session with a clean context via the Claude Agent SDK

Each session targets < 30K input tokens and < 80K total tokens, keeping well under the compaction threshold. After each session completes, a structured handoff file is generated so downstream sessions know exactly what was built.

## Prerequisites

- Node.js 22+
- An [Anthropic API key](https://console.anthropic.com/)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Installation

```bash
npm install -g casm
```

Or clone and build from source:

```bash
git clone https://github.com/flippzer/CASM.git
cd CASM
npm install
npm run build
```

## Usage

### Full pipeline

Generate architecture, plan sessions, and execute — all from a single idea:

```bash
casm run "Build a SaaS project management app with Kanban boards"
```

### Plan only (no execution)

Generate the architectural PRD and session manifest without running any sessions:

```bash
casm plan "Build a REST API for a recipe sharing platform"
```

### Split an existing architecture into sessions

If you already have an `architecture.md`, generate the session manifest from it:

```bash
casm split ./architecture.md
```

### Execute an existing manifest

Run sessions from a previously generated manifest:

```bash
casm execute ./manifest.json
```

Resume from a specific session (e.g., after fixing a failure):

```bash
casm execute ./manifest.json --from S04
```

Preview what would run without executing:

```bash
casm execute ./manifest.json --dry-run
```

### Check execution status

```bash
casm status
```

Output:

```
CASM Status — Project: my-project
──────────────────────────────────────────────────────
  S01  completed  (23s, 12.4K tokens)
  S02  completed  (18s, 9.1K tokens)
  S03  running
  S04  pending
──────────────────────────────────────────────────────
```

## CLI Reference

| Command | Description |
|---|---|
| `casm run <idea>` | Full pipeline: Idea -> PRD -> Manifest -> Execution |
| `casm plan <idea>` | Phase 1+2: generates PRD + manifest, no execution |
| `casm split <file>` | Phase 2: architecture file -> session manifest |
| `casm execute <file>` | Phase 3: execute sessions from an existing manifest |
| `casm status` | Show current execution state |

### Common Options

| Option | Description |
|---|---|
| `-d, --dir <path>` | Target project directory (default: current directory) |
| `-v, --verbose` | Verbose output |
| `--dry-run` | Show planned sessions without executing |
| `--from <session-id>` | Resume execution from a specific session |
| `-o, --output <path>` | Output path for generated files |

## Configuration

Create a `.casmrc.json` in your project root to customize behavior:

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

All fields are optional — defaults are shown above.

## Project Structure

```
.casm/                    # Generated at runtime
├── manifest.json         # Session manifest (DAG)
├── state.json            # Execution state
├── architecture.md       # Phase 1 output
├── handoffs/             # Per-session handoff summaries
│   ├── S01-scaffolding.md
│   └── ...
└── logs/                 # Session logs
    └── ...
```

## How Sessions Stay Fresh

The key insight behind CASM is that each session runs with **zero conversation history**. Instead of one long context that degrades over time, each session gets a precisely constructed prompt containing:

| Component | Budget | Purpose |
|---|---|---|
| Architecture summary | < 5K tokens | Condensed project overview |
| Injected file contents | < 20K tokens | Only files this session directly needs |
| Handoff summaries | < 3K tokens | What previous sessions built |
| Task prompt | < 2K tokens | Specific instructions for this session |
| **Total** | **< 30K tokens** | Leaves 170K+ for reasoning and output |

This means auto-compaction **never triggers**, and every session operates at peak quality.

## License

ISC
