# Workflow Graph Phase 3 — Authoring UX + harden (2026-08-02)

## Decision

Path A Phase 3 lands structured **GraphTemplate** authoring on Project **Suite / Plan** — not a second board. Nora budgets, limits, notify, and SLA are first-class editor fields. Engine acceptance bar remains: pilot golden + failure paths 100%, false-done = 0, stuck diagnosis in one inspect call, only `agent` + `human_gate` materialize to Kanban.

## Delivered

| Area | Path |
|---|---|
| Authoring pure helpers | `lib/workflow-graph/authoring.ts` |
| Normalize node budgets/retry | `lib/workflow-graph/validation.ts` |
| Barrel export | `lib/workflow-graph/index.ts` |
| Suite editor UI | `components/projects/WorkflowGraphAuthoringPanel.tsx` |
| Suite embed + orgId | `components/projects/ProjectSuitePanel.tsx`, `ProjectDetailWorkspace.tsx` |
| Harden + authoring tests | `__tests__/lib/workflow-graph-authoring.test.ts` (9) |

## Product law (unchanged)

1. One task bus: Projects/Kanban.
2. Only agent + human_gate materialize.
3. code_check / system / wait_event / delay stay ledger-only.
4. Done = proven artifacts + gates (no narrative false-done).
5. No second Graphs board UI.
6. No production promote without separate Quinn + Peet approval.

## Suite UX

- Plan tab → **Workflow Graph templates** panel.
- List templates for org (project-scoped + pilot).
- Structured node editor (kind, deps, assignee, spec, artifacts, capability, check/system fields).
- **Nora ops controls**: max concurrent agents, max tokens/cost, warn ratio, onExceed, currency, quiet success, alert-on-block, CEO notify csv, heartbeat / human-gate / run-no-transition SLAs (hours).
- Live materialization preview (kanban vs ledger-only ids).
- Client validation via `buildTemplateFromDraft` before save.
- Actions: Save, Save & activate, Ensure pilot, Start run on Kanban (POST workflow-runs).
- Start run shows one-line inspect summary; full inspect remains GET `/api/v1/workflow-runs?id=`.

## Harden acceptance (unit)

```bash
npx jest --runInBand \
  __tests__/lib/workflow-graph-authoring.test.ts \
  __tests__/lib/workflow-graph-engine.test.ts \
  __tests__/lib/workflow-graph-ops.test.ts \
  __tests__/lib/workflow-graph-ops-cron.test.ts
```

Phase 3 suite covers:

- Nora defaults + round-trip hash stability
- Materialization preview law
- API-ready serialize + validate
- Node-level budgets preserved in normalize
- Pilot golden path quiet succeed
- False-done = 0
- Failure paths: budget pause, gated system, concurrency queue, attempt idempotency keys
- Stuck diagnosis via one `buildOpsInspect` call

## Bans respected

- No second board
- No production deploy from this task
- No ungated publish/spend/deploy/finance/client_message/secrets
- No permanent CEO dashboard

## Next

- Quinn Phase 3 QA on development
- Production only after separate Quinn + Peet approve
