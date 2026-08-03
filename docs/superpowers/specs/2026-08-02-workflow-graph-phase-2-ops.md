# Workflow Graph Phase 2 — Ops surface (2026-08-02)

## Delivered

- Expanded one-call inspector via `buildOpsInspect` / `GET /api/v1/workflow-runs/{id}`
- Stuck SLAs (`evaluateStuck` / cron pass)
- Quiet success + alert-on-block dedupe facts (`workflow_ops_facts`)
- Nora list: `GET /api/v1/workflow-runs?orgId=&status=stuck|blocked|paused_budget`
- Triggers: manual POST, Hermes/Vercel cron `GET /api/cron/workflow-graph`, domain events `POST /api/v1/workflow-runs/triggers/domain-event`
- Supported domain events: `task.completed`, `document.approved`, `deal.stage_changed`, `social.post_failed`
- Budget + concurrency still enforced in Phase 1 engine (unchanged fail-closed)

## Paths

```
lib/workflow-graph/ops.ts
lib/workflow-graph/ops-timeline.ts
lib/workflow-graph/triggers.ts
lib/workflow-graph/service.ts   # finalizeOpsSideEffects (export; advance + cron)
lib/workflow-graph/store.ts     # listWorkflowRuns, saveOpsFact, saveWorkflowRun
lib/workflow-graph/index.ts     # barrel re-exports saveWorkflowRun + finalizeOpsSideEffects
app/api/v1/workflow-runs/route.ts
app/api/v1/workflow-runs/[id]/route.ts
app/api/v1/workflow-runs/triggers/domain-event/route.ts
app/api/cron/workflow-graph/route.ts
vercel.json                     # crons[] → /api/cron/workflow-graph?orgId=pib-platform-owner every 5m
__tests__/lib/workflow-graph-ops.test.ts
```

## Scheduler proof

- **Vercel cron (primary):** `vercel.json` entry  
  `path: /api/cron/workflow-graph?orgId=pib-platform-owner`  
  `schedule: */5 * * * *`  
  Auth: `x-vercel-cron` header (platform) or `Authorization: Bearer $CRON_SECRET`.
- **Hermes/manual caller (secondary):** same route with `Bearer CRON_SECRET` + `orgId` query.  
  Example: `GET https://<host>/api/cron/workflow-graph?orgId=pib-platform-owner`
- Cron stuck path calls `finalizeOpsSideEffects(previous, run, now)` so SLA breach writes  
  one `workflow_ops_facts` row (`runId:block:revision`) and updates `blockRevision` / `lastAlertDedupeKey`.
- **ADR §19 residual fix (2026-08-03):** alert identity is a stable `lastAlertSignature`
  (`block:<code>` / `stuck:<code>` / `budget:…`). Same signature ⇒ at most one fact per
  `blockRevision` (overwrite OK). Never `kind=block` + `reasonCode=running`. Stuck-only
  alerts use `kind=stuck`. `saveWorkflowRun` deletes cleared stuck/blocked fields under
  merge. `GET /api/v1/workflow-runs/{id}` returns `facts[]` via `listOpsFactsForRun`.

## Bans respected

- No second board
- No production promote
- No ungated publish/spend/deploy/finance/client_message/secrets
- No permanent CEO dashboard; inspect is API + Messages answer

## Tests

```
npx jest --runInBand __tests__/lib/workflow-graph-ops.test.ts __tests__/lib/workflow-graph-engine.test.ts
```
