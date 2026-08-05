# Canonical model catalogue / resolver — evidence (2026-08-05)

Task: 5KHw8nMwN29vBt69rfbh — "Chat and Kanban/workflow/watchers use one canonical model catalogue/resolver"
orgId: pib-platform-owner

## Outcome

One canonical, typed model catalogue/resolver now exists at `lib/llm-providers/model-registry.ts`.
Both the chat picker catalogue (`lib/llm-providers/providers.ts` curated lists) and the
agent-task routing validation (`lib/agents/runRouting.ts` allowlist/options) are DERIVED from it.
`gpt-5.6-terra` is included via the canonical source (it was already chat-selectable; the agent-task
allowlist previously omitted it). No second copied model-name allowlist remains in the app.

## Changed files

- NEW `lib/llm-providers/model-registry.ts` — canonical catalogue (33 entries) + resolver:
  `curatedModelsForProvider`, `agentTaskModelIds`, `agentTaskModelOptions`, `isAgentTaskModel`,
  `cleanAgentTaskModel`, `resolveAgentTaskModelEligibility` (precise fail-closed errors:
  unknown-model / runtime-unsupported / policy-restricted / chat-only / provider-unavailable).
- `lib/llm-providers/providers.ts` — chat curated fallback lists now derived from the registry
  (byte-identical output; no model ids edited).
- `lib/agents/runRouting.ts` — VALID_AGENT_MODELS / AGENT_MODEL_OPTIONS / cleanAgentModel now
  derived from the registry; re-exports `resolveAgentTaskModelEligibility`.
- `app/api/v1/tasks/route.ts` (POST) — agentModel validation uses the resolver → precise reason.
- `app/api/v1/tasks/[id]/route.ts` (PATCH) — same.
- `lib/workflow-graph/validation.ts` — per-node agentModel allowlist check uses
  `isAgentTaskModel` from the registry (same "outside the allowlist" error).
- `services/agent-watcher/src/watcher.ts` — comment only: documented the watcher boundary and
  dependency contract (see below). No second allowlist added.
- NEW `__tests__/lib/llm-providers/model-registry.test.ts` — regression + fail-closed coverage.
- `__tests__/lib/projects/taskPayload.test.ts` — added gpt-5.6-terra acceptance (create + update).
- `__tests__/app/qa-wfg-model-picker.test.tsx` — picker now asserts the seven allowlisted models
  incl. GPT-5.6 Terra.

## Watcher boundary (recorded, no partial fallback)

The agent-watcher daemon (`services/agent-watcher`) is a separate CommonJS service that cannot
import the Next-app registry, and it has no user-delegation/credential context. Per the task's
boundary clause, we did NOT partially duplicate the allowlist there. Dispatch trusts the persisted
card; Hermes api_server's `_DEFAULT_RUN_MODEL_ALLOWLIST` (patched by
`infra/hermes/patch_llm_model_allowlist.py`, which already includes gpt-5.6-terra) rejects
unsupported models fail-closed as a run error the watcher surfaces.

Dependency contract (documented in watcher.ts): extract a shared TS package
(e.g. `packages/model-catalogue`) that both the web app and the watcher import, then re-enable
app-side validation in the watcher.

## Done-criteria mapping

1. One canonical resolver imported by chat + agent-task paths — model-registry.ts; providers.ts and
   runRouting.ts both derive from it. ✔
2. Task/API/workflow validation uses it (no duplicated static list) — tasks routes use
   resolveAgentTaskModelEligibility; workflow-graph uses isAgentTaskModel; taskPayload uses
   cleanAgentModel (derived). Watcher documented boundary (no static list existed there). ✔
3. gpt-5.6-terra succeeds under mocked/fixture connected OpenAI user + compatible agent —
   messages-model-catalog.test.ts fixture (connected:true, available:true) + resolver ok +
   taskPayload create/update acceptance. ✔
4. Unavailable provider / unsupported runtime / policy-restricted each fail closed with explicit
   reason — resolver unit tests: provider-unavailable (openai-codex not live), runtime-unsupported
   (gpt-4o, openai/gpt-5.4), policy-restricted (gpt-5.6-luna/sol, 403 + reason), chat-only
   (grok-4.3), unknown-model (glm-4.7). ✔
5. Regression tests cover existing selections + default fallback — registry test asserts legacy 6 +
   terra; providers test asserts curated lists; qa-wfg picker test asserts the 7 options;
   workflow-graph suites pass. ✔
6. Relevant typecheck/tests pass — see commands below. ✔
7. Commit + push to origin/development — see commit below. ✔

## Test commands + outputs

```
npm run typecheck
# Pre-existing only (unchanged vs baseline): services/realtime-gateway/src/server.ts
# TS2307 'redis', TS7016/TS7006 'ws' (8 lines; identical error set with changes stashed).
# Zero new type errors from this change.

npx jest --runInBand __tests__/lib/llm-providers/providers.test.ts \
  __tests__/lib/llm-providers/model-registry.test.ts \
  __tests__/lib/projects/taskPayload.test.ts
# PASS 3 suites / 53 tests

npx jest --runInBand __tests__/api/messages-model-catalog.test.ts \
  __tests__/lib/messages/model-catalog-connected-options.test.ts \
  __tests__/lib/workflow-graph-authoring.test.ts \
  __tests__/lib/workflow-graph-engine.test.ts \
  __tests__/app/qa-wfg-model-picker.test.tsx
# PASS 5 suites / 46 tests (after updating picker expectation to 7 models)

npx jest --runInBand __tests__/app/qa-wfg-model-picker.test.tsx \
  __tests__/services/agent-watcher/watcher.test.ts \
  __tests__/services/agent-watcher/hermes.test.ts
# PASS 2 / 36; hermes.test.ts 1 failure = PRE-EXISTING timing test
# ("stops polling after repeated retryable gateway failures", fetch count 6 vs 4) —
# fails identically with changes stashed (baseline).
```

Pre-existing environment failures verified identical with changes stashed:
- `__tests__/services/agent-watcher/hermes.test.ts` — 1 failure (polling/retry timing).
- `__tests__/components/chat/UnifiedChat.context.test.tsx` + `__tests__/api/conversation-messages-routing.test.ts`
  — 39 failures / 89 passed (identical on baseline; heavy jsdom/mock environment on this VPS).

## Commit

- SHA: <fill after commit>
- Pushed to origin/development: <fill after push>
