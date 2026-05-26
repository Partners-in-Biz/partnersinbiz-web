# Firestore Indexes & TTL Policies Needed

Running list of Firestore console changes required as new collections/filters
ship. Each entry notes the collection, what's required, and why.

## TTL Policies

### `idempotency_keys` — 24h TTL on `createdAt`

- **Collection:** `idempotency_keys`
- **Field:** `createdAt`
- **Policy:** expire documents 24 hours after `createdAt`
- **How:** GCP Console → Firestore → TTL → Add Policy → collection `idempotency_keys`, field `createdAt`, TTL of 1 day
- **Why:** `withIdempotency` middleware (`lib/api/idempotency.ts`) caches POST responses keyed by `${uid}:${path}:${Idempotency-Key}` for 24h. The middleware also checks the age on read, but the TTL policy keeps the collection from growing unbounded.
- **Status:** manual step — not yet applied

## Composite Indexes

### `contacts` — tags array-contains-any + createdAt desc

- **Collection:** `contacts`
- **Fields:** `tags` (array-contains), `createdAt` (descending)
- **Why:** `GET /api/v1/crm/contacts?tags=a,b,c` combines `where('tags', 'array-contains-any', [...])` with `orderBy('createdAt', 'desc')` — Firestore requires a composite index for this combination.
- **Status:** required — deploy via Firebase console or `firestore.indexes.json`

### `contacts` — stage|type|source + tags + createdAt desc (as needed)

- **Collection:** `contacts`
- **Fields:** one of (`stage` ==, `type` ==, `source` ==) combined with `tags` (array-contains) + `createdAt` desc
- **Why:** tags filter can be combined with stage/type/source filters on the same endpoint. Firestore will emit a console hint (with a one-click "create index" link) the first time each combination is hit — create those as they appear.
- **Status:** create on demand

### `activities` — orgId + createdAt desc

- **Collection:** `activities`
- **Fields:** `orgId` (==), `createdAt` (descending)
- **Why:** `mark-paid` (and other writes) append to `activities` with `orgId` set; any future listing endpoint will query by org + recency.
- **Status:** create when the activities list endpoint lands

### `notifications` — feed + unified inbox (A3-notifications-inbox)

`/api/v1/notifications` and `/api/v1/inbox` always scope by `orgId` and sort
`createdAt desc`. The feed filters by combinations of `status`, `userId`,
`agentId`, and `type`. Add the following composites — Firestore will emit a
one-click create link in server logs the first time each filter combination
runs.

- **`notifications` (orgId ==, status ==, createdAt desc)** — org-wide list filtered by status (default inbox view with `for=all`).
- **`notifications` (orgId ==, userId ==, status ==, createdAt desc)** — per-user feed + `read-all` (primary human-recipient query).
- **`notifications` (orgId ==, agentId ==, status ==, createdAt desc)** — per-agent feed + `read-all` (primary agent-recipient query).
- **`notifications` (orgId ==, type ==, status ==, createdAt desc)** — filter by notification type (e.g. all `invoice.paid`).
- **Status:** required — create on demand as filter combinations first run in each environment.

### Inbox aggregator sources (A3-notifications-inbox)

`/api/v1/inbox` fans out to multiple collections. Each source needs an index
to support its filter + `createdAt desc` sort. Duplicates with other agents'
sections are fine — dedupe happens in Phase C.

- **`comments` (orgId ==, mentionIds array-contains, createdAt desc)** — mention feed. A4 owns `comments` and denormalises mentions into `mentionIds: string[]` (see A4 section below). Inbox queries with key `user:<uid>` or `agent:<id>`.
- **`tasks` (orgId ==, assignedTo.id ==, status in, createdAt desc)** — assignment feed. Duplicate with A2; dedupe later.
- **`expenses` (orgId ==, status ==, createdAt desc)** — pending-approval expenses. Collection owned by another workstream; create on demand.
- **`social_posts` (orgId ==, status ==)** — pending-approval posts. Likely already exists (`/api/v1/social/posts/pending`).
- **`invoices` (orgId ==, status ==)** — overdue invoice feed. Likely exists from `/api/v1/invoices` queries.

### `tasks` — standalone tasks module (A2-tasks)

`/api/v1/tasks` always scopes by `orgId` and sorts `createdAt desc`. Add the
following composites — Firestore will emit a one-click create link in the
server logs the first time each unseen filter combination runs, so start with
the spec-suggested three and let the console fill in the rest on demand.

- **`tasks` (orgId ==, status ==, dueDate asc)** — open tasks due by date (spec-suggested).
- **`tasks` (orgId ==, assignedTo.id ==, status ==)** — workload per assignee by status (spec-suggested).
- **`tasks` (orgId ==, projectId ==, status ==)** — project task boards (spec-suggested).
- **`tasks` (orgId ==, status ==, createdAt desc)** — default list with a status filter.
- **`tasks` (orgId ==, priority ==, createdAt desc)** — priority filter.
- **`tasks` (orgId ==, projectId ==, createdAt desc)** — project-scoped list.
- **`tasks` (orgId ==, contactId ==, createdAt desc)** — contact-scoped list.
- **`tasks` (orgId ==, dealId ==, createdAt desc)** — deal-scoped list.
- **`tasks` (orgId ==, assignedTo.type ==, assignedTo.id ==, createdAt desc)** — "my tasks" for a user or agent.
- **`tasks` (orgId ==, dueDate asc, createdAt desc)** — `dueBefore` / `dueAfter` range combined with default sort.
- **`tasks` (orgId ==, tags array-contains, createdAt desc)** — tag filter combined with default sort.
- **Status:** create on demand as filter combinations are first exercised in each environment.

### `comments` — unified cross-resource comments (A4-comments)

The unified `/api/v1/comments` collection always scopes by `orgId` and sorts
`createdAt asc` for a thread (or `desc` for "by me" / inbox lookups). Add the
following composites.

- **`comments` (orgId ==, resourceType ==, resourceId ==, createdAt asc)** — thread view for a single resource (the primary list query from `GET /comments?resourceType=X&resourceId=Y`).
- **`comments` (orgId ==, createdBy ==, createdAt desc)** — "comments by me" across resources.
- **`comments` (orgId ==, mentionIds array-contains, createdAt desc)** — "everywhere I'm mentioned" for the unified inbox.
- **Note — nested map arrays are not indexable.** `mentions[]` is an array of `{type, id, raw}` objects, and Firestore cannot index fields inside an array of maps. We therefore denormalize to `mentionIds: string[]` on every comment — a flat array of `${m.type}:${m.id}` strings — written in both POST `/comments` and PATCH `/comments/[id]` whenever `body` changes. The inbox agent queries `.where('mentionIds', 'array-contains', 'user:abc123')` against this field.
- **Status:** required — deploy via Firebase console or `firestore.indexes.json`.

### `uploads` — files endpoint (A5-files-calendar)

`/api/v1/files` is a read/delete wrapper over the `uploads` collection written
by `POST /api/v1/upload`. Always scopes by `orgId`.

- **`uploads` (orgId ==, mimeType ascending+range, createdAt desc)** — the `type` query param is a mime-prefix (e.g. `image/`) implemented as a range query (`mimeType >= 'image/' AND mimeType < 'image/\uf8ff'`). Firestore requires the first `orderBy` to match the range field, so list queries with `type` sort by `mimeType` then `createdAt desc`.
- **`uploads` (orgId ==, relatedTo.type ==, relatedTo.id ==, createdAt desc)** — filter files attached to a specific resource (contact, deal, project, etc).
- **Nested-field caveat.** Firestore can index nested map fields (`relatedTo.type`, `relatedTo.id`) but the single-field exemption + composite combinations get fiddly. If we hit "cannot combine" errors at write time, **denormalise to flat fields on the upload doc** (`relatedToType: string`, `relatedToId: string`) and re-point the query; code change is one-line.
- **Status:** create on demand as filter combinations are first exercised.

### `calendar_events` — meetings & events (A5-files-calendar)

`/api/v1/calendar/events` always scopes by `orgId` and sorts `startAt asc`.

- **`calendar_events` (orgId ==, startAt asc)** — default window query (`from`/`to` is a range on `startAt`).
- **`calendar_events` (orgId ==, relatedTo.type ==, relatedTo.id ==, startAt asc)** — events scoped to a resource (e.g. all meetings for a contact/deal).
- **`calendar_events` (orgId ==, assignedTo.type ==, assignedTo.id ==, startAt asc)** — "events assigned to me" for a user or agent.
- **Status:** required — the first `/calendar/events` list call will emit the one-click index-create link in server logs.

### `time_entries` — time tracking module (A7-time-tracking)

`/api/v1/time-entries` always scopes by `orgId` and sorts `startAt desc`. The
`/start` and `/running` flows read by `endAt == null` to find a user's active
timer. `/bill` and unbilled-only listings filter by `invoiceId`.

- **`time_entries` (orgId ==, userId ==, startAt desc)** — default "my entries" list for a user, sorted by recency.
- **`time_entries` (orgId ==, userId ==, endAt ==)** — resolves the unique running entry per user; powers `POST /time-entries/start` uniqueness check and `GET /time-entries/running`.
- **`time_entries` (orgId ==, projectId ==, startAt desc)** — project-scoped timesheet views.
- **`time_entries` (orgId ==, invoiceId ==)** — finds entries already attached to an invoice; also used with the `billed=true|false` filter on the list endpoint.
- **Status:** create on demand — Firestore will emit a one-click link the first time each filter combination runs in an environment.

### `reports/*` — aggregate endpoints (A6-reports)

The `/api/v1/reports/*` endpoints fetch org-scoped snapshots and bucket in
memory to keep Firestore queries simple (single equality + optional `in`).
Create the composites below as each report's filter combination is first
exercised in an environment; Firestore will also emit a one-click create link
in the server logs.

- **`invoices` (orgId ==, status ==, paidAt desc)** — revenue report (`/reports/revenue`) and client-value (`/reports/client-value`) both filter on `status='paid'` and then bucket by `paidAt`. We currently sort in memory, but keep the index ready for streaming upgrades.
- **`invoices` (orgId ==, status ==, dueDate asc)** — outstanding report (`/reports/outstanding`) filters on `status in ['sent','overdue','payment_pending_verification']` and ages by `dueDate`. The `in` query today reads without composite ordering, but deploy this once we switch to dueDate-ordered ranges.
- **`deals` (orgId ==, stage, updatedAt desc)** — pipeline (`/reports/pipeline`) and activity-summary (`/reports/activity-summary`) both scope deals by `orgId`; activity-summary filters by `updatedAt` in memory; pipeline groups by `stage`.
- **`time_entries` (orgId ==, startAt asc)** — team utilisation (`/reports/team-utilization`) filters by `orgId` and buckets by `startAt`. Collection is owned by A7 (time-tracking) — the index will also be used by that module's list endpoint. (Duplicate with A7's section — dedupe in Phase C.)
- **`expenses` (orgId ==, date desc)** — expense summary (`/reports/expense-summary`) scopes by `orgId` and buckets by `date`. Collection is owned by A8 (expenses).
- **`social_posts` (orgId ==, status ==, publishedAt desc)** — activity-summary counts `status='published'` posts in a window; composite mirrors how the scheduler already reads this collection.
- **`emails` (orgId ==, status ==, sentAt desc)** — activity-summary counts `status='sent'`. Email writes now consistently include `orgId` across broadcast, sequence, scheduled, and direct send paths; use this org-scoped composite when report traffic makes the query hot. The older unscoped `(status ==, sentAt desc)` note is superseded.
- **`lead_capture_sources`** — no composite is currently required for the v2 list route; it queries `orgId` only, then filters `deleted`/`active` and sorts in memory.
- **`lead_capture_submissions` (captureSourceId ==)** — v2 submissions list queries by `captureSourceId` only and sorts/paginates in memory; create a `(captureSourceId ==, createdAt desc)` composite only if the endpoint is changed to order in Firestore.
- **`campaigns` (orgId ==, status ==, triggers.captureSourceIds array-contains)** — lead-capture `performAutoEnroll` finds active campaigns triggered by a capture source. Firestore will emit a create link on first production hit if the composite is missing.
- **`contacts` (orgId ==, createdAt desc)** — activity-summary counts contacts created in range.
- **`tasks` (orgId ==, status ==, completedAt desc)** — activity-summary counts `status='done'` tasks completed in range.
- **Status:** create on demand as each report is first hit in each environment.

### `expenses` — expenses module (A8-expenses)

`/api/v1/expenses` always scopes by `orgId` and sorts `date desc`. Supersedes
the stub entry earlier in this file. The four spec-suggested composites are
listed first; the console will emit one-click create links for the rest as
each filter combination is first exercised.

- **`expenses` (orgId ==, status ==, date desc)** — pending/approved/etc. lists (spec-suggested).
- **`expenses` (orgId ==, userId ==, date desc)** — per-user expense history (spec-suggested).
- **`expenses` (orgId ==, projectId ==, date desc)** — project-scoped list (spec-suggested).
- **`expenses` (orgId ==, invoiceId)** — reverse lookup of expenses billed to a given invoice (spec-suggested).
- **`expenses` (orgId ==, category ==, date desc)** — category filter with default sort.
- **`expenses` (orgId ==, clientOrgId ==, date desc)** — client-scoped expense history.
- **`expenses` (orgId ==, billable ==, date desc)** — billable filter with default sort.
- **`expenses` (orgId ==, invoiceId ==, date desc)** — `billed=false` branch (`invoiceId == null`) with default sort.
- **`expenses` (orgId ==, date asc/desc)** — `from`/`to` range combined with default sort.
- **Note — `billed=true` uses `invoiceId != null`.** Firestore requires the first `orderBy` to match the inequality field, so that specific call orders by `invoiceId` first. If the `billed` filter becomes hot, switch to a denormalized boolean (`billed: true`) alongside `invoiceId` so we can keep the default `date desc` ordering.
- **Status:** create on demand as filter combinations are first exercised.

### `forms` & `form_submissions` — forms module (A9-forms)

Forms live under `forms/` (org-scoped) and submissions under
`form_submissions/`. The public submit endpoint (`POST /api/v1/forms/[slug]/submit`)
looks up forms by `orgId + slug + active`; admin list/submissions endpoints
scope by `formId` and sort `submittedAt desc`.

- **`forms` (orgId ==, slug ==)** — slug uniqueness check per org on POST / PUT.
- **`forms` (orgId ==, active ==, name ==)** — admin list with active filter (spec-suggested `forms (orgId, active, name)`). `name` contains is filtered in-memory after the query.
- **`forms` (orgId ==, slug ==, active ==)** — public submit lookup (active forms only).
- **`form_submissions` (formId ==, submittedAt desc)** — submissions list default sort (spec-suggested).
- **`form_submissions` (formId ==, status ==, submittedAt desc)** — submissions list with status filter (spec-suggested).
- **Status:** create on demand; Firestore will emit a one-click create link on the first query that needs each combination.

### `form_rate_limits` — 1h TTL on `createdAt`

- **Collection:** `form_rate_limits`
- **Field:** `createdAt`
- **Policy:** expire documents 1 hour after `createdAt`. Buckets are only read within their ~60s window; the extra buffer is slack.
- **How:** GCP Console → Firestore → TTL → Add Policy → collection `form_rate_limits`, field `createdAt`, TTL of 1 hour.
- **Why:** `lib/forms/ratelimit.ts` writes one doc per `(formId, ip, minuteBucket)` — without a TTL the collection grows unbounded.
- **Status:** manual step — not yet applied.

### `outbound_webhooks`, `webhook_queue`, `webhook_deliveries` — outbound webhooks (A10-webhooks)

Durable outbound webhook system: CRUD in `outbound_webhooks`, Firestore-backed
queue in `webhook_queue`, per-attempt audit in `webhook_deliveries`. Worker
runs every minute via `/api/cron/webhooks` and claims pending items in
`nextAttemptAt` order.

- **`outbound_webhooks` (orgId ==, active ==, deleted ==, createdAt desc)** — admin list + the primary `dispatchWebhook` lookup. The worker variant filters all three equalities; the list endpoint also supports optional `active` filtering, so a simpler `(orgId, deleted, createdAt desc)` variant may also be needed — create on demand.
- **`webhook_queue` (status ==, nextAttemptAt asc)** — worker claim query. Required for `processPendingWebhooks` in `lib/webhooks/worker.ts`.
- **`webhook_queue` (webhookId ==, createdAt desc)** — per-webhook queue introspection / debugging.
- **`webhook_deliveries` (webhookId ==, deliveredAt desc)** — required for `/api/v1/webhooks/[id]/deliveries` listing.
- **Status:** required — deploy via Firebase console or `firestore.indexes.json`. Firestore will emit a one-click create link in server logs the first time each combination runs.

### `invoices` — payments + overdue cron (A11-payments)

The payments system adds three new `invoices` queries.

- **`invoices` (orgId ==, status ==, dueDate asc)** — overdue cron sweep in `app/api/cron/invoices/route.ts`. Runs once per status value in `{ sent, viewed, payment_pending_verification }` to find docs past `dueDate`. Firestore requires the composite to combine `status ==` with the `dueDate <` range.
- **`invoices` (paypalOrderId ==)** — single-field lookup; used by the PayPal webhook (`/api/v1/webhooks/paypal`) to locate an invoice from an inbound event. Single-field indexes are auto-created — double-check no field-exemption has disabled it.
- **`invoices` (publicToken ==)** — single-field lookup; used when the public invoice view page needs to resolve a token → invoice id. (`mark-viewed` already knows the id, but future token-only endpoints need this.)
- **Status:** required — deploy via Firebase console or `firestore.indexes.json`.
