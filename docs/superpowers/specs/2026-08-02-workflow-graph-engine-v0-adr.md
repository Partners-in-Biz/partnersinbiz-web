# ADR: Workflow Graph Engine v0 (Path A)

Status: Accepted (development)
Date: 2026-08-02
Project: Workflow Graph Engine (Kanban-backed sequencer) `8f4vajS3vyOIBUoMrIs1`
Org: `pib-platform-owner`
Build spec: `Bh4uxbyFohjoSp96SMUO`
Approval gate: `F93UT3OHdlVpgEfAKNfL` (development only)
Nora ops input: project doc `uvlgc7QqYN6yxgPEbEzT` / wiki `workflow-graph-ops-cost-controls-2026-08-02.md`
Phase 0 task: `oyaBlfr2gpjpo2FK4ELE`
Authors: Pip (unblock + lock ADR after Theo runtime thrash); product decisions Peet/Pip/Nora/Theo council

## 1. Context

PiB already has weak graph primitives:

- Project tasks: `assigneeAgentId`, `agentStatus`, `dependsOn`, approval gates, `expectedArtifacts`, watcher claim/dispatch
- Suite playbooks: `ProjectPlaybookTemplateV1` steps with `dependsOnStepIds`, `taskKind` agent|approval-gate|human, `playbookRuns` materialization
- Cron: Hermes schedules + `app/api/cron/project-playbooks`
- Domain events: task.completed, doc approved, deal stage, failed social, etc.

Missing: a first-class **run ledger** that owns sequence, waves, retries, proof, budgets, stuck diagnosis, and idempotent node attempts — without cloning Projects/Kanban into a second board product.

Source thesis (Granite): the graph decides who runs and when; the loop decides whether you can trust what comes back.

## 2. Decision (Path A)

Build Workflow Graph as a **function on Projects/Kanban**, not a second board.

| Record | Role |
|---|---|
| `GraphTemplate` | Reusable DAG: nodes, edges, triggers, roles, capabilities, risk, budgets, limits, notify, SLA |
| `WorkflowRun` | One instance: status, wave pointer, node attempts, evidence refs, parent/child, live cost counters |

### Product law (non-negotiable)

1. One task bus forever: Projects/Kanban.
2. Only `agent` and `human_gate` nodes materialize to Kanban tasks.
3. `code_check`, `system`, `wait_event`/`delay` live only on the run ledger.
4. Done means **proven** (expectedArtifacts + gates + optional code_check), never agent narrative alone.
5. Fail closed on gated capabilities: publish, spend, deploy, finance, client_message, secrets.
6. `dueDate` alone never releases agent work.
7. CRM ContactFact knowledge graph is a different product surface — do not merge with execution graphs.
8. Full end-state = Phases 0–3 + Quinn pilot QA on development. Production is a separate Peet + Quinn promote.

## 3. Node kinds and contracts

| Kind | Runs as | Kanban? | Enter running | Done means | Fail/block |
|---|---|---|---|---|---|
| `agent` | Hermes watcher loop via existing claim | Yes — project task | deps proven + capacity + budget + planning ready + gate if required | `expectedArtifacts` present + optional reviewer + not blocked | missing artifacts, retry exhausted, capability denied |
| `human_gate` | approval task and/or Messages `approval_card` | Yes — gate task | deps proven | explicit human approve with scoped `approvalRef` | reject / timeout policy |
| `code_check` | pure verifier (tests, schema, artifact presence, API read-back) | No | deps proven | check green + log artifact | verifier fail after attempts |
| `system` | domain module side-effect (idempotent) | No | deps proven + gate if capability gated | success + read-back | non-idempotent failure / policy |
| `wait_event` / `delay` | timer or domain event bus | No | scheduled | event matched or delay elapsed | deadline miss |

### State machine (node attempt)

`pending → ready → queued_capacity? → claimed → running → {done | blocked | awaiting_gate | waiting_event | retry_wait} → (new attempt | terminal)`

Run statuses:

`created | running | paused_budget | paused_approval | paused_capacity | succeeded | failed | cancelled | abandoned_candidate`

Blocked reason codes (stable strings):  
`concurrency_cap:{agent|org|run}`, `budget_exceeded`, `unknown_usage`, `missing_artifact:<type>`, `waiting_human_gate:<capability>`, `capability_denied`, `verifier_fail`, `transient_infra_exhausted`, `invalid_spec`, `event_deadline`, `planning_not_ready` (if run scoped to project still under planning — prefer fail create).

## 4. Materialization law

When an `agent` or `human_gate` node becomes ready:

1. Create or reuse **one** project-nested Kanban task (idempotent on `(workflowRunId, nodeId)`).
2. Stamp task fields:
   - `assigneeAgentId` / human assignee
   - `agentInput` from template node
   - `dependsOn` = Kanban task ids of upstream **materialized** nodes only (not ledger-only nodes)
   - `expectedArtifacts`, `reviewerAgentId`, `requiredCapability`, `riskLevel`
   - `labels` include `workflow-run:<runId>`, `workflow-node:<nodeId>`, `workflow-template:<templateId>`
   - `agentInput.context.workflowRunId`, `workflowNodeId`, `workflowAttempt`
3. Ledger stores `kanbanTaskId` on the node attempt.
4. Watcher remains the only Hermes claim path for agent work (`MAX_CONCURRENT_PER_AGENT=5` today). Graph engine **must not** bypass `claimTask`.
5. On task `agentStatus=done` with proof: mark node attempt done and advance wave.
6. On task blocked: mirror `blockedReasonCode` onto run node; apply alert-on-block policy.

Ledger-only nodes never create board cards.

## 5. Collections / schema (Firestore proposal)

Prefer top-level org-scoped collections for cross-project runs; optional `projectId` link.

### `graph_templates/{templateId}`

```ts
{
  orgId: string
  name: string
  version: number                 // monotonic; runs pin version
  versionHash: string             // content hash of nodes+edges+limits+budgets
  status: 'draft' | 'active' | 'archived'
  nodes: Array<{
    nodeId: string
    kind: 'agent' | 'human_gate' | 'code_check' | 'system' | 'wait_event' | 'delay'
    name: string
    dependsOnNodeIds: string[]
    // agent / human_gate
    assigneeAgentId?: string
    agentInput?: { spec: string; context?: Record<string, unknown>; constraints?: string[] }
    expectedArtifacts?: string[]
    verifierChecklist?: string[]
    reviewerAgentId?: string
    requiredCapability?: string
    riskLevel?: 'low' | 'medium' | 'high'
    // system / code_check
    systemAction?: string           // namespaced e.g. system:publish_social
    checkType?: string
    checkConfig?: Record<string, unknown>
    // wait
    waitEventType?: string
    delayMs?: number
    deadlineMs?: number
    // overrides (may only tighten)
    limits?: { maxConcurrent?: number }
    retryPolicy?: RetryPolicy
    budgets?: { maxTokens?: number; maxCost?: number }
  }>
  edges?: Array<{ from: string; to: string }> // optional if dependsOnNodeIds complete
  triggers: Array<{
    type: 'manual' | 'cron' | 'domain_event'
    cron?: string
    eventType?: string              // task.completed | document.approved | deal.stage_changed | social.post_failed | ...
    filter?: Record<string, unknown>
  }>
  limits: {
    maxConcurrentAgentNodes: number           // per-run default 3 (1–8)
    maxConcurrentAgentNodesOrgDefault?: number // informational; org policy wins
  }
  budgets: {
    currency: 'USD' | 'ZAR'
    maxTokensPerRun?: number                  // default e.g. 2_000_000
    maxCostPerRun?: number
    maxTokensPerNode?: number
    maxCostPerNode?: number
    maxAgentNodeAttemptsPerRun?: number       // default 40
    warnAtRatio?: number                      // default 0.8
    onExceed: 'pause_run' | 'block_new_agent_nodes' | 'fail_run'  // default pause_run
    estimatedCostModel?: 'tokens_only' | 'tokens_plus_fixed'
  }
  retryPolicy: RetryPolicy                    // defaults; see §7
  notify: {
    quietSuccess: true                        // default true
    alertOnBlock: true
    ceoNotifyOn?: Array<'block' | 'budget' | 'human_gate_sla'>
  }
  sla: {
    agentRunningHeartbeatMs?: number          // default 20m align watcher
    agentReadyUnclaimedMs?: number            // default 15m
    humanGateWarnMs?: number                  // default 24h
    humanGateEscalateMs?: number              // default 72h
    runNoTransitionMs?: number                // default 30m
  }
  gatedCapabilities: string[]                 // publish|spend|deploy|finance|client_message|secrets
  pilot?: boolean
  projectId?: string                          // optional default project for materialization
  createdAt: string
  updatedAt: string
  createdBy: string
}
```

### `workflow_runs/{runId}`

```ts
{
  orgId: string
  templateId: string
  templateVersion: number
  templateVersionHash: string
  projectId?: string
  parentRunId?: string
  childRunIds?: string[]
  status: RunStatus
  trigger: { type: string; ref?: string; at: string }
  wavePointer?: number
  // copy-on-start ceilings (may only tighten via org policy)
  limits: { ... }
  budgets: { ... }                            // ceilings
  cost: {
    maxTokensPerRun: number
    maxCostPerRun?: number
    warnAtRatio: number
    onExceed: string
    tokensIn: number
    tokensOut: number
    tokensReasoning?: number
    tokensTotal: number
    estimatedCost: number
    currency: string
    attemptCountAgent: number
    attemptCountTotal: number
    budgetStatus: 'within_budget' | 'warn' | 'exceeded' | 'unknown_usage'
    lastBudgetEventAt?: string
    usageCompleteness: 'exact' | 'partial' | 'unavailable'
  }
  blockedReasonCode?: string
  stuckAt?: string
  stuckReasonCode?: string
  approvalRefs?: Array<{ capability: string; resourceIds: string[]; approvedBy: string; at: string; ref: string }>
  notify: { ... }
  sla: { ... }
  terminalReason?: string
  startedAt?: string
  updatedAt: string
  completedAt?: string
}
```

### `workflow_runs/{runId}/nodes/{nodeId}`

```ts
{
  nodeId: string
  kind: string
  status: string
  currentAttempt: number
  kanbanTaskId?: string
  blockedReasonCode?: string
  lastTransitionAt: string
  evidence: Array<{ type: string; ref: string; label?: string; at: string }>
  expectedArtifacts: string[]
  approvalRef?: string
}
```

### `workflow_runs/{runId}/nodes/{nodeId}/attempts/{attemptNumber}`

```ts
{
  attemptNumber: number
  idempotencyKey: string                      // `${runId}:${nodeId}:${attemptNumber}`
  status: string
  hermesRunId?: string
  kanbanTaskId?: string
  errorFamily?: 'transient_infra' | 'verifier_fail' | 'agent_incomplete' | 'policy' | 'approval_denied' | 'budget' | 'capability' | 'invalid_spec' | 'unknown'
  retryable?: boolean
  retryAt?: string
  tokensIn?: number
  tokensOut?: number
  tokensTotal?: number
  estimatedCost?: number
  model?: string
  provider?: string
  durationMs?: number
  startedAt?: string
  completedAt?: string
  summary?: string
}
```

### Org policy overlay

`orgs/{orgId}/workflowGraphPolicy` (or existing org settings doc):

- stricter `limits` / `budgets` than template
- looser requires explicit admin override + audit field

### Indexes (minimum)

- `workflow_runs`: `(orgId, status, updatedAt desc)`
- `workflow_runs`: `(orgId, templateId, startedAt desc)`
- `workflow_runs`: `(orgId, projectId, status)`
- `workflow_runs`: `(orgId, stuckReasonCode, stuckAt)` where stuck
- `graph_templates`: `(orgId, status, updatedAt desc)`
- Kanban tasks already queried by watcher; label/prefix filters optional

### Idempotency

- Run create: client `Idempotency-Key` or hash `(templateId, trigger.ref, orgId, windowBucket?)`
- Node dispatch: `idempotencyKey = runId:nodeId:attemptNumber` — duplicate dispatch no-ops
- System actions: domain-level idempotency keys required before execute
- Event triggers: dedupe on `(eventId|eventHash, templateId)`

## 6. Concurrency (Nora — mandatory)

Tightest wins; all enforced:

| Layer | Default | Behaviour at cap |
|---|---|---|
| Global per `assigneeAgentId` | **5** (existing watcher) | do not claim; stay ready |
| Org graph-originated agent claims | **8** (1–20) | `queued_capacity` + `concurrency_cap:org` |
| Per-run agent nodes | **3** (template 1–8) | `queued_capacity` + `concurrency_cap:run` |
| Non-agent cheap nodes | ~20/org | separate pool so verifiers not starved |

In-flight = attempts in `{claimed, running, waiting_watcher}`. Do not count open human_gates or terminals.

## 7. Retry taxonomy (Nora — mandatory)

| Class | Max | Backoff | Terminal |
|---|---|---|---|
| Transient infra (5xx, network, credential sync) | 3 | 1m → 5m → 15m (watcher-compatible) | node blocked; other branches may continue |
| Verifier fail retryable | 2 | 30s → 2m | block with proof |
| Agent incomplete / missing artifacts | 2 incl first | no immediate storm retry | block; needs reviewer/requeue |
| Idempotent system | 5 | exp 5s…5m | block + alert |
| Non-retryable (policy, approval denied, budget, capability, invalid_spec) | 1 | none | fail/block immediately |
| Human gate | n/a auto | n/a | open until approve/reject/timeout |

Rules:

- No retry without `errorFamily` classification; unknown → non-retry after 1 + ops alert.
- No auto-retry across unsatisfied gate.
- Jitter ±20%.
- Run-level `maxAgentNodeAttemptsPerRun` default 40.
- Human/ops requeue creates new attempt reason `human_requeue`, counts toward caps.

## 8. Budgets and quiet success / alert-on-block

- Tokens always counted; `estimatedCost` from config rates (not live billing; not invoices).
- Before agent claim: if `budgetStatus=exceeded` or would exceed → `onExceed` (default `pause_run`).
- After attempt: increment; warn at `warnAtRatio`.
- `unknown_usage` for >2 consecutive agent attempts → pause new agent nodes.
- **Quiet success** default: ledger + Kanban done; no CEO ping.
- **Alert-on-block**: blocked / paused_budget / failed / human_gate SLA / stuck SLA / unknown_usage — **one deduped** ops alert + visible Kanban blocker; optional CEO only if template opts in.

## 9. Gated capabilities (fail closed)

`publish | spend | deploy | finance | client_message | secrets`

- Node cannot enter `running` without matching scoped `approvalRef`.
- Gate materializes as Kanban `human_gate` and/or Messages `approval_card`.
- Blanket “approve run” does **not** authorize deploy/spend unless scope lists capability + resource ids.
- Drafts allowed without gate; execute/send/publish is a separate gated step.
- Pattern: `agent:draft → code_check:artifacts → human_gate:capability → system:execute_idempotent → code_check:readback`

## 10. Playbook → WorkflowRun promotion (no dual-write drift)

Today: `lib/projects/playbooks.ts` writes `playbookRuns` and materializes steps to Kanban.

v0 strategy:

1. **Phase 1 dual-read, single-write path for new runs:** new “Run as graph” / graph-backed playbook execution creates `WorkflowRun` as source of truth; materializes agent/approval-gate the same way playbooks do today.
2. Map step kinds: `agent` → `agent`; `approval-gate` → `human_gate`; `human` → `human_gate` (or agent-less human task).
3. Map `dependsOnStepIds` → `dependsOnNodeIds`; preserve `expectedArtifacts`, `reviewerAgentId`, `requiredCapability`.
4. Existing in-flight `playbookRuns` complete on old path; no forced migration mid-run.
5. **Single source of run truth:** once a run is a WorkflowRun, do not also advance a parallel playbookRuns ledger for the same execution. Optional `sourcePlaybookId` / `sourcePlaybookRunId` pointer for audit only.
6. Cron playbooks can gain `executionBackend: 'playbook' | 'workflow_graph'` (default playbook until pilot green).

## 11. Triggers

| Trigger | Adapter |
|---|---|
| manual | `POST /api/v1/workflow-runs` with templateId + projectId |
| cron | Hermes cron or existing project-playbooks cron calling graph start with idempotency |
| domain_event | webhook/bus: `task.completed`, `document.approved`, `deal.stage_changed`, `social.post_failed` (minimum 3 in Phase 2) |

Do not invent a second cron product UI if Hermes + run records suffice.

## 12. APIs (Phase 1 minimum)

- `POST /api/v1/graph-templates` / `GET` / `PATCH` (draft→active)
- `POST /api/v1/workflow-runs` { templateId, projectId?, trigger, idempotencyKey }
- `GET /api/v1/workflow-runs/{id}` full inspect payload (Phase 2 expands; Phase 1 returns ledger)
- `POST /api/v1/workflow-runs/{id}/cancel` (gated if side effects started)
- Internal: engine tick / advance on task.completed and attempt terminal events
- Watcher integration: treat graph-originated tasks like normal agent tasks; write telemetry back to attempt

Inspector (Phase 2) one-call fields per Nora §6: identity, state, cost strip, node table, single blocker code, evidence vs expected, gate map, timeline, thrash signals.

## 13. Pilot graph (internal)

Name: `pilot-research-validate-doc-approve-fanout`  
Org: `pib-platform-owner` only.

Waves:

1. `agent:sage` research brief → expectedArtifacts `[research_doc_id]`
2. `code_check` research doc exists + non-empty sections
3. `agent:docs` draft internal build note from research → `[draft_doc_id]`
4. `code_check` draft artifacts
5. `human_gate` Peet/Pip approve publish-intent scope (capability sample: none for internal draft; include fake `publish` gate on a no-op system node for fail-closed test)
6. Parallel fan-out: `agent:theo` stub engineering checklist + `agent:maya` stub content checklist (per-run concurrency 2–3)
7. `code_check` both checklists present
8. Run succeed quiet

Failure path tests:

- Kill agent output without artifact → block, no false done
- Exceed tiny token budget → pause_run
- Hit per-run concurrency → queue not fail
- Attempt gated system without approvalRef → awaiting_gate / capability_denied
- Transient infra 3x → blocked with errorFamily

Acceptance: golden + failure paths 100%; false-done = 0; stuck diagnosis in one inspect call.

## 14. Failure taxonomy (engine)

| Family | Examples | Retry |
|---|---|---|
| transient_infra | Hermes 502, broken pipe after stream idle, network | yes ≤3 |
| verifier_fail | test red, missing file | limited |
| agent_incomplete | done summary without artifacts | limited / requeue |
| policy | planning not ready, invalid template | no |
| approval_denied | human reject | no |
| budget | ceilings | no auto raise |
| capability | gated without ref | no |
| invalid_spec | bad node config | no |
| unknown | unclassified | no after 1 |

## 15. Open questions (non-blocking for Phase 1)

1. Exact Firestore root vs `projects/{id}/workflowRuns` nesting for multi-project templates — **default top-level `workflow_runs` + optional projectId**.
2. Whether playbook cron flips default to graph backend automatically after pilot — **keep flag, manual flip**.
3. Token rate table ownership (platform config vs org) — **platform defaults, org overlay later**.
4. Decision Brief thrash: routine `project_task.updated` should not stale scope — **separate platform fix; out of graph engine schema but must not block engine work**.

## 16. Non-goals (v0 product shape forever unless Peet revises)

- Second Graphs Kanban board
- Merging CRM knowledge graph
- Every node as full Hermes chat (code/system/wait are not)
- dueDate-only release
- Client product packaging of graphs
- Production without Quinn + Peet promote
- Permanent CEO dashboard for run metrics

## 17. Phased delivery (all mandatory)

| Phase | Deliverable |
|---|---|
| **0** | This ADR + schema + pilot definition + Nora fields locked |
| **1** | Ledger + APIs + playbook promotion path + watcher proof writeback + pilot template + enforcement of concurrency/budget/gates/idempotency |
| **2** | Inspector, stuck SLAs, quiet success / alert-on-block facts, cron + ≥3 domain events |
| **3** | Suite authoring UX (template/graph editor), harden to acceptance bar |

## 18. Implementation notes for Phase 1 (Theo)

1. Add types under `lib/workflow-graph/` (template, run, attempt, errors).
2. Admin/API routes under `app/api/v1/graph-templates` and `workflow-runs`.
3. Engine module: `advanceRun`, `materializeNode`, `recordAttemptTelemetry`, `enforceBudget`, `enforceConcurrency`.
4. Hook task terminal transitions (existing task PATCH / watcher completion) to `advanceRun`.
5. Reuse `buildProjectTaskCreateData` for materialization.
6. Do not bypass `services/agent-watcher` claim.
7. Tests first: materialization law, false-done rejection, budget pause, concurrency queue, gate fail-closed, idempotent dispatch.
8. Branch: `development` only; no production promote from Phase 1.

## 19. Acceptance bar (perfect)

- Pilot golden + failure path tests at 100%
- False-done rate = 0
- Stuck diagnosis in one inspector call
- Zero second board surface
- Zero ungated publish/spend/deploy/finance/client_message/secrets
- Quiet success; alert only on block/budget/stuck (deduped)

## 20. Evidence / references

- Build spec document `Bh4uxbyFohjoSp96SMUO`
- Nora ops requirements `uvlgc7QqYN6yxgPEbEzT`
- Playbooks: `lib/projects/playbooks.ts`
- Watcher: `services/agent-watcher` (`MAX_CONCURRENT_PER_AGENT=5`, `claimTask`, planning readiness)
- Wiki: `workflow-graph-engine-path-a-2026-08-02.md`, `workflow-graph-ops-cost-controls-2026-08-02.md`
