# QA Feature Story Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the audited gaps in `qa/feature-stories.csv` so route aliases, admin controls, Billing/EFT, status, and safety-sensitive admin operations are implemented rather than redirect-only or config-only.

**Architecture:** Fix hard false positives first, then add bounded production-safe implementations for the remaining admin and portal workflows. Prefer existing Firestore/API/UI patterns and add focused regression tests around route mappings, safety guards, and story-critical behavior.

**Tech Stack:** Next.js App Router, TypeScript, Firestore Admin SDK, Jest, React Testing Library, existing PiB UI primitives.

## Global Constraints

- Work on `partnersinbiz-web` branch `development`; do not touch `main`.
- Preserve existing user/agent work; do not revert unrelated changes.
- Use TDD for behavior changes where practical: add focused failing tests first, then implementation, then rerun tests.
- Treat redirect-only rows as incomplete unless the redirect lands on a page that satisfies `expected_behaviour`.
- Platform-wide destructive or mutating admin operations must require super-admin, strong confirmation, and audit/quarantine where applicable.
- Billing must be EFT-first / PayPal-second and must not introduce Stripe card dependencies.
- Keep changes scoped to the assigned slice and avoid overlapping write sets between workers.

---

### Task 1: Routing False Positives and Admin Alias Safety

**Files:**
- Modify: `next.config.ts`
- Modify: `app/(admin)/admin/org/[slug]/layout.tsx`
- Test: `__tests__/app/qa-feature-story-route-aliases.test.ts`

**Deliverable:** CRM namespace aliases resolve to real portal pages; `/admin/organisations/new` resolves correctly; admin org alias handling does not silently route IDs into slug-only pages.

**Steps:**
- [ ] Add failing tests for CRM aliases, `/admin/organisations/new`, and `/admin/organisations/:orgId` ordering.
- [ ] Update redirect ordering and missing aliases.
- [ ] Make admin org route tolerate ID fallback or redirect aliases only to safe slug-aware paths.
- [ ] Run focused route alias tests.
- [ ] Commit with message `fix(qa): close route alias false positives`.

### Task 2: Portal Billing EFT and Public Status Page

**Files:**
- Modify: `app/(portal)/portal/invoicing/[id]/page.tsx`
- Modify: `app/(portal)/portal/payments/page.tsx`
- Modify: `lib/payments/eft.ts`
- Create/modify: `app/invoice/[token]/page.tsx`
- Create/modify: `app/status/page.tsx`
- Create/modify: `app/api/v1/status/route.ts`
- Test: focused Billing/status tests under `__tests__/app` and `__tests__/api`

**Deliverable:** EFT portal flow exposes bank details, proof upload/pending state, VAT/history improvements, a public invoice token route or no dead token URL, and a no-auth public status page backed by safe status data.

**Steps:**
- [ ] Add failing tests for public status route/page and invoice EFT UI behavior.
- [ ] Implement no-auth `/status` and safe `/api/v1/status`.
- [ ] Implement authenticated invoice EFT bank details and proof upload path using existing `payment-instructions` and `payment-proof` APIs.
- [ ] Fix `/invoice/[token]` dead URL by implementing the public read-only invoice page or changing generated URL to an existing route.
- [ ] Run focused tests.
- [ ] Commit with message `feat(billing): finish EFT portal and public status surfaces`.

### Task 3: Admin Content, Email, Legal, and Maintenance Wiring

**Files:**
- Modify: `app/api/v1/admin/content/seo/**`
- Modify: `lib/content/posts-firestore.ts`
- Modify: `app/sitemap.ts`
- Modify: `app/api/v1/admin/content/sitemap/route.ts`
- Modify: `app/api/v1/admin/email/**`
- Modify: `lib/email/**`
- Modify: `lib/governance/maintenance.ts`
- Modify/create middleware or request guard if needed
- Modify: `app/api/v1/admin/legal/**`
- Test: focused admin content/email/legal/maintenance tests

**Deliverable:** Admin SEO publishes into live insight content or live readers include admin articles; sitemap admin affects live sitemap; maintenance mode is enforced; email controls/domain rules are enforced on normal sends; legal/GDPR/compliance flows cover story-critical side effects.

**Steps:**
- [ ] Add failing tests for live SEO publish/readback, sitemap config usage, maintenance enforcement, email pause/domain enforcement, and GDPR scope.
- [ ] Wire admin SEO to live content model.
- [ ] Make `app/sitemap.ts` consume admin sitemap exclusions/live admin SEO articles.
- [ ] Enforce maintenance mode for non-admin public/portal/API traffic with 503 behavior where appropriate.
- [ ] Make normal send/domain-registration paths consult platform email controls/domain rules.
- [ ] Expand legal/GDPR/compliance story-critical persistence and acceptance/export/erase behavior.
- [ ] Run focused tests.
- [ ] Commit with message `feat(admin): wire content email legal maintenance controls`.

### Task 4: System Safety, Rate Limits, and Observability

**Files:**
- Modify: `app/api/v1/admin/system/backups/**`
- Modify: `app/api/v1/admin/system/database/**`
- Modify: `app/api/v1/admin/system/storage/**`
- Modify: `app/api/v1/admin/system/rate-limits/**`
- Modify/create: `lib/rateLimit*`
- Modify/create: `lib/admin/audit*`
- Test: focused system safety/rate-limit tests

**Deliverable:** Backup restore validates org/collections, destructive database/storage operations are audited and quarantine/strong-confirmation protected, and admin rate-limit overrides are enforced by the actual rate-limit path.

**Steps:**
- [ ] Add failing tests for unsafe backup payload rejection, collection allowlist, destructive operation audit/quarantine, and rate-limit override enforcement.
- [ ] Restrict backup restore to `BACKUP_COLLECTIONS`, validate `payload.meta.orgId`, and require stronger confirmation.
- [ ] Add immutable admin audit events for backup/database/storage mutations.
- [ ] Replace hard delete of storage orphans with quarantine unless explicitly confirmed by digest.
- [ ] Wire `rate_limit_config` and `rate_limit_overrides` into the runtime rate limiter.
- [ ] Run focused tests.
- [ ] Commit with message `fix(admin): harden system operations and rate limits`.

### Task 5: Admin Backlog Surfaces and 2FA

**Files:**
- Create/modify routes under `app/(admin)/admin/` for properties, moderation, audit-log, domains/SSL, A/B tests, analytics ingestion, report templates, social credentials, Scrolledbrain, CSV import, announcements, changelog, and admin 2FA.
- Modify: `components/admin/navConfig.ts`
- Modify: `app/(admin)/layout.tsx`
- Test: focused route-contract/admin-auth tests

**Deliverable:** Remaining Admin stories are no longer broad hub redirects. Each story has a concrete admin route with at least useful data model/UI/actions matching CSV expectations, and admin access enforces mandatory 2FA where required.

**Steps:**
- [ ] Add route-contract tests proving the redirect-only backlog routes have real pages.
- [ ] Create bounded admin pages/APIs for each missing story, reusing existing collections and UI primitives.
- [ ] Add mandatory admin 2FA gate or explicit admin 2FA setup/challenge flow.
- [ ] Update admin navigation and remove obsolete redirects.
- [ ] Run focused route-contract tests.
- [ ] Commit with message `feat(admin): replace backlog redirects with real control surfaces`.

### Task 6: Integration, QA CSV, and Verification

**Files:**
- Modify: `qa/feature-stories.csv`
- Modify: `qa/feature-stories-reverified.csv` if used as secondary ledger
- Modify: PiB KB/logs after completion

**Deliverable:** CSV status reflects verified reality, tests pass, and branch is pushed to `origin/development`.

**Steps:**
- [ ] Reconcile CSV rows to `VERIFIED`, `PARTIAL`, `GAP`, or `UNVERIFIABLE` during implementation and only mark complete when behavior is covered.
- [ ] Run focused Jest suites from each task.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run lint:ratchet`, and `git diff --check`.
- [ ] Commit integration fixes and push `origin/development`.
- [ ] Update PiB hot cache/session log/wiki with final status and blockers, if any.
