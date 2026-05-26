---
name: platform-ops
description: >
  Cross-cutting platform operations on Partners in Biz: API key management, global search,
  dashboard stats, activity feed, file uploads and library, workspace inbox (unified across all
  resources), notifications, outbound webhooks with delivery history and replay, the agent
  manifest, platform staff management (super-admin), all report types (revenue, pipeline,
  outstanding invoices, client lifetime value, expense summary, activity summary, team
  utilization, monthly reports), and FX exchange rates. Also the canonical reference for
  collaboration primitives (idempotency, actor tagging, unified comments, mentions) that all
  other skills use. Use this skill whenever the user mentions anything operational or
  cross-cutting, including: "dashboard stats", "platform stats", "global search",
  "search across everything", "find a doc", "find a contact", "API key", "create API key",
  "rotate key", "revoke key", "list keys", "upload a file", "file library", "list files",
  "find file", "delete file", "system health", "uptime", "platform health", "my inbox",
  "workspace inbox", "what needs my attention", "assigned to me", "pending approvals",
  "overdue items", "mentions", "mark as read", "snooze notification", "notifications",
  "mark all read", "create webhook", "outbound webhook", "subscribe to events", "HMAC verify",
  "webhook delivery", "webhook history", "test webhook", "replay failed webhook",
  "disable webhook", "agent manifest", "what can the agent do", "leave a comment",
  "@mention teammate", "activity feed", "audit log", "recent activity", "platform users",
  "add staff", "invite admin", "super admin", "allowedOrgIds", "restrict admin access",
  "revenue report", "pipeline report", "outstanding invoices report", "client value",
  "expense summary", "activity summary", "team utilization", "monthly report",
  "generate report", "send report", "FX rates", "exchange rates", "currency rates". If in doubt, trigger.
---

# Platform Ops — Partners in Biz Platform API

Cross-cutting platform operations, plus the canonical reference for the collaboration primitives every other skill uses.

## Base URL & Authentication

```
https://partnersinbiz.online/api/v1
```

```
Authorization: Bearer <AI_API_KEY>
```

The `AI_API_KEY` env var contains the platform-wide agent key. Alternatively, per-agent `api_keys` can be created via this skill for granular revocation.

## Collaboration primitives (canonical reference)

Every resource across all skills follows these primitives:

### Actor tagging

Every create/update records:
```json
{ "createdBy": "uid_or_agent_id", "createdByType": "user" | "agent" | "system",
  "updatedBy": "...", "updatedByType": "...", "updatedAt": "..." }
```

Agents and humans leave symmetric audit trails. `system` is reserved for cron-originated writes.

### Idempotency keys

Pass `Idempotency-Key: <uuid>` header on any `POST` that creates billable/notifiable resources. Same key replays the cached response for 24h.

Required for: `POST /invoices`, `POST /expenses`, `POST /quotes`, `POST /email/send`, `POST /tasks`, `POST /time-entries`, `POST /calendar/events`, `POST /forms`, `POST /organizations`, `POST /webhooks`.

Optional (but supported) everywhere else.

### Unified comments

Leave notes on any resource. Supported `resourceType`:
- `invoice`, `quote`, `contact`, `deal`, `project`, `task`
- `expense`, `time_entry`, `form_submission`, `calendar_event`, `client_org`

```json
POST /comments
{ "orgId": "org_abc", "resourceType": "invoice", "resourceId": "inv_xyz",
  "body": "Client wants to extend due date. @user:uid123 please review.",
  "parentCommentId": null, "attachments": ["file_abc"] }
```

`@user:<uid>` and `@agent:<id>` in body auto-create mention notifications. A denormalised `mentionIds: string[]` field on each comment enables fast inbox lookups.

### Unified workspace inbox

**Not the same as `/api/v1/social/inbox`** (which is social engagement).

The workspace inbox aggregates everything needing attention — notifications, mentions, assignments, pending approvals, overdue invoices — in one endpoint.

### Assignments

`assignedTo: { type: 'user' | 'agent', id }` works on tasks and calendar events. Creates a notification on assignment.

### Notifications

First-class notification feed. Types include: `task.assigned`, `invoice.paid`, `invoice.overdue`, `mention`, `form.submitted`, `expense.submitted`, `expense.approved`, `expense.rejected`, `member.invited`, `brand.updated`, `contact.created`, `deal.stage_changed`.

---

## API Reference

### Platform API keys

#### `GET /platform/api-keys` — auth: admin
List keys (hashes not returned; only `keyPrefix`).

#### `POST /platform/api-keys` — auth: admin
Body:
```json
{ "name": "Hermes production agent", "role": "agent", "orgId": "org_abc",
  "expiresAt": "2027-01-01" }
```

`role`: `admin` (prefix `pib_ak_`) or `agent` (prefix `pib_ag_`). Returns the raw key **once** in `keyOnce` — store it immediately. Subsequent GETs only show `keyPrefix`.

Response (201): `{ id, keyOnce, keyPrefix }`.

#### `GET/PUT/DELETE /platform/api-keys/[id]` — auth: admin
`DELETE` revokes.

### Global search

#### `GET /search?q=...` — auth: admin
Query: `q` (min 2 chars), `limit` (default 5, max 20).

Searches across: `contacts`, `projects`, `tasks`, `invoices`.

Response:
```json
[ { "id": "...", "type": "contact" | "project" | "task" | "invoice",
    "title": "...", "subtitle": "...", "url": "/admin/..." } ]
```

### Dashboard

#### `GET /dashboard/stats` — auth: admin
Top-line metrics:
```json
{ "contacts": { "total": 142 },
  "deals": { "total": 23, "pipelineValue": 120000, "wonValue": 45000 },
  "email": { "sent": 312, "opened": 180 },
  "sequences": { "active": 4, "activeEnrollments": 67 } }
```

#### `GET /dashboard/email-stats` — auth: admin
Email-specific metrics: sent, delivered, opened, clicked, bounced over last 30 days.

#### `GET /dashboard/activity` — auth: admin
Recent activity feed for dashboard widgets.

### Activity feed

#### `GET /activity` — auth: admin
Full activity feed (audit log). Filters: `orgId`, `type`, `resourceType`, `resourceId`, `from`, `to`, `page`, `limit`.

### Ads activity types (Phase 7)

Ad lifecycle events emit to the same `activity` collection with these types:

- `ad_campaign.{created|launched|paused|edited|deleted}`
- `ad_set.{created|launched|paused|edited|deleted}`
- `ad.{created|launched|paused|edited|deleted}`
- `ad_creative.{uploaded|archived|synced}`
- `ad_custom_audience.{created|list_uploaded|deleted}`

Each entry has `entityId` + `entityType` + `entityTitle` for cross-linking to the relevant ads admin page.

### Files

#### `POST /upload` — auth: admin
**multipart/form-data** with fields:
- `file` (required)
- `folder` (default `uploads`)
- `orgId`
- `relatedToType` + `relatedToId` (for linking)

Saves to Firebase Storage + writes metadata doc to `uploads` collection.

Response: `{ id, url, name, mimeType, size }`.

#### `GET /files` — auth: admin
List uploaded files. Filters: `orgId` (required), `type` (mime prefix, e.g. `image/`), `search` (filename contains), `relatedToType`, `relatedToId`, `page`, `limit`.

#### `GET /files/[id]` — auth: admin
Metadata including `url`, `mimeType`, `size`, `relatedTo`.

#### `DELETE /files/[id]` — auth: admin
Soft-delete (metadata). `?force=true` hard-deletes the Firestore doc (storage blob is NOT deleted — delete manually if needed).

### Workspace folders and Drive sync policy

For client/workspace assets, prefer the workspace folder registry over ad-hoc uploaded-file paths. A workspace or resource can have many linked folders, each with its own hierarchy, tags, sort order, Drive folder id/url, VPS/local sync targets, visibility, sync mode/state, and conflict/audit status.

V1 operating rules:
- Google Drive is canonical for binary/source assets.
- Obsidian/wiki remains markdown and lightweight text knowledge only; do not put PDFs, video, images, design exports, or other binaries in the vault.
- Folder visibility is per folder: `admin_only`, `admin_agents`, or `admin_agents_clients`.
- PiB roles/visibility decide what the app and agents can read; Drive ACLs must not accidentally expose admin/agent-only folders to clients.
- Sync targets can include both VPS and Peet's local Cowork environment; full file sync is expected for linked asset folders, not metadata-only sync.
- Conflicts must be preserved and audited. Do not use blind last-writer-wins.

Runbook: `docs/deploy/workspace-folder-sync-v1.md`.

### Health

#### `GET /health` — auth: admin
```json
{ "ok": true, "timestamp": "...", "services": { "firestore": "ok", "auth": "ok", "storage": "ok" } }
```

### Workspace inbox

#### `GET /inbox` — auth: admin
Unified inbox aggregating:
- `notification` items (from `notifications`)
- `mention` items (from `comments` where `mentionIds` contains current user/agent)
- `assignment` items (tasks assigned to current user/agent, status `todo`|`in_progress`)
- `approval` items (expenses `status=submitted`, social posts `status=pending_approval`)
- `overdue_invoice` items (invoices `status=overdue`)

Query: `orgId` (required), `for` (`me`|`agent`|`all`, default `me`), `unread` (default `true`), `limit` (default 50, max 200), `cursor` (ISO timestamp for keyset pagination).

Response:
```json
{ "items": [
    { "id": "inbox_X", "itemType": "mention", "resourceType": "invoice", "resourceId": "inv_xyz",
      "title": "Pip mentioned you", "body": "Client wants to extend due date...",
      "priority": "normal", "link": "/admin/invoices/inv_xyz", "createdAt": "..." }
  ],
  "nextCursor": "2026-04-15T09:00:00Z" }
```

#### `POST /inbox/read` — auth: admin
Body: `{ itemIds: string[] }`. Marks notification items read. Non-notification items are marked read by interacting with their resource.

Response: `{ marked: count }`.

#### `POST /inbox/snooze` — auth: admin
Body: `{ itemId, until: ISO }`. Only for notifications.

### Notifications

#### `GET /notifications` — auth: admin
Filters: `orgId` (required), `status` (default `unread`), `userId`, `agentId`, `type`, `limit`, `cursor`.

Item shape:
```json
{ "id": "...", "orgId": "...", "userId": "uid_or_null", "agentId": "aid_or_null",
  "type": "task.assigned", "title": "...", "body": "...", "link": "/admin/tasks/...",
  "data": {...}, "priority": "normal", "status": "unread",
  "snoozedUntil": null, "readAt": null, "createdAt": "..." }
```

#### `POST /notifications` — auth: admin
Body: notification fields. Required: `orgId`, `type`, `title`. At least one of `userId`/`agentId` (or both null for org-wide).

#### `GET/PATCH/DELETE /notifications/[id]` — auth: admin
PATCH updatable: `status`, `snoozedUntil`, `priority`. `status='read'` sets `readAt`.

#### `POST /notifications/read-all` — auth: admin
Body: `{ userId?, agentId?, orgId }`. Marks all unread for that recipient read.

### Outbound webhooks (durable queue)

#### Architecture overview

```
your-api-call → dispatchWebhook() → writes to webhook_queue
                                          │
                                   (every 1 min Vercel cron)
                                          ↓
                                   processPendingWebhooks()
                                          │
                                   POSTs to webhook.url with HMAC signature
                                          │
                                   on success → webhook_deliveries (audit)
                                   on failure → retry with backoff [0s, 30s, 2m, 10m, 1h, 6h]
                                                 max 6 attempts; auto-disable after 10 failures
```

#### `GET /webhooks` — auth: admin
Filters: `orgId` (required), `active`, pagination. Secret is redacted as `***`.

#### `POST /webhooks` — auth: admin (idempotent)
Body:
```json
{
  "orgId": "org_abc",
  "name": "Slack notifier",
  "url": "https://hooks.slack.com/...",
  "events": ["invoice.paid", "deal.won", "form.submitted"],
  "secret": "<optional — auto-generated if omitted>"
}
```

URL must be `https://` in production (dev can allow http via env). Events must be from the allowed list (see below).

Response (201): `{ id, secretOnce, secret: '***' }`. **`secretOnce` is only returned on create** — store it immediately.

#### `GET/PUT/DELETE /webhooks/[id]` — auth: admin
PUT updatable: `name`, `url`, `events`, `active`. See `/rotate-secret` for secret rotation.
DELETE soft-deletes.

#### `POST /webhooks/[id]/rotate-secret` — auth: admin
Rotates the HMAC secret. Returns the new secret once in `secretOnce` — store it immediately. All future deliveries sign with the new secret, so update consumer verification code **before** rotating.

Response (201): `{ id, secretOnce: "new_secret_hex", secret: "***" }`.

#### `POST /webhooks/[id]/test` — auth: admin
Queues a test event bypassing subscription filter. Returns `{ queued: true, queueItemId }`.

#### `POST /webhooks/[id]/enable` / `POST /webhooks/[id]/disable` — auth: admin
Manual enable/disable. Enable clears `autoDisabledAt` + `failureCount`.

#### `GET /webhooks/[id]/deliveries` — auth: admin
Query: `limit` (default 20, max 100), `cursor` (doc id). Sorted `deliveredAt desc`.

Delivery shape:
```json
{ "id": "dl_abc", "webhookId": "wh_xyz", "queueItemId": "wq_abc", "event": "invoice.paid",
  "payloadHash": "sha256...", "responseStatus": 200, "responseHeaders": {...},
  "responseBody": "ok (truncated 2KB)", "durationMs": 142, "attemptNumber": 1,
  "deliveredAt": "...", "error": null }
```

#### `POST /webhooks/[id]/deliveries/[deliveryId]/replay` — auth: admin
Re-queues a fresh `webhook_queue` item copying the original event + payload. Original record untouched.

#### `GET /webhooks/queue-stats` — auth: admin
Global observability snapshot. Optional `?orgId=X` scope. Returns:
```json
{ "byStatus": { "pending": N, "delivering": N, "failed": N, "deliveredLast24h": N },
  "oldestPendingAgeSeconds": N | null,
  "stuckDeliveringCount": N,
  "webhooks": { "total": N, "active": N, "autoDisabled": N },
  "timestamp": "ISO" }
```

`stuckDeliveringCount` = items claimed more than 5 minutes ago and still in `delivering`. Non-zero means a worker died mid-flight — investigate.

#### `GET /webhooks/[id]/queue` — auth: admin
Queue items for a specific webhook (debug view).

Query: `status` (pending|delivering|delivered|failed), `limit` (default 20, max 100), `cursor` (doc id from previous page).

Response: `{ items: [...], nextCursor: string | null }`.

#### Webhook event reference

| Event | Payload fields |
|-------|----------------|
| `invoice.created` | `id, invoiceNumber, total, currency, clientOrgId, dueDate` |
| `invoice.sent` | `id, invoiceNumber, total, currency, clientEmail, dueDate, publicViewUrl` |
| `invoice.paid` | `id, invoiceNumber, total, paymentMethod, paymentReference, paidAmount` |
| `invoice.overdue` | `id, invoiceNumber, total, dueDate, daysOverdue` |
| `quote.created` | `id, quoteNumber, total, currency, clientOrgId` |
| `quote.accepted` / `quote.rejected` | `id, quoteNumber, clientOrgId` |
| `contact.created` / `contact.updated` | `id, name, email, company, source` (orgId in metadata) |
| `deal.created` | `id, title, value, stage, contactId` |
| `deal.stage_changed` | `id, fromStage, toStage, value` |
| `deal.won` / `deal.lost` | `id, value, contactId` |
| `form.submitted` | `formId, slug, submissionId, contactId, data` |
| `payment.received` | `invoiceId, invoiceNumber, amount, paymentMethod, reference` |
| `expense.submitted` | `id, amount, currency, category, userId, submittedBy` |
| `task.completed` | `id, title, projectId, completedBy` |

#### Webhook signature verification (consumer code)

Every request includes:
- `X-PIB-Event` — event name
- `X-PIB-Delivery-Id` — unique delivery id
- `X-PIB-Timestamp` — ms since epoch
- `X-PIB-Signature` — `sha256=<hex>` HMAC of `${timestamp}.${rawBody}` using webhook secret

Node verifier:
```js
import crypto from 'crypto'

function verifyWebhook(req, rawBody, secret) {
  const timestamp = req.headers['x-pib-timestamp']
  const signature = req.headers['x-pib-signature']
  if (!timestamp || !signature) return false

  // Reject if timestamp is more than 5 min old (replay protection)
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return false

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}
```

### Agent manifest

#### `GET /agent` — auth: admin
Returns a manifest of agent-accessible endpoints with examples. Use this to discover capabilities programmatically.

#### `GET /agent/inbox` — auth: admin
Legacy agent-specific inbox — superseded by `/inbox` for new work.

### Reports (cross-cutting)

#### `GET /reports/activity-summary?orgId=X&from=...&to=...` — auth: admin
Cross-module counts: social posts, emails sent, invoices created, deals updated, contacts added, tasks completed.

#### `GET /reports/pipeline?orgId=X` — auth: admin
Deals by stage + values + win rate.

### Comments (full reference)

Listed in "Collaboration primitives" above. Full API:

#### `GET /comments?orgId=X&resourceType=...&resourceId=...` — auth: admin
Sorted `createdAt asc`. Default limit 100. `?includeDeleted=true` to include soft-deleted.

#### `POST /comments` — auth: admin
Creates + parses mentions + notifies mentioned users/agents (async). Response: `{ id, mentions }`.

#### `GET/PATCH/DELETE /comments/[id]` — auth: admin
PATCH: update `body` (re-parses mentions but **does not re-notify**), toggle `agentPickedUp`, update `attachments`.
DELETE soft by default; `?force=true` hard.

---

## Workflow guides

### 1. Set up a new AI agent

```bash
# Issue a scoped API key for the agent
POST /platform/api-keys
{ "name": "Sales follow-up agent", "role": "agent", "orgId": "org_abc",
  "expiresAt": "2027-01-01" }
# → { id, keyOnce: "pib_ag_...", keyPrefix: "pib_ag_abcd" }

# Discover available endpoints
GET /agent
```

### 2. Agent daily loop

```bash
# 1. Pull my inbox
GET /inbox?orgId=org_abc&for=me&unread=true

# 2. Process each item
#    - mention → GET the resource, read context, POST a reply comment
#    - assignment → do the task, then POST /tasks/[id]/complete
#    - overdue_invoice → GET /invoices/[id], POST follow-up email

# 3. Mark handled notifications read
POST /inbox/read
{ "itemIds": ["inbox_a", "inbox_b"] }
```

### 3. Subscribe to events

```bash
# Create webhook
POST /webhooks
{ "orgId": "org_abc", "name": "Slack", "url": "https://hooks.slack.com/...",
  "events": ["deal.won", "invoice.paid", "form.submitted"] }
# → { id: "wh_xyz", secretOnce: "abc...", secret: "***" }

# Test it
POST /webhooks/wh_xyz/test

# Check delivery history
GET /webhooks/wh_xyz/deliveries

# Replay a specific failed delivery
POST /webhooks/wh_xyz/deliveries/dl_abc/replay
```

### 4. Upload + attach a file to a comment

```bash
# 1. Upload
POST /upload   (multipart: file, orgId=org_abc, relatedToType=invoice, relatedToId=inv_xyz)
# → { id: "file_abc", url: "https://..." }

# 2. Attach to a comment
POST /comments
{ "orgId": "org_abc", "resourceType": "invoice", "resourceId": "inv_xyz",
  "body": "Updated quote attached.", "attachments": ["file_abc"] }
```

### 5. Find anything via search

```bash
GET /search?q=acme
# Returns top matching contacts, projects, tasks, invoices
```

### 6. Generate weekly activity summary

```bash
GET /reports/activity-summary?orgId=org_abc&from=2026-04-07&to=2026-04-13
```

### 7. Verify a webhook delivery

On the consumer side: parse headers, verify signature, check timestamp freshness. Sample Node code above.

On sender side: check deliveries for status:
```bash
GET /webhooks/wh_xyz/deliveries?limit=50
```

## Error reference

| HTTP | Error | Fix |
|------|-------|-----|
| 400 | `q must be at least 2 characters` | Lengthen search query |
| 400 | `Idempotency-Key required` (rare) | Pass the header |
| 401 | Unauthorized | Check `AI_API_KEY` or key expiry |
| 403 | Forbidden | Key lacks org access |
| 404 | `Webhook not found` | Verify id |
| 409 | Duplicate action | Check resource state |
| 429 | Rate limited | Respect `Retry-After` header |

## Agent patterns

1. **Poll `/inbox` as your work queue** — it's the unified view. For humans this is their dashboard; for agents it's the daily loop trigger.
2. **Comment before you act** — leave a comment stating what the agent is about to do, then execute, then update the comment with the result. Humans can trust and verify.
3. **Pass `Idempotency-Key` on creates** — especially in retry loops. A UUIDv4 per logical operation is ideal.
4. **Subscribe to webhooks instead of polling** — cheaper, faster, more reliable.
5. **Use `X-PIB-Timestamp` freshness check** — reject webhook payloads older than 5 minutes.
6. **Prefer soft-delete** — `DELETE` is soft by default; only use `?force=true` when you're certain.
7. **Search is eventually consistent** — freshly-created items may not appear for ~1 min.
8. **Activity log everything** — use `POST /activity` (auto-written by most routes) for a durable audit trail.

---

## Platform Users (super-admin staff management)

These endpoints manage PiB **internal staff** (users with `role === 'admin'`). They are restricted to **super admins only** — an admin whose `allowedOrgIds` array is empty. A restricted admin (non-empty `allowedOrgIds`) cannot call these endpoints; this prevents silent self-elevation.

### User model

```json
{
  "uid": "firebase_uid",
  "email": "staff@partnersinbiz.online",
  "displayName": "Alice Smith",
  "role": "admin",
  "orgId": "PIB_PLATFORM_ORG_ID",
  "allowedOrgIds": ["org_abc", "org_xyz"],
  "isSuperAdmin": false,
  "createdAt": "...",
  "updatedAt": "..."
}
```

`isSuperAdmin` is a derived field: `true` when `allowedOrgIds.length === 0`. It is never stored; it is computed on every read.

### `allowedOrgIds` scoping concept

- **Super admin** — `allowedOrgIds: []` (empty). Sees and manages every org on the platform.
- **Restricted admin** — `allowedOrgIds: ["org_a", "org_b"]`. UI and API scope them to those orgs only.
- To convert a restricted admin to super admin, PATCH with `allowedOrgIds: []`.
- A super admin **cannot restrict their own account** via PATCH — they must ask a different super admin. This prevents accidental self-lockout.
- `allowedOrgIds` is admin-surface visibility only. It does not grant client portal/CRM access. To let a PiB admin enter a client portal, add the staff user as an explicit member of that client org through `/admin/org/[slug]/team` or `POST /organizations/[id]/members`.
- For `/admin/org/partners-in-biz/billing`, restricted admins see only PiB-issued invoices where the recipient client is inside `allowedOrgIds`; super admins see all PiB-issued invoices.

### `GET /admin/platform-users` — auth: super-admin

Lists all users with `role === 'admin'`, sorted newest first.

Response:
```json
[
  { "uid": "...", "email": "...", "displayName": "...", "role": "admin",
    "orgId": "...", "allowedOrgIds": ["org_abc"], "isSuperAdmin": false,
    "createdAt": "...", "updatedAt": "..." }
]
```

### `POST /admin/platform-users` — auth: super-admin

Creates a new platform staff account. Finds or creates the Firebase Auth user, writes the `users` doc, then optionally sends a welcome email with a password-setup link.

Body:
```json
{
  "email": "newstaff@example.com",
  "name": "Bob Jones",
  "allowedOrgIds": ["org_abc"],
  "sendWelcomeEmail": true
}
```

- `allowedOrgIds` — omit or pass `[]` for a super admin; pass org IDs to restrict.
- `sendWelcomeEmail` — defaults to `true`. Sends a branded email from the platform address with a Firebase password-reset link so the new user can set their own password.
- If a user with this email already exists as a **non-admin** role (e.g. `member`), returns `409` — resolve in the team page first.

Response (201):
```json
{
  "uid": "...", "email": "...", "displayName": "...", "role": "admin",
  "orgId": "PIB_PLATFORM_ORG_ID", "allowedOrgIds": [],
  "isSuperAdmin": true,
  "setupLink": "https://..."
}
```

`setupLink` is the Firebase password-reset URL returned once at creation. Store or send it immediately — it is not re-exposed later.

### `GET /admin/platform-users/[uid]` — auth: super-admin

Returns a single platform admin by UID. Returns `404` if the UID exists but is not an admin.

### `PATCH /admin/platform-users/[uid]` — auth: super-admin

Updatable fields:
- `name` — updates both Firestore `displayName` and Firebase Auth display name. Cannot be empty string.
- `allowedOrgIds` — replaces the full list. Pass `[]` to promote to super admin. Deduplication and trimming applied automatically.

Self-restriction guardrail: if `uid === caller.uid` and `allowedOrgIds` is non-empty, returns `400` — ask another super admin to do it.

Response: updated user object.

### `DELETE /admin/platform-users/[uid]` — auth: super-admin

Deletes the Firebase Auth user (revokes all sessions) and removes the Firestore `users` doc. Cannot delete yourself — returns `400`.

Response: `{ "uid": "...", "deleted": true }`.

### Workflow: onboard a new staff member

```bash
# 1. Create the account (welcome email sent automatically)
POST /admin/platform-users
{ "email": "alice@example.com", "name": "Alice Smith",
  "allowedOrgIds": ["org_client1", "org_client2"] }
# → { uid, setupLink }

# 2. If the email failed or they need a new link, use Firebase Console
#    or re-POST with sendWelcomeEmail: true (idempotent — merges the doc)

# 3. Promote to super admin later
PATCH /admin/platform-users/<uid>
{ "allowedOrgIds": [] }

# 4. Off-board
DELETE /admin/platform-users/<uid>
```

---

## Reports

Two separate report surfaces:

1. **Snapshot reports** (`POST /reports`) — generates and stores a full monthly report doc (with KPIs, executive summary, brand snapshot). Listed via `GET /reports`.
2. **Ad-hoc query reports** (`GET /reports/revenue`, `/pipeline`, etc.) — live queries, no persistence. Use these for dashboard widgets and agent decisions.

### Snapshot reports

#### `GET /reports?orgId=X` — auth: admin

Lists previously generated report documents for an org.

Query: `orgId` (required), `limit` (default 24, max 100).

Response: `{ ok: true, reports: [...] }`.

#### `POST /reports` — auth: admin

Generates and stores a new report. Uses the org's timezone from the `organizations` collection (defaults to UTC).

Body:
```json
{
  "orgId": "org_abc",
  "type": "monthly",
  "month": "2026-04",
  "start": "2026-04-01",
  "end": "2026-04-30",
  "propertyId": "prop_xyz"
}
```

- `type` — `"monthly"` (default) or any `ReportType`.
- `month` — `YYYY-MM` format. Resolved to the org's timezone month boundaries. Defaults to last completed month.
- `start` / `end` — ISO dates for a custom range (overrides `month`).
- `propertyId` — optional property scope; omit for org-wide.

Response: `{ ok: true, report: { id, orgId, type, period, kpis, exec_summary, highlights, status, publicToken, brand, ... } }`.

Note: `maxDuration` is 60s — report generation can be slow.

#### `GET /reports/[id]` — auth: admin

Fetches one report by ID. Returns `404` if not found.

Response: `{ ok: true, report: {...} }`.

#### `PATCH /reports/[id]` — auth: admin

Editable fields on a stored report:
- `exec_summary` (string)
- `highlights` (string array, max 8 items)
- `status` (`"draft"` | `"sent"` | `"archived"`)

Response: `{ ok: true, report: { updated fields... } }`.

#### `DELETE /reports/[id]` — auth: admin

Soft-archives the report by setting `status: "archived"`. The doc is not removed.

Response: `{ ok: true }`.

#### `POST /reports/[id]/send` — auth: admin

Emails the report to one or more recipients via Resend. Sends a branded HTML email with top-level KPI summary and a CTA button linking to the public report page (`/reports/<publicToken>`). Marks the stored report `status: "sent"`.

Body:
```json
{ "to": ["client@example.com", "cfo@example.com"] }
```

Requirements: report must have a `publicToken` and `RESEND_API_KEY` must be configured.

Response: `{ ok: true, link: "https://partnersinbiz.online/reports/<token>", recipients: [...] }`.

Note: `maxDuration` is 30s.

### Ad-hoc query reports

All ad-hoc report endpoints are live queries — no stored state. Returns empty results gracefully when collections don't exist yet.

#### `GET /reports/revenue` — auth: admin

Revenue grouped into time buckets from paid invoices.

Query:
- `orgId` (required)
- `from` (required, ISO date) — inclusive, matched against `paidAt`
- `to` (required, ISO date) — inclusive
- `groupBy` — `"month"` (default) | `"quarter"` | `"week"` | `"day"`

Response:
```json
{
  "from": "2026-01-01T00:00:00.000Z",
  "to": "2026-04-30T23:59:59.000Z",
  "groupBy": "month",
  "buckets": [
    { "label": "2026-01", "total": 45000, "count": 3 },
    { "label": "2026-02", "total": 62000, "count": 5 }
  ],
  "grandTotal": 107000,
  "currency": "ZAR"
}
```

Mixed-currency response includes `"mixed": true` and per-bucket `byCurrency: { "ZAR": N, "USD": N }` instead of top-level `currency`.

Bucket label formats: `YYYY-MM` (month), `YYYY-Www` (week, ISO), `YYYY-Qq` (quarter), `YYYY-MM-DD` (day).

#### `GET /reports/pipeline` — auth: admin

Deal pipeline snapshot grouped by stage.

Query: `orgId` (required).

Response:
```json
{
  "byStage": {
    "prospect":    { "count": 8,  "value": 80000 },
    "proposal":    { "count": 4,  "value": 55000 },
    "negotiation": { "count": 2,  "value": 30000 },
    "won":         { "count": 12, "value": 140000 },
    "lost":        { "count": 3,  "value": 25000 }
  },
  "totalOpen":      165000,
  "totalClosedWon": 140000,
  "totalClosedLost": 25000,
  "winRate": 0.8
}
```

`winRate` = `closedWonCount / (closedWonCount + closedLostCount)`. Excludes deleted deals.

#### `GET /reports/outstanding` — auth: admin

Outstanding (unpaid) invoices aged by `dueDate`. Statuses included: `sent`, `overdue`, `payment_pending_verification`.

Query: `orgId` (required).

Response:
```json
{
  "buckets": {
    "0-30":  { "count": 3, "total": 15000 },
    "31-60": { "count": 1, "total": 8000  },
    "61-90": { "count": 0, "total": 0     },
    "90+":   { "count": 2, "total": 22000 }
  },
  "total": 45000,
  "count": 6,
  "currency": "ZAR"
}
```

Invoices with no `dueDate` are placed in `0-30`. Mixed currencies add `"mixed": true` and remove top-level `currency`.

#### `GET /reports/client-value` — auth: admin

Lifetime paid invoice value ranked by client org.

Query:
- `orgId` (required) — billing org scope
- `limit` (optional, default 20, max 100)

Response:
```json
{
  "clients": [
    {
      "clientOrgId": "org_abc",
      "clientName":  "Acme Corp",
      "lifetimeValue": 185000,
      "invoiceCount": 14,
      "lastInvoiceAt": "2026-04-10T00:00:00.000Z"
    }
  ],
  "total": 185000
}
```

Sorted descending by `lifetimeValue`. `clientName` is sourced from the snapshotted `clientDetails.name` field on each invoice.

#### `GET /reports/expense-summary` — auth: admin

Expenses grouped by category, project, or user within a date window.

Query:
- `orgId` (required)
- `from` (ISO, optional — defaults to 30 days ago)
- `to` (ISO, optional — defaults to now)
- `groupBy` — `"category"` (default) | `"project"` | `"user"`

Response:
```json
{
  "from": "...", "to": "...", "groupBy": "category",
  "buckets": [
    { "label": "travel",    "total": 12000, "count": 5, "billable": 3, "reimbursable": 2 },
    { "label": "software",  "total": 4500,  "count": 2, "billable": 2, "reimbursable": 0 }
  ],
  "grandTotal": 16500,
  "currency": "ZAR"
}
```

`billable` and `reimbursable` are counts (not amounts) of entries in the bucket with those flags set. Sorted descending by `total`. Returns empty buckets if the `expenses` collection doesn't exist.

#### `GET /reports/activity-summary` — auth: admin

Cross-module activity counts over a date window.

Query:
- `orgId` (required)
- `from` (ISO, optional — defaults to 30 days ago)
- `to` (ISO, optional — defaults to now)

Response:
```json
{
  "from": "...", "to": "...",
  "counts": {
    "socialPosts":      12,
    "emailsSent":       84,
    "invoicesCreated":   7,
    "dealsUpdated":     15,
    "contactsAdded":    23,
    "tasksCompleted":   31
  }
}
```

Each sub-collection query is wrapped in `try/catch` — a missing collection or missing index returns `0` for that metric rather than failing the whole response.

#### `GET /reports/team-utilization` — auth: admin

Billable vs non-billable time per user from the `time_entries` collection (owned by the A7 time-tracking module).

Query:
- `orgId` (required)
- `from` (ISO, optional — defaults to 30 days ago)
- `to` (ISO, optional — defaults to now)

Response:
```json
{
  "users": [
    {
      "userId": "uid_abc",
      "totalMinutes": 2400,
      "billableMinutes": 1920,
      "nonBillableMinutes": 480,
      "utilizationPct": 80.0
    }
  ],
  "totalMinutes": 2400,
  "avgUtilizationPct": 80.0
}
```

`utilizationPct` = `billableMinutes / totalMinutes * 100`, rounded to 2 decimal places. Users sorted descending by `totalMinutes`. Returns zeroed totals if `time_entries` doesn't exist yet.

---

## FX Rates

#### `GET /fx/rates` — auth: public (no API key required)

Returns cached FX-to-ZAR rates for a given date. Rates are not sensitive and are readable without authentication.

Query:
- `date` (optional, `YYYY-MM-DD`) — defaults to today.

Response:
```json
{
  "ok": true,
  "date": "2026-05-07",
  "base": "ZAR",
  "source": "...",
  "rates": {
    "USD": 18.45,
    "EUR": 19.82,
    "GBP": 23.10
  }
}
```

`rates` maps currency codes to their value in the base currency (ZAR). Rates are pre-fetched and cached — this endpoint reads the cache, it does not trigger a live fetch.

Error (400): `date must be YYYY-MM-DD`.
Error (500): cache miss or upstream fetch failure.

### Workflow: convert an invoice amount to ZAR

```bash
# 1. Get today's rates
GET /fx/rates
# → { rates: { USD: 18.45, EUR: 19.82 } }

# 2. Multiply invoice.total by rates[invoice.currency]
# e.g. USD 1000 * 18.45 = ZAR 18,450
```
