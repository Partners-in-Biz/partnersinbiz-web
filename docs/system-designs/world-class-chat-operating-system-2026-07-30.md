# Partners in Biz Chat Operating System

Date: 2026-07-30
Status: active plan of record
Working branch: `development`

## Product outcome

Messages is the primary operating surface for Partners in Biz. A member should be
able to communicate with people and agents, inspect current business state, make
decisions, execute authorised work, and verify the result without navigating to
another module.

This does not mean duplicating every module inside a chat bubble. It means every
business object implements the same chat contract:

1. attach it as context;
2. read a permission-filtered live model;
3. preview its real current state;
4. expose the actions the caller may take;
5. execute an action through the canonical module API;
6. return a durable receipt and refresh the preview;
7. escalate approval, missing access, or missing skill without pretending the
   action happened.

## Current capability truth

| Area | Current foundation | Remaining gap |
| --- | --- | --- |
| Project management | Project-scoped chats, Project Pulse/Living Thread, task feed, Decision Brief planning, command-session lifecycle events, agent handoff, project Workbench execution | Portfolio commands and every project mutation still need one discoverable chat action catalogue and consistent receipts |
| Campaigns | Campaign/social context adapters, email marketing, ads, content campaigns, review/launch APIs | Campaign families are fragmented; not every campaign object presents the same live state/action contract in Messages |
| Studios | Marketing, Video, Book, YouTube and Mobile context namespaces and artifact adapters | Some studio roots are summary-only and several artifact actions still require opening the full module |
| Live previews | All 25 registered context kinds now declare an authoritative source, receive normalized freshness metadata and refresh every 5 seconds; Messages labels the source as Live | Five kinds have specialized inline adapters, one is sealed-runtime, and 20 still navigate to their canonical module. Event-driven context subscriptions plus visible stale/offline states remain |
| Agent execution | Twelve governed system agents, signed per-agent skill packs, explicit capabilities/approval gates, linked-computer and organisation-VPS grants, public marketplace templates | No canonical role blueprint turns a member’s department/job into a recommended agent team and skill pack. HR and dedicated finance/legal roles are absent |
| Human messaging | Explicit human participants, direct/group creation, attachments, privacy enforcement, participant-only reply access | Prior to this slice, active human messages were a 3-second poll, new chats did not appear live, and non-Workspace groups could not change membership |
| Workbench | Files, changes, Jobs, approval-gated terminal Session, browser observation/control, linked folders and machine routing | Workbench remains an expert surface; chat needs higher-level capability discovery and clearer action receipts for ordinary business users |
| Governance | Module policies, participant checks, per-runtime agent grants, approval gates, delegated human identity, audit logs | Universal chat actions need a common authorization envelope so module-specific routes cannot drift |

## P0 architecture

### 1. Live conversation plane

One authenticated server-mediated stream carries:

- the caller’s current conversation rail;
- the active conversation;
- the active message timeline;
- later, unread/read state, typing/presence and attention events.

The stream must:

- keep Firestore records server-only;
- apply the canonical conversation and mutable project-link checks;
- serialize browser-safe views only;
- reconnect automatically on bounded serverless connections;
- fall back to polling when EventSource is unavailable;
- never overwrite optimistic sends or a newly selected conversation.

First slice implemented on `development`:

- `/api/v1/conversations/live`;
- 2-second change-detected snapshots over SSE;
- live rail updates, including chats created by another member;
- live active-thread updates for agent, direct-human and group chats;
- generic direct/group participant management with the owner retained;
- existing Workspace private/shared/organisation semantics preserved.

Still required:

- per-user unread counters and last-read receipts;
- mentions and notification routing;
- typing and online presence;
- delivery/read indicators;
- group avatar/name controls and member-change system events;
- message search, reply threading, reactions, edit/delete policy and retention.

### 2. Universal context and preview contract

Every business module must register:

```ts
interface ChatBusinessAdapter {
  resolveReadModel(input): Promise<PermissionFilteredReadModel>
  subscribe?(input): AsyncIterable<ContextChange>
  listActions(input): Promise<AuthorisedAction[]>
  executeAction(input): Promise<ActionReceipt>
}
```

The read model must include:

- identity and canonical deep link;
- `asOf`, source and freshness state;
- pulse metrics;
- grouped current records;
- artifacts/previews;
- activity;
- attention items;
- authorised capabilities;
- safe actions with approval requirements.

Required adapter coverage:

- Projects, tasks, suites and portfolio;
- CRM companies, contacts, deals and activities;
- documents and approval/version history;
- mailbox threads, drafts and send/reply;
- social content and inbox;
- content, email and paid-media campaigns;
- Marketing, Creative Canvas, Video, Book, YouTube and Mobile studios;
- reports and analytics;
- billing, invoicing, accounting and payroll;
- support and operations;
- people/HR records where lawfully permitted;
- properties and bookings;
- Workbench execution.

First universal-coverage slice implemented on `development`:

- an exhaustive registry maps every one of the 25 context kinds to its domain,
  authoritative source, refresh interval, adapter/action level and recommended
  operating agents;
- successful adapter resolutions receive normalized, server-declared freshness
  metadata rather than trusting client labels;
- `/api/v1/chat-context/capabilities` exposes organisation-scoped coverage for
  readiness and drift checks;
- Messages identifies authoritative live previews with a source-labelled
  `Live` badge;
- current coverage is 25 live-readable, five specialized inline-action, one
  sealed-runtime and 20 navigation-action kinds.

This registry is the coverage contract, not a claim that all business mutations
are available inline. The next adapter work promotes navigation-only kinds to
specialized actions with canonical receipts.

### 3. Chat action registry

Agent prose must never be the authority for what can be done. A server registry
must return actions from actual module permissions and current object state.

Every action returns:

- action id and idempotency key;
- human actor and optional agent attribution;
- target object and before/after version;
- approval decision or blocking reason;
- execution status;
- canonical result/deep link;
- audit/event ids;
- refresh hints for the live preview.

### 4. Role-to-agent blueprints

Organisation roles remain coarse security roles. Department and job title drive
recommendations, not silent privilege escalation.

Each blueprint defines:

- recommended module preset;
- recommended agents;
- required public/domain skill packs;
- allowed runtime targets;
- capabilities requiring human approval;
- onboarding checklist and readiness tests.

Initial blueprints:

| Domain | Default agent team | Core skill areas |
| --- | --- | --- |
| Executive/owner | Pip, Data, Nora | orchestration, projects, reports, approvals, finance summary |
| Sales | Sales, Pip, Docs | CRM, pipeline, outreach, proposals, calendar, reporting |
| Marketing | Maya, Ads, SEO, Data | content, social, email, paid media, analytics, studios |
| Project delivery | Pip, Theo, QA Release, Docs | planning, tasks, implementation, QA, documents |
| Customer support | Support, Nora, Docs | triage, inbox, CRM history, knowledge, escalation |
| Finance | dedicated Finance agent, Data, Nora | invoicing, accounting, payroll, reports, controlled approvals |
| HR/People | dedicated People agent, Docs, Nora | onboarding, policies, leave, reviews, private people records |
| Operations | Nora, Pip, Data | processes, inbox, projects, reporting, recurring work |

No member receives an agent or capability merely from a text department value.
An owner/admin reviews the recommended blueprint and the platform records the
explicit per-agent/per-runtime grants.

### 5. Project and business execution from chat

Messages becomes a command layer over canonical module services:

- start/plan/approve a project;
- create, assign, block, review and close tasks;
- create and run campaigns with approval gates;
- draft, review and publish Studio artifacts;
- operate CRM, mailbox, documents and reports;
- run governed finance/HR workflows;
- launch Workbench execution when code or host access is needed.

The module remains the source of truth. Chat never creates a parallel task,
campaign, document, approval or finance engine.

## Delivery order

### P0 — trustworthy team messenger and universal operating contract

1. Live rail and active-thread stream. Shipped on `development`.
2. Editable direct/group membership. Shipped on `development`.
3. Unread/read, mentions, presence and notifications. Per-member unread counters
   and exact-latest read receipts are shipped on `development`; mentions,
   presence and notification controls remain.
4. Shared adapter/action/receipt schema. Live-read capability/freshness coverage
   is shipped; common mutation and receipt contracts remain.
5. Gap-test every existing context adapter against the schema. Exhaustive
   registry coverage is shipped; specialized action/read-model gap closure
   remains.

### P1 — role-complete agent workforce

1. Role blueprint schema and recommendation UI.
2. People/HR and Finance agent templates plus safe skill packs.
3. Owner approval and per-runtime provisioning.
4. Readiness/drift checks visible in Messages.
5. Cross-agent handoff receipts and failure recovery.

### P1 — complete business surfaces

1. CRM, mailbox, documents and reports.
2. Campaign unification.
3. All Studio roots and artifacts.
4. Finance/accounting/payroll after its architecture approval.
5. HR/People after data classification, retention and permission review.

### P2 — world-class collaboration quality

1. Search, threads, reactions and message controls.
2. Voice/video and meeting artifacts where justified.
3. Offline/PWA sync and push notifications.
4. Cross-company guest channels with explicit trust boundaries.
5. Analytics for completion rate, latency, blocked actions and stale previews.

## Release gates

A capability is not complete because code exists or an HTTP route returns 200.
Each vertical slice requires:

- focused tests plus full typecheck/lint/build within the current shared tree;
- privacy and cross-tenant tests;
- idempotency and concurrency tests;
- signed-in two-member browser acceptance for human collaboration;
- live agent acceptance on the intended Mac/VPS runtime;
- exact deployment SHA/alias readback;
- rollback path and audit evidence;
- PiB wiki, hot cache and session log update.

Production promotion remains separately approved.
