# Self-improvement platform integration architecture decision

Task: `WqnuH4bRroTaXTd0xcvq`
Project: `PIB - Website` (`UhlEQl2fsZbhfAcnKmt2`)
Org: `pib-platform-owner`
Source document: `XxBr49k03Xji1CDoyQjG` — `North-star spec: World-class self-improvement system for Partners in Biz`
Spec version: `2026-06-15-v1`
Status: Architecture decision only. No engineering implementation, production release, public publishing, or client-visible release is approved by this document.

## Decision summary

Build the self-improvement system inside the existing Partners in Biz web app as a new gated product module, not as a separate repo/product yet.

Recommended product name in code: `life-os`.

Why:

- The PiB app already has the required multi-tenant auth, org/member model, Projects/Kanban task bus, documents, comments, analytics, notifications, and approval-gate patterns.
- A separate product would duplicate auth, billing, documents, notification, and audit infrastructure before the MVP proves retention.
- Keeping it in PiB behind explicit feature flags gives fast rollback, no production-public exposure by default, and clear upgrade paths into a standalone product later if usage warrants it.

## Where it lives in the app

Use a new top-level portal module under the authenticated portal shell:

- `app/(portal)/portal/life-os/page.tsx` — user dashboard / today view.
- `app/(portal)/portal/life-os/onboarding/page.tsx` — first-run identity, values, domains, baseline, constraints, consent.
- `app/(portal)/portal/life-os/goals/page.tsx` — long-term / quarterly / weekly goals.
- `app/(portal)/portal/life-os/habits/page.tsx` — habits, streaks, recovery plans.
- `app/(portal)/portal/life-os/reflections/page.tsx` — daily check-ins, weekly review, monthly reset.
- `app/(portal)/portal/life-os/experiments/page.tsx` — experiment loop.
- `app/(portal)/portal/life-os/coach/page.tsx` — AI coach conversation surface.
- `app/(portal)/portal/life-os/settings/page.tsx` — consent, privacy, retention, export/delete requests, notification preferences.

Add admin/operator visibility only for support and feature rollout:

- `app/(admin)/admin/org/[slug]/life-os/page.tsx` — operator overview of enabled status, aggregate health, consent state, and support-safe metadata.
- Do not expose raw personal reflections, mood, health, relationship, money, or journal text to admins by default. Admin should see consent/health/status, not private content, unless a user explicitly shares a record for support/review.

Do not put this under the existing Loop Engine route. Loop Engine is internal platform/agent governance; Life OS is a user product surface. The systems may share evidence, run, and insight patterns, but the route/module boundary should stay separate.

## Route structure

Use one API namespace:

- `app/api/v1/life-os/route.ts`
  - `GET` module summary for active user/org.
- `app/api/v1/life-os/profile/route.ts`
  - `GET/PATCH` identity, domains, privacy settings, retention, onboarding state.
- `app/api/v1/life-os/goals/route.ts`
  - `GET/POST` goals.
- `app/api/v1/life-os/goals/[id]/route.ts`
  - `GET/PATCH/DELETE` soft-delete goals.
- `app/api/v1/life-os/habits/route.ts`
  - `GET/POST` habits.
- `app/api/v1/life-os/habits/[id]/route.ts`
  - `GET/PATCH/DELETE` soft-delete habits.
- `app/api/v1/life-os/check-ins/route.ts`
  - `GET/POST` daily check-ins.
- `app/api/v1/life-os/check-ins/[id]/route.ts`
  - `GET/PATCH/DELETE` soft-delete check-ins.
- `app/api/v1/life-os/reviews/route.ts`
  - `GET/POST` weekly/monthly reviews.
- `app/api/v1/life-os/experiments/route.ts`
  - `GET/POST` experiments.
- `app/api/v1/life-os/experiments/[id]/route.ts`
  - `GET/PATCH/DELETE` soft-delete experiments.
- `app/api/v1/life-os/coach/sessions/route.ts`
  - `GET/POST` coaching sessions.
- `app/api/v1/life-os/coach/sessions/[id]/messages/route.ts`
  - `GET/POST` messages. Coach generation must be internal draft by default and must not send notifications/client-visible output without explicit approval/consent.
- `app/api/v1/life-os/insights/route.ts`
  - `GET` computed insights and trends.
- `app/api/v1/life-os/export/route.ts`
  - `POST` start an export job; `GET` job status.
- `app/api/v1/life-os/delete-request/route.ts`
  - `POST` user-initiated deletion request; non-destructive tombstone/queue first, hard delete only after an explicit destructive-data approval gate.

## Auth and org boundaries

Use `withAuth('client', ...)` for all user-facing Life OS routes so portal users, admins, and AI agents can access only through explicit scope rules. Do not use admin-only routes for portal pages.

Scope is stricter than ordinary org module data:

- `orgId` remains the tenant/workspace boundary.
- `ownerUid` is required for every personal Life OS record.
- Portal users can access only records where both `orgId` is in their allowed orgs and `ownerUid === user.uid`.
- Admin users can access Life OS records only in support-safe aggregate/list mode unless the record has `sharedWithSupport === true` or an explicit `sharedWithUid`/`sharedWithOrgRole` grant.
- AI agents use `X-Org-Id` plus an explicit acting user/subject field for any personal operation. Agent writes must include `createdByType:'agent'`, `createdBy`, and `subjectUid`. Reject agent requests without a subject user.
- Never infer a Life OS subject from org alone. For personal data, `orgId` is insufficient.

Recommended resolver:

- Add `lib/life-os/scope.ts` with `resolveLifeOsScope(req, user, requestedOrgId, requestedOwnerUid)`.
- It should call existing `resolveOrgScope` / `canAccessOrg` patterns, then enforce `ownerUid` parity.
- It should return `{ orgId, ownerUid, actorUid, actorRole, supportMode }` or fail closed.

API tenant safety tests must cover:

- `X-Org-Id` mismatch with query/body `orgId` returns 403/400; do not silently normalize.
- Client cannot read another `ownerUid` inside the same org.
- Restricted admin cannot access unassigned orgs.
- Admin support list excludes private content fields by default.
- Agent request without `X-Org-Id` or without `subjectUid` fails.
- Item routes verify parent record ownership and `deleted !== true`.

## Firestore model

Prefer top-level collections with `orgId` and `ownerUid` on every document, rather than deeply nested subcollections, because PiB modules already use top-level collections and test/migration scripts are easier to write.

Collections:

- `life_os_profiles/{profileId}`
  - `orgId`, `ownerUid`, `status`, `onboardingState`, `identity`, `values`, `domains`, `privacy`, `retention`, `notificationPrefs`, `createdAt`, `updatedAt`, `deleted`.
  - Deterministic id: `${orgId}_${ownerUid}` or a hash-safe equivalent.
- `life_os_goals/{goalId}`
  - `orgId`, `ownerUid`, `profileId`, `parentGoalId`, `type:'vision'|'quarterly'|'weekly'|'daily'`, `domain`, `title`, `description`, `metric`, `target`, `status`, `startAt`, `dueAt`, `progress`, `linkedProjectId`, `linkedTaskId`, `createdAt`, `updatedAt`, `deleted`.
- `life_os_habits/{habitId}`
  - `orgId`, `ownerUid`, `profileId`, `goalIds`, `title`, `cue`, `routine`, `reward`, `schedule`, `streak`, `frictionLog`, `recoveryPlan`, `status`, `createdAt`, `updatedAt`, `deleted`.
- `life_os_check_ins/{checkInId}`
  - `orgId`, `ownerUid`, `profileId`, `localDate`, `mood`, `energy`, `focus`, `sleep`, `inputs`, `wins`, `friction`, `notesEncrypted?`, `visibility:'private'|'support-shared'`, `createdAt`, `updatedAt`, `deleted`.
- `life_os_reviews/{reviewId}`
  - `orgId`, `ownerUid`, `profileId`, `periodType:'weekly'|'monthly'`, `periodStart`, `periodEnd`, `summary`, `lessons`, `commitments`, `coachRecommendations`, `createdAt`, `updatedAt`, `deleted`.
- `life_os_experiments/{experimentId}`
  - `orgId`, `ownerUid`, `profileId`, `hypothesis`, `protocol`, `metric`, `startAt`, `endAt`, `status`, `result`, `decision`, `createdAt`, `updatedAt`, `deleted`.
- `life_os_coach_sessions/{sessionId}`
  - `orgId`, `ownerUid`, `profileId`, `title`, `status`, `lastMessageAt`, `createdAt`, `updatedAt`, `deleted`.
- `life_os_coach_messages/{messageId}`
  - `orgId`, `ownerUid`, `sessionId`, `role:'user'|'assistant'|'system'|'agent'`, `content`, `safeSummary`, `model`, `evidenceRefs`, `createdAt`, `deleted`.
- `life_os_insights/{insightId}`
  - `orgId`, `ownerUid`, `profileId`, `kind`, `periodStart`, `periodEnd`, `summary`, `signals`, `recommendations`, `confidence`, `createdAt`, `updatedAt`, `deleted`.
- `life_os_export_jobs/{jobId}`
  - `orgId`, `ownerUid`, `requestedByUid`, `status`, `format`, `artifactRef`, `createdAt`, `completedAt`, `deleted`.
- `life_os_delete_requests/{requestId}`
  - `orgId`, `ownerUid`, `requestedByUid`, `status`, `approvalGateTaskId`, `scope`, `createdAt`, `processedAt`.

Index-safe query rules:

- For portal panels, query by `orgId`, `ownerUid`, and primary order such as `updatedAt` or `localDate`; keep secondary filters in memory when bounded.
- Avoid `where('deleted','!=',true)` in Firestore queries; filter deleted rows in memory.
- Use deterministic `localDate` strings for check-ins and reviews to avoid timezone ambiguity.
- Do not require new composite indexes for MVP unless a measured query needs them. If an index is needed, include it in `firestore.indexes.json` and make rollout part of the implementation task.

## API/library model

Add a module library:

- `lib/life-os/types.ts` — shared domain types and route DTOs.
- `lib/life-os/scope.ts` — org/user/agent subject resolver.
- `lib/life-os/repository.ts` — Firestore CRUD with soft-delete and in-memory filter helpers.
- `lib/life-os/insights.ts` — deterministic insight calculations.
- `lib/life-os/coach.ts` — prompt construction and safety guardrails.
- `lib/life-os/privacy.ts` — support-safe redaction, export shaping, delete planning.
- `lib/life-os/feature-flags.ts` — feature enablement helper.

Keep generated coach output evidence-led:

- The coach should cite only Life OS records visible to the active owner.
- Store `safeSummary` separately from raw private text where possible.
- Do not write to Projects/Kanban, Calendar, Notifications, Email, SMS, or public/client-visible surfaces unless a later approved integration task explicitly opens that path.

## Feature flags

Use a layered flag strategy:

1. Environment kill switch:
   - `NEXT_PUBLIC_LIFE_OS_ENABLED=false` by default for UI exposure.
   - Server-side `LIFE_OS_ENABLED=false` blocks API writes when disabled.
2. Org feature flag:
   - Add `lifeOs` to `settings.features` known flags after approval.
   - Store under `organizations/{orgId}.settings.features.lifeOs`.
3. User beta flag:
   - `users/{uid}.featureFlags.lifeOsBeta === true` or an org member access-policy capability.
4. Route-level guard:
   - Portal navigation renders only when env + org + user beta allow it.
   - API returns 404 or 403 when disabled, not partial data.
5. Emergency rollback flag:
   - `organizations/{orgId}.settings.features.lifeOsReadOnly === true` keeps reads/export available but blocks writes/coach generation.

Do not expose this module in public marketing nav or client-visible announcements until Peet approves public/client-visible release.

## Migrations and backfills

MVP should require no destructive migration.

Implementation sequence:

1. Add empty collections and types; no live data changed.
2. Add feature flags default-off.
3. Add API routes with tests and default-off guard.
4. Add portal/admin UI hidden behind flags.
5. Run seed script only for local/test data.
6. If existing Projects/Tasks need optional linking, add link fields only when a user explicitly links a goal to a project/task.

Any migration/backfill script must:

- Default to `--dry-run`.
- Require `--commit` plus `--approval-task-id` and `--approval-evidence` for writes.
- Accept `--org-id` and optional `--owner-uid` to keep scope bounded.
- Produce a CSV/JSON report artifact.
- Avoid hard deletes; use soft-delete/tombstone plans.

## Rollback plan

Fast rollback without data loss:

1. Disable `NEXT_PUBLIC_LIFE_OS_ENABLED` / `LIFE_OS_ENABLED` or org flag `lifeOs=false`.
2. Set `lifeOsReadOnly=true` if users need export access while writes are paused.
3. Hide portal/admin navigation via flag helper.
4. API write routes return `423 Locked` or `403 Disabled` with a safe message; read/export can remain available if read-only mode is enabled.
5. Stop coach generation and notification jobs first; do not delete user data.
6. If a bad build ships on development/preview, revert the implementation commit on `development` and push. Do not promote to production without approval.
7. If bad data was written, run a dry-run repair report, get destructive/data approval if needed, then apply a bounded repair by `orgId`/`ownerUid`.

## Testing and verification plan

Minimum engineering verification before any implementation task is marked done:

- Unit tests for `resolveLifeOsScope` covering client/admin/ai boundaries.
- Route tests for profile/goals/habits/check-ins item ownership and org/header mismatch.
- Feature-flag tests proving UI/API are hidden when disabled.
- Repository tests proving soft-delete, no cross-owner leakage, and index-safe query shape.
- Component tests for dashboard/onboarding privacy copy and disabled/read-only states.
- `npx eslint` on touched files.
- `npm run typecheck`.
- Heap-bumped `NODE_OPTIONS=--max-old-space-size=4096 npm run build` when practical.

## Approval gates that remain closed

This architecture does not approve:

- Engineering implementation.
- Production deployment or preview promotion.
- Public marketing announcement.
- Client-visible release.
- Personal-data imports/backfills.
- Hard delete of personal data.
- Notifications, email/SMS sends, calendar writes, or automated Projects/Kanban writes from Life OS.
- Secret/env changes.

## Open questions for Peet before implementation

- Is the MVP for Peet/internal dogfood only, selected PiB clients, or all portal users?
- Should Life OS personal data be billable/packaged as part of PiB, or remain an internal product experiment until retention is proven?
- What personal-data retention default should we use: indefinite until delete request, rolling retention, or explicit per-user setting?
- Should coach conversations be stored raw, summarized, or both with an export/delete guarantee?
- Which first module should ship: onboarding + daily check-in, or goals + weekly review?
