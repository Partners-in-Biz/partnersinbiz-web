# Workflow Graph Engine Phase 1 (Path A)

Status: implemented on `development` (2026-08-02)
Project: `8f4vajS3vyOIBUoMrIs1`
ADR: `docs/superpowers/specs/2026-08-02-workflow-graph-engine-v0-adr.md`

## What shipped

- Pure engine under `lib/workflow-graph/`
  - GraphTemplate + WorkflowRun + node attempts + idempotency keys
  - Materialize **only** `agent` + `human_gate` to Kanban
  - Ledger-only `code_check` / `system` / `wait_event` / `delay`
  - Fail-closed gates (`publish|spend|deploy|finance|client_message|secrets`)
  - Budget pause + per-run/org/agent concurrency queue (not fail)
  - False-done rejection (missing expectedArtifacts)
  - Inspect payload: wave, blocker, cost, gate map, last evidence
- Pilot template `pilot-research-validate-doc-approve-fanout`
- Playbook promotion path: `executionBackend: 'workflow_graph'` on playbook → WorkflowRun only (no dual playbookRuns ledger)
- APIs:
  - `GET/POST /api/v1/graph-templates`
  - `GET/PATCH /api/v1/graph-templates/[id]`
  - `GET/POST /api/v1/workflow-runs`
  - `GET/POST /api/v1/workflow-runs/[id]` (inspect + advance)
  - `POST /api/v1/workflow-runs/[id]/cancel`
- Kanban write-back from project task PATCH when `workflowRunId` present
- Tests: `__tests__/lib/workflow-graph-engine.test.ts` (golden + fail-closed)

## Hard bans respected

- No second board UI
- No production promote
- No client-visible surfaces
- No ungated publish/spend/deploy

## Next

- Phase 2: inspector ops surface, stuck SLAs, triggers (cron + domain events), quiet success / alert-on-block facts
- Quinn QA task `geRItmjryHSodDZGhNaq`
