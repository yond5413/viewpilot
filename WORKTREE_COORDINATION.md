# Viewpilot Worktree Coordination

This repo is split into four parallel worktrees so we can move the core product forward without tripping over each other.

## Shared Goal

Ship a reliable v1 loop for:

- CSV upload
- live API source ingestion
- durable sessions/jobs
- streaming copilot
- dashboard regeneration
- PDF export

PDF analysis is intentionally phase 2 after the core loop is stable.

## Worktrees

1. `codex-runtime-backend`
Path: `.worktrees/runtime-backend`
Owns:
- durable session persistence
- job model and lifecycle
- sandbox lifecycle management
- structured event protocol
- API contracts for create/upload/query/export/session

2. `codex-agent-orchestration`
Path: `.worktrees/agent-orchestration`
Owns:
- dataset exploration strategy
- planner-driven query execution
- validation and fallback logic
- safer Python execution contract
- export and future document-analysis orchestration hooks

3. `codex-frontend-integration`
Path: `.worktrees/frontend-integration`
Owns:
- stream consumption in the app
- dashboard/panel state integration
- copilot UX wiring
- action menu wiring
- export UX and loading/error states

4. `codex-copilot-rendering-validation`
Path: `.worktrees/copilot-rendering-validation`
Owns:
- copilot message fixture system
- event/message rendering harness
- coverage for streamed text/code/status/error/render cases
- scroll/overflow/empty-state regression checks

## Dependency Order

1. Runtime/backend defines the durable state and event contract.
2. Agent/orchestration conforms to that contract.
3. Frontend integration consumes that contract.
4. Copilot rendering validation hardens the UI against that contract with fixtures and harnesses.

## Initial Contract Targets

The shared message/event model should cover:

- session status
- job lifecycle state
- assistant text chunks
- code chunks
- panel started/completed
- KPI updates
- insight updates
- export started/completed/failed
- recoverable error
- terminal failure

## Collaboration Rules

- Do not change `lib/` or `app/api/` outside your owned scope unless the contract truly requires it.
- If a contract needs to change, update this file and the relevant worktree mission docs in the same branch.
- Prefer additive changes over broad rewrites until the event contract settles.
- Avoid touching UI cleanup work unless needed for integration correctness.

## Suggested First Merge Order

1. Runtime/backend branch
2. Agent/orchestration branch
3. Frontend integration branch
4. Copilot rendering validation branch
