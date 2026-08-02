# Workflow Graph Phase 2 — Ops surface (2026-08-02)

## Delivered

- Expanded one-call inspector via `buildOpsInspect` / `GET /api/v1/workflow-runs/{id}`
- Stuck SLAs (`evaluateStuck` / cron pass)
- Quiet success + alert-on-block dedupe facts (`workflow_ops_facts`)
- Nora list: `GET /api/v1/workflow-runs?orgId=&status=stuck|blocked|paused_budget`
- Triggers: manual POST, Hermes cron `GET /api/cron/workflow-graph`, domain events `POST /api/v1/workflow-runs/triggers/domain-event`
- Supported domain events: `task.completed`, `document.approved`, `deal.stage_changed`, `social.post_failed`
- Budget + concurrency still enforced in Phase 1 engine (unchanged fail-closed)

## Paths

```
lib/workflow-graph/ops.ts
lib/workflow-graph/ops-timeline.ts
lib/workflow-graph/triggers.ts
lib/workflow-graph/service.ts   # finalizeOpsSideEffects
lib/workflow-graph/store.ts     # listWorkflowRuns, saveOpsFact
app/api/v1/workflow-runs/route.ts
app/api/v1/workflow-runs/[id]/route.ts
app/api/v1/workflow-runs/triggers/domain-event/route.ts
app/api/cron/workflow-graph/route.ts
__tests__/lib/workflow-graph-ops.test.ts
```

## Bans respected

- No second board
- No production promote
- No ungated publish/spend/deploy/finance/client_message/secrets
- No permanent CEO dashboard; inspect is API + Messages answer

## Tests

```
npx jest --runInBand __tests__/lib/workflow-graph-ops.test.ts __tests__/lib/workflow-graph-engine.test.ts
```
