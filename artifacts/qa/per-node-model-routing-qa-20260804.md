# QA Evidence — Per-node model routing (et8uGQ67oyo3HEkuFLA2)

Verified: 2026-08-04 (Quinn / qa-release)
Commit under test: 52c04308c5097276e6e1ed687da0bb923c414f76 (origin/development)
Repo: partnersinbiz-web (linked Peets-Mac-mini.local checkout)

## 1. Engine unit suites — PASS
Command: npx jest --runInBand workflow-graph
Result: 6 suites passed, 64 tests passed (0 failed)
- workflow-graph-engine.test.ts — PASS (per-node agentModel flows into materialize intent + Kanban task create data; golden path)
- workflow-graph-authoring.test.ts — PASS (round-trip preserves agentModel; normalize preserves + validate rejects non-allowlisted)
- workflow-graph-ops.test.ts / ops-cron / status-all / writeback — PASS

## 2. UI render check — PASS (model picker renders)
Command: npx jest --runInBand __tests__/app/qa-wfg-model-picker.test.tsx
Result: jsdom 2/2 passed
- Renders agentModel <select> after adding an agent node
- Options = Platform default + 6 allowlisted models:
  grok-4.5, claude-sonnet-4-6, gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.3-codex-spark
- Selecting a model persists into node draft

## 3. prod-engineering-change-promote template JSON — GAP (not yet reworked)
GET /api/v1/graph-templates/PoH0NQdlrOZvq9GZMN07
- version 2, updatedAt 2026-08-04T07:07:39.977Z, nodes:
  implement (agent, theo) agentModel=None
  check_impl (code_check) agentModel=None
  review (agent, qa-release) agentModel=None
  promote_gate (human_gate) agentModel=None
- Per-node agentModel values are NOT yet present; template rework is part of
  Theo task onKE77uiJ6JptfmGhJjz (in-progress).

## 4. Invalid model rejected fail-closed — PASS (code+unit) / NOT LIVE yet
- validation.ts: validateGraphTemplate rejects agentModel outside VALID_AGENT_MODELS
  ("Agent node X has agentModel Y outside the allowlist"); createOrUpdateGraphTemplate returns 400.
- authoring.test.ts 'normalize preserves agentModel and validate rejects non-allowlisted models' asserts ok=false + error contains 'outside the allowlist'.
- taskPayload.cleanRunModel also fails closed at materialize time (400 Invalid agentModel).
- Live probe POST with agentModel:'not-a-real-model' on production API returned success and SILENTLY DROPPED the model (template persisted with no agentModel) — production is still on the pre-pack behavior until promote task 7pVPCzmqvjkstMGMzZ21 lands. Probe template archived (pjhdavXpvkfqybUDPPSE).

## Total
66/66 tests green (64 engine/ops/authoring/writeback + 2 UI render) at commit 52c04308c on origin/development.
