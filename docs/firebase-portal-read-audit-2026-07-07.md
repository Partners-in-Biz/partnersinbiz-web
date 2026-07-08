# Portal Firebase Read Audit - 2026-07-07

Purpose: keep portal page loads from reading whole Firestore collections just to render counts, small dashboard cards, or first-page lists.

## Dashboard Initial Load

| Surface | Endpoint or fetch | Collections touched | Previous read pattern | Current fix |
| --- | --- | --- | --- | --- |
| Portal dashboard shell | `GET /api/v1/portal/dashboard` | `org_portal_summaries`, reports/properties/connections | Dashboard fetched this endpoint plus projects, social stats, social posts, CRM dashboard, contacts, campaigns, capture sources, and onboarding probes. | Extended payload now includes `summary` from `org_portal_summaries/{orgId}`. Missing/stale summaries rebuild once, persist, and then serve as one materialized read. |
| Projects card and recent rows | Dashboard `GET /api/v1/projects?view=received` | `projects` | Four relationship-field project queries read all matching docs, then counted/sliced in the browser. | Dashboard uses `summary.projects.total`, `summary.projects.active`, and `summary.projects.recent`. Fallback project fetch requests `limit=6`; project route applies optional per-query limits. |
| Post status, trend, scheduled today | Dashboard `GET /api/v1/social/stats` + `GET /api/v1/social/posts` | `social_posts` | Stats read all org posts. Today list read a broad org query then filtered dates in memory. | Dashboard uses `summary.social` and `summary.scheduledPosts`. `/social/stats` returns the fresh summary when available. `/social/posts` applies date range, order, and limit before `.get()` for bounded list calls. |
| Contacts tile | Dashboard `GET /api/v1/crm/contacts?limit=1` | `contacts` | Full org contacts read, filtered/sorted in memory, then `meta.total` returned. | Dashboard uses `summary.counts.contacts`. Contacts `limit=1` meta probes use Firestore `count()` plus one-row query when access rules allow an indexed count. |
| Campaign and capture-source tiles | Dashboard `GET /api/v1/campaigns`, `GET /api/v1/crm/capture-sources` | `campaigns`, `capture_sources` | Campaigns/capture sources read all org docs, filtered/sliced after `.get()`. | Dashboard uses summary counts. List endpoints now query `deleted == false`, apply `limit()` before `.get()`, and return `meta.total` from `count()`. |
| Onboarding checklist | Component-level probes | `social_accounts`, `organizations`, `contacts`, `social_posts` | Checklist fired five extra fetches, including contacts and social stats. | Checklist accepts `summary.onboarding` from dashboard and skips duplicate probes when provided. |

## Portal List Hot Paths

| Route | Collections | Pagination before `.get()` | Count source | Notes |
| --- | --- | --- | --- | --- |
| `GET /api/v1/crm/contacts` | `contacts` | Fast path for `limit=1` applies `limit(1)`; complex filters still use legacy in-memory filtering. | Firestore `count()` on the fast path. | Remaining complex filter/search route needs cursor pagination after soft-delete normalization and assignment-access query design. |
| `GET /api/v1/projects` | `projects` | Optional `limit` now bounds each client-visible relationship query and the direct query. | Existing response shape has no `meta.total`. | Default full project workspace behavior preserved for compatibility; dashboard no longer depends on it. |
| `GET /api/v1/social/stats` | `social_posts`, `org_portal_summaries` | Uses materialized summary when fresh; otherwise legacy live aggregate. | Summary document. | Live fallback remains heavier by design for cache miss/stale rebuild behavior. |
| `GET /api/v1/social/posts` | `social_posts` | Applies status/platform/date range, `orderBy('scheduledAt')`, and `limit()` before `.get()` where possible. | Firestore `count()` for non-personal scoped list calls. | Older `scheduledFor` rows are still compatibility-filtered in memory within the bounded result set. |
| `GET /api/v1/campaigns` | `campaigns` | Yes. | Firestore `count()`. | Requires active docs to have `deleted: false`; dry-run normalization script added. |
| `GET /api/v1/crm/capture-sources` | `capture_sources` | Yes. | Firestore `count()`. | Requires active docs to have `deleted: false`; dry-run normalization script added. |
| `GET /api/v1/crm/companies` | `companies`, limited `contacts`/`deals` fallbacks | Indexed privileged list path applies `deleted == false`, filters, order, cursor, `limit + 1`, and `count()` before `.get()`. | Firestore `count()` on the indexed privileged path. | Search, open-deal, and assignment-restricted views keep the legacy bounded fallback because they need cross-record visibility/filter logic. |
| `GET /api/v1/social/accounts` | `social_accounts` | Applies `limit(page * limit + 1)` before `.get()`. Personal account lists add indexed `accountScope == personal` and `ownerUid == user.uid`. | Bounded read estimate with `hasMore`. | New org account writes now set `accountScope: 'org'` and `ownerUid: null`; legacy rows still need the dry-run migration below before exact org counts can switch to `accountScope == org` + `count()`. Dashboard no longer calls this route on the normal path. |
| `GET /api/v1/client-documents` | `client_documents` | Applies `limit + 1` to direct org docs and uses linked-platform queries for `linked.clientOrgId` / `linked.clientOrgIds` instead of scanning all platform docs. | Bounded read estimate with `hasMore`. | Uses two linked-platform queries then de-dupes client-visible results in memory. |
| `GET /api/v1/projects/reporting` | `projects` subcollections | Bounds each relationship-field project query before loading per-project suites. | N/A. | Explicit deep report stays lazy/user-triggered; selected projects still load subcollections by design. |

## Read Model

Collection: `org_portal_summaries/{orgId}`

Primary fields:
- `counts.contacts`, `counts.projects`, `counts.activeProjects`, `counts.posts`, `counts.publishedPosts`, `counts.pendingApprovalPosts`, `counts.activeCampaigns`, `counts.captureSources`, `counts.socialAccounts`
- `projects.total`, `projects.active`, `projects.recent[]`
- `social.total`, `social.byStatus`, `social.byPlatform`, `social.approvalRate`, `social.last30Days`, `social.last30DaysSeries`
- `scheduledPosts[]`
- `campaigns.active`
- `crm.contacts`
- `onboarding.social`, `onboarding.domain`, `onboarding.contact`, `onboarding.analytics`, `onboarding.post`
- `generatedAt`, `generatedAtIso`, `stale`, `staleReason`, `updatedAt`

Write paths now touch or invalidate the summary for contacts, projects, social posts, social publish/reschedule/queue transitions, campaigns, and capture sources. The touch helper uses `FieldValue.increment` for safe simple counters and marks the summary stale when compound dashboard fields may need a rebuild.

## Guardrails

- `scripts/audit-firestore-read-patterns.mjs` statically checks selected hot route files for `limit`-accepting handlers that call `.get()` before using `.limit()` or `.count()`.
- `__tests__/api/firestore-read-guard.test.ts` runs the guard as a Jest regression test.

## Indexes And Backfills

New composite indexes were added for common portal list patterns. Do not deploy indexes or run production backfills without explicit approval.

Dry-run scripts:
- `node scripts/backfill-portal-summaries.mjs --orgId=<orgId>`
- `node scripts/normalize-portal-soft-delete-fields.mjs --orgId=<orgId>`
- `node scripts/backfill-social-account-scope.mjs --orgId=<orgId>`

Apply mode is explicit:
- `node scripts/backfill-portal-summaries.mjs --orgId=<orgId> --apply`
- `node scripts/normalize-portal-soft-delete-fields.mjs --orgId=<orgId> --apply`
- `node scripts/backfill-social-account-scope.mjs --orgId=<orgId> --apply`

`backfill-social-account-scope` only patches `social_accounts` documents where `accountScope` is missing. It writes `accountScope: 'org'`, `ownerUid: null`, and `accountScopeBackfilledAt`; personal and already-explicit org rows are untouched. Run dry-run first in each environment and review the sample paths before applying.
