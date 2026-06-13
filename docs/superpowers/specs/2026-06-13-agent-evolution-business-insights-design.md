# Agent Evolution Loop and Business Insight Review

**Date:** 2026-06-13
**Author:** Pip
**Status:** Draft for Peet review
**Target branch:** `development`

## Goal

Make the Partners in Biz agent system measurably self-improving and commercially proactive without giving agents unsafe write powers.

The system should:

1. Learn from completed Hermes/PiB agent work, repeated blockers, stale instructions, failed reviews, and missing context.
2. Convert those lessons into reviewable skill/wiki/task proposals with evidence and before/after metrics.
3. Detect business gaps across CRM, SEO, ads, social, support, invoices, projects, and agent output.
4. Create ranked insight cards and internal tasks before Peet has to notice the gap manually.
5. Stay model-agnostic, review-gated, and auditable.

## Research Basis

Peet shared four X posts on self-improving agents and autonomous development loops:

- <https://x.com/0xcodez/status/2065097407965127142?s=12&t=jtLUzZOTq5IWHeAEsz7MrQ>
- <https://x.com/humzaakhalid/status/2065033820018266268?s=12&t=jtLUzZOTq5IWHeAEsz7MrQ>
- <https://x.com/steipete/status/2064998499780084154?s=12&t=jtLUzZOTq5IWHeAEsz7MrQ>
- <https://x.com/0xCodez/status/2065089060104720776>

The practical pattern across them is not "use one special model"; it is:

- Run persistent loops with clear trigger conditions.
- Let agents inspect their own prior work.
- Store durable lessons in skills, memory, or wiki surfaces.
- Route work through specialized agents and independent reviewers.
- Use explicit approval gates for risky actions.
- Keep a tight feedback cycle: observe, propose, review, apply, measure.

Anthropic launched Claude Fable 5 and Mythos 5 on 2026-06-09 as agentic models for long-horizon work, then disabled access for all customers on 2026-06-12 due to a US government directive. That means PiB should borrow the workflow pattern but must not depend on Fable 5 availability. The design below works with the existing Hermes/PiB task watcher model routing and can later opt into stronger models when available.

## Existing PiB Baseline

The platform already has strong primitives:

- `lib/loop-engine/registry.ts` defines loop contracts, triggers, allowed actions, approval gates, evidence requirements, stale thresholds, owners, reviewers, and no-progress policies.
- `lib/loop-engine/executor.ts` evaluates registered loops and creates run records for admin review.
- `app/(admin)/admin/loop-engine/page.tsx` gives an operator surface for loop evaluation.
- `services/agent-watcher/src/watcher.ts` dispatches eligible agent tasks, injects project context and comments, handles dependency release sweeps, and routes reviewer agents.
- `services/agent-watcher/src/hermes.ts` passes `model` and `reasoning_effort` through task metadata, so stronger models can be selected per task without hardcoding a global dependency.
- `lib/briefing/adapters/agentLearningReviewAdapter.ts` already turns agent learning review tasks into briefing cards and includes a clear no-auto-rewrite guard.
- `components/mission-control/PeetMissionControl.tsx` already displays Agent Learning Review metrics in Mission Control.
- `components/agents/SkillTastingLabClient.tsx` already describes the safe Hermes Dreaming pattern: scan, stage, review, validate, approve, apply or discard.

The missing piece is a first-class closed loop that scores recurring agent weaknesses and business gaps, then creates ranked review cards or tasks with evidence, owner, reviewer, approval gate, and outcome measurement.

## Design Principles

1. **Model-agnostic by default** - Use the best available model per task, but keep the loop logic in PiB data contracts and code.
2. **Review-gated learning** - No autonomous skill, wiki, client document, schedule, social, email, ads, billing, secret, production, or client-visible mutation in V1.
3. **Independent verification** - A producing agent can propose an improvement, but a reviewer agent or human-facing review card must verify evidence before durable changes.
4. **Evidence before claims** - Every finding needs source ids, timestamps, excerpts, metrics, and a proposed stop condition.
5. **Commercial usefulness** - Business insight cards must name the opportunity/risk, estimated impact, missing data, and next action.
6. **Tenant safety** - Org-scoped data stays org-scoped. Cross-client pattern mining uses redacted summaries only.
7. **Measurable improvement** - Each accepted learning item should later record whether it reduced repeat blockers, review rework, stale tasks, missed follow-ups, or manual escalation.

## Proposed Loop Registry Additions

Add two planned loops to `LOOP_REGISTRY`.

### `agent-evolution-review`

Purpose: Mine completed agent work and review outcomes for repeatable improvements.

Suggested contract:

- **Status:** `planned`
- **Owner:** `pip`
- **Reviewer:** `qa-release` or `nora`, depending on risk class
- **Risk:** `high`
- **Trigger:** Cron weekly, manual review, and event-triggered after repeated blocker/rework patterns
- **Data sources:** Agent runs, Projects/Kanban tasks, task comments, review status, briefing cards, skill policy, agent output, recent wiki links
- **Allowed actions:** `read`, `draft`, `task-create`, `report`
- **Approval gates:** `human-review`, plus any inherited gate from the proposed target surface
- **Evidence requirements:** Source task/run ids, repeated pattern count, failed or delayed outcome, proposed instruction change, reviewer, validation plan
- **Stop condition:** Stop after creating a review card/task, recording no-op with reason, or linking an accepted learning proposal
- **No-progress policy:** If the same pattern is proposed twice without acceptance, escalate the missing decision instead of creating duplicates

### `business-insight-review`

Purpose: Detect commercial, operational, and data-quality gaps before Peet has to ask.

Suggested contract:

- **Status:** `planned`
- **Owner:** `pip`
- **Reviewer:** `nora`
- **Risk:** `high`
- **Trigger:** Daily/weekly cron, manual review, and selected signals from new CRM, SEO, ads, social, support, invoice, or project events
- **Data sources:** Briefing feed, CRM contacts/deals, capture sources, SEO sprints, ad campaigns, social posts/inbox, invoices, support tickets, reports, projects, agent outputs
- **Allowed actions:** `read`, `draft`, `task-create`, `report`
- **Approval gates:** `human-review`, `client-visible`, `public-publishing`, `paid-spend`, `finance`
- **Evidence requirements:** Source item ids, metric snapshot, opportunity/risk hypothesis, owner, recommended next action, approval requirement
- **Stop condition:** Stop after surfacing an insight card/task, linking it to an existing workstream, or recording that evidence is insufficient
- **No-progress policy:** Suppress repeated weak signals until a new source item, metric delta, or reviewer decision appears

## Data Contract

V1 should avoid a new write-heavy subsystem. Use Projects/Kanban tasks plus briefing adapters, because the app already treats those as durable work and review surfaces.

### `metadata.agentEvolutionReview`

Attach this to internal tasks created by the evolution loop.

```ts
type AgentEvolutionReviewMetadata = {
  type: 'agent-evolution-review'
  schemaVersion: 1
  sourceWindow: {
    from: string
    to: string
  }
  pattern: {
    category: 'stale-instruction' | 'missing-context' | 'repeat-blocker' | 'review-rework' | 'weak-output' | 'unsafe-request' | 'tooling-gap'
    summary: string
    recurrenceCount: number
    firstSeenAt?: string
    lastSeenAt?: string
  }
  sourceLinks: Array<{
    type: 'task' | 'run' | 'comment' | 'briefing' | 'skill' | 'wiki' | 'doc'
    id?: string
    href?: string
    label: string
  }>
  evidence: Array<{
    label: string
    value?: string | number
    href?: string
  }>
  recommendation: {
    action: 'skill-proposal' | 'wiki-proposal' | 'task-template-proposal' | 'tooling-task' | 'routing-change' | 'no-change'
    summary: string
    targetSurface?: string
    approvalGate: 'human-review'
  }
  score: {
    severity: number
    recurrence: number
    confidence: number
    easeOfFix: number
    risk: number
    total: number
  }
  guardrail: string
  verifierAgentId?: string
  reviewStatus: 'pending' | 'approved' | 'changes-requested' | 'rejected'
  outcome?: {
    appliedAt?: string
    afterWindow?: {
      from: string
      to: string
    }
    metricDelta?: Array<{ label: string; before: number; after: number }>
  }
}
```

### `metadata.businessInsightReview`

Attach this to internal tasks and briefing cards created by the business insight loop.

```ts
type BusinessInsightReviewMetadata = {
  type: 'business-insight-review'
  schemaVersion: 1
  orgId: string
  sourceWindow: {
    from: string
    to: string
  }
  lane: 'crm' | 'seo' | 'ads' | 'social' | 'support' | 'invoice' | 'project' | 'agent-output' | 'data-quality'
  insightKind: 'opportunity' | 'risk' | 'missing-data' | 'stale-work' | 'performance-drop' | 'follow-up-gap'
  summary: string
  businessImpact: {
    estimateLabel: string
    metric?: string
    value?: number
    confidence: number
  }
  sourceLinks: Array<{
    type: string
    id?: string
    href?: string
    label: string
  }>
  evidence: Array<{
    label: string
    value?: string | number
    href?: string
  }>
  recommendation: {
    nextAction: string
    ownerAgentId?: string
    ownerRole?: string
    createsTask: boolean
    approvalGate?: 'human-review' | 'client-visible' | 'public-publishing' | 'paid-spend' | 'finance'
  }
  score: {
    impact: number
    urgency: number
    confidence: number
    actionability: number
    risk: number
    total: number
  }
  suppressionKey: string
  reviewStatus: 'pending' | 'approved' | 'changes-requested' | 'rejected'
}
```

## Scoring

Keep scoring deterministic in V1 so tests can lock behavior.

### Agent Evolution Score

```txt
total = (severity * 0.30) + (recurrence * 0.30) + (confidence * 0.20) + (easeOfFix * 0.15) - (risk * 0.15)
```

Score inputs are normalized from 0 to 100.

Create a review task when:

- `total >= 55`, and
- `recurrence >= 2` or `severity >= 75`, and
- source evidence includes at least two source links unless severity is critical.

### Business Insight Score

```txt
total = (impact * 0.35) + (urgency * 0.25) + (confidence * 0.20) + (actionability * 0.15) - (risk * 0.10)
```

Create an insight card or task when:

- `total >= 60`, or
- `urgency >= 85` and `confidence >= 60`, or
- `missing-data` blocks a commercial loop that is already active/planned.

Suppress repeated cards when the same `suppressionKey` appears with no new source item, no metric delta, and no reviewer status change.

## Workflow

### Agent Evolution Flow

1. Loop Engine evaluates `agent-evolution-review`.
2. The loop reads recently completed tasks, failed runs, review comments, stale agent statuses, and learning review cards.
3. The evaluator groups repeated patterns by category, target surface, and failure mode.
4. It scores candidate findings deterministically.
5. For findings above threshold, it creates an internal task with `metadata.agentEvolutionReview`.
6. The briefing feed emits an `agent-learning-review` card using the existing adapter, or a future dedicated `agent-evolution-review` adapter if the card needs separate filtering.
7. Reviewer decides: approve, changes requested, reject, or convert to implementation task.
8. After approved learning is applied, a later run compares before/after metrics and records `outcome.metricDelta`.

### Business Insight Flow

1. Loop Engine evaluates `business-insight-review`.
2. The loop reads org-scoped business signals from existing briefing/feed sources.
3. It detects gaps such as:
   - CRM leads without owner or next action.
   - SEO traffic/opportunity without CRM handoff.
   - Ads spend or campaign movement without linked lead/deal evidence.
   - Social engagement with no response or no conversion task.
   - Overdue invoices or finance risk.
   - Support tickets with repeated issue themes.
   - Agent outputs that create work but no business metric follow-through.
   - Missing attribution or stale client data that blocks an active growth loop.
4. It scores each candidate insight.
5. It creates a briefing card and optionally an internal task with `metadata.businessInsightReview`.
6. The review surface shows source evidence, estimated impact, owner, next action, and required approval gate.
7. Accepted insights become tasks or projects. Rejected weak insights feed suppression rules.

## UI Surfaces

### Mission Control

Extend the existing Agent Learning dashboard with:

- `Business Insights` count for new/pending/approved/rejected.
- Top lanes: CRM, SEO, ads, social, support, invoices, projects, data-quality.
- Highest-impact insight card.
- Oldest unreviewed insight.
- "Missing data blocking growth loops" count.

### Briefings Control Desk

Add source type support for `business-insight-review` and optionally `agent-evolution-review`.

Card copy should make the decision obvious:

- Title: `Business Insight: <summary>`
- Summary: evidence, expected impact, recommended owner, and required approval gate.
- Actions: convert to task, mark accepted, changes requested, reject/suppress.

### Loop Engine Admin

The Loop Engine page should show the two new loops with:

- Status
- Risk level
- Trigger
- Data sources
- Last decision
- Required approval gates

## Safety Gates

V1 must not perform these actions autonomously:

- Edit skills, wiki, or durable memory.
- Publish public or client-visible content.
- Send external email, SMS, social replies, or ad changes.
- Spend money or alter finance records.
- Deploy production or modify secrets/config.
- Delete or destructively rewrite data.

V1 may:

- Read approved internal data sources.
- Draft review cards.
- Create internal tasks.
- Attach evidence metadata.
- Suppress duplicate weak signals.
- Report before/after metrics after human-approved changes.

## Implementation Slices

### Slice 1 - Design and contracts

- Add this design spec.
- Add or update TypeScript metadata types if implementation begins.
- Add fixtures for one agent evolution review and one business insight review.

### Slice 2 - Loop registry

- Add `agent-evolution-review` and `business-insight-review` entries to `lib/loop-engine/registry.ts`.
- Add tests to lock status, risk, allowed actions, approval gates, and evidence requirements.

### Slice 3 - Deterministic scoring

- Add pure scoring helpers for agent evolution and business insight candidates.
- Unit-test thresholds, suppression keys, and edge cases.

### Slice 4 - Briefing source

- Add `business-insight-review` to briefing source types.
- Add an adapter that reads Projects/Kanban task metadata or a future dedicated collection.
- Add feed tests and card-contract tests.

### Slice 5 - Mission Control

- Extend Mission Control metrics for Business Insights.
- Add tests for pending counts, lane grouping, and highest-impact card display.

### Slice 6 - Safe evaluator

- Add a conservative evaluator that produces reports/tasks only.
- Start with fixtures and mocked data before connecting broad live data reads.
- Add no-op/suppression behavior so weak repeated signals do not create noise.

### Slice 7 - Review and application path

- Convert approved insights into normal tasks/projects.
- Keep skill/wiki application in the existing review-gated Hermes Dreaming pattern.
- Record before/after outcome metrics for accepted learning items.

## Acceptance Criteria

The first implementation is complete when:

1. Loop Registry lists `agent-evolution-review` and `business-insight-review` with guarded contracts.
2. Business Insight Review is a first-class briefing source or card type.
3. Agent Evolution findings include source links, recurrence count, score, recommendation, guardrail, and review status.
4. Business Insight findings include lane, impact estimate, evidence, owner, next action, score, suppression key, and approval gate.
5. Mission Control shows pending/approved business insights and still keeps Agent Learning Review visible.
6. Unit tests prove deterministic scoring and duplicate suppression.
7. No test or runtime path allows autonomous external send, publish, spend, production deploy, secret/config change, or durable skill/wiki mutation.

## Open Decisions for Peet

1. Should `business-insight-review` cards be internal-only at first, or should selected accepted insights later appear in client portals?
2. Which owner agents should map to each lane by default: CRM/sales, SEO, ads, social, support, finance, projects?
3. Should accepted business insights create tasks automatically, or require a human click to convert to task in V1? Current implementation requires a review-approved task plus explicit conversion action.
4. How aggressive should daily cadence be for active client accounts versus weekly cadence for dormant accounts?

## Recommendation

Build the model-agnostic PiB loop first:

1. Add the two Loop Registry entries.
2. Add deterministic scoring and suppression.
3. Add `business-insight-review` as a briefing source.
4. Extend Mission Control.
5. Keep durable learning writes inside the existing review-gated Hermes Dreaming pattern.

This gives Peet the practical benefit of the Fable-style self-improving workflow without depending on Fable 5 or any single vendor-specific agent runtime.

## Implementation Progress

2026-06-13:

- Implemented planned Loop Registry entries for `agent-evolution-review` and `business-insight-review`.
- Added deterministic scoring and suppression helpers for agent evolution and business insight candidates.
- Added task-backed `business-insight-review` briefing source support.
- Added Mission Control business insight KPI and dashboard visibility.
- Added a pure conservative evaluator that turns supplied agent/business signal snapshots into internal review task drafts with `metadata.agentEvolutionReview` and `metadata.businessInsightReview`.
- Added idempotent internal review-task persistence for conservative drafts in `lib/loop-engine/review-task-persistence.ts`.
- Extended `POST /api/v1/admin/loop-engine/evaluate` so explicit supplied `agentSignals` / `businessSignals` can return review drafts and, when `persistReviewTasks` is true, write deterministic internal project review tasks.
- Added a cron-compatible live internal task signal collector in `lib/loop-engine/live-signal-collector.ts` plus `GET /api/cron/loop-review`, which mines repeated agent blockers and high-risk blocked project work, then optionally persists review-gated internal tasks.
- Added approved business-insight conversion support in `lib/loop-engine/business-insight-conversion.ts` plus `POST /api/v1/projects/[projectId]/tasks/[taskId]/business-insight-action`, creating internal follow-up tasks with baseline outcome metadata.
- Added automated business-insight outcome measurement in `lib/loop-engine/business-insight-outcomes.ts`; `GET /api/cron/loop-review?mode=measure` compares due action-task current values against baselines and records improved/regressed/unchanged outcomes.
- Added a CRM business-signal adapter in `lib/loop-engine/crm-business-signals.ts` for aggregate revenue/process gaps: unowned high-intent leads and stale open deals. The live collector now merges these CRM signals into `business-insight-review` drafts.
- Added CRM metric refresh support for due business-insight action measurement. `unowned_high_intent_leads` and `stale_open_deals` can now populate `metadata.businessInsightAction.latest` directly from CRM source data before outcome comparison.
- Added a support business-signal adapter in `lib/loop-engine/support-business-signals.ts` for urgent support tickets needing replies and support tickets waiting on us for 2+ days. The live collector now merges these support signals into `business-insight-review` drafts.
- Added support metric refresh support for due business-insight action measurement. `urgent_support_needs_reply` and `stale_support_needs_reply` can now populate `metadata.businessInsightAction.latest` directly from support ticket source data before outcome comparison.
- Added a social business-signal adapter in `lib/loop-engine/social-business-signals.ts` for failed social posts and social posts waiting in QA for 2+ days. The live collector now merges these social signals into `business-insight-review` drafts.
- Added social metric refresh support for due business-insight action measurement. `failed_social_posts` and `social_posts_waiting_qa` can now populate `metadata.businessInsightAction.latest` directly from social post source data before outcome comparison.
- Still pending: richer SEO/ads signal adapters and broader live metric refreshers beyond the first CRM/support/social metrics.
