# CASM — Claude Code Autonomous Session Manager

## Project Purpose
CLI tool that orchestrates isolated Claude Code sessions to prevent context degradation.

## Key Principles
- Each session = fresh context, never carry conversation history
- Sessions are defined in session-manifest.json (DAG)
- Token budget: < 30K input per session, < 80K total

## Tech Stack
- Node.js 22+, TypeScript 5.5+ (ESM, NodeNext module resolution)
- @anthropic-ai/claude-agent-sdk for session execution
- Commander.js for CLI
- All imports must use .js extensions (ESM NodeNext requirement)

## Critical Rules
- All imports: use .js extension even for .ts files (NodeNext ESM)
- No default exports — named exports only
- Strict TypeScript — no `any`, no type assertions without justification
