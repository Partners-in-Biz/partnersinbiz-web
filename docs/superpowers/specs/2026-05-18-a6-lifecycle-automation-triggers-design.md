# A6 Design — Lifecycle Automation Triggers

**Date:** 2026-05-18  
**Status:** Approved  
**Tag target:** `crm-sub-a6-complete`

---

## Overview

A rule-based automation engine that fires actions when CRM events occur. Rules support both immediate and time-delayed execution. Delayed actions are queued in Firestore and processed by a cron job every 5 minutes.

---

## Data Model

### `lib/automations/types.ts`

```ts
export type TriggerEvent =
  | 'deal.created'
  | 'deal.stage_changed'
  | 'deal.won'
  | 'deal.lost'
  | 'contact.created'
  | 'contact.lifecycle_changed'

export interface AutomationTrigger {
  event: TriggerEvent
  toStageId?: string    // filter: only fire when moving TO this stage (deal.stage_changed)
  pipelineId?: string   // filter: only fire for this pipeline
}

export type ActionType =
  | 'send_email'
  | 'send_notification'
  | 'assign_owner'
  | 'dispatch_webhook'

export interface AutomationAction {
  type: ActionType
  // send_email
  emailSubject?: string
  emailBody?: string       // HTML
  emailTo?: 'contact' | 'owner' | string
  // send_notification
  notificationMessage?: string
  notificationTo?: 'owner' | 'all_admins'
  // assign_owner
  ownerUid?: string
  ownerDisplayName?: string
  // dispatch_webhook
  webhookUrl?: string
}

export interface AutomationRule {
  id: string
  orgId: string
  name: string
  enabled: boolean
  trigger: AutomationTrigger
  actions: AutomationAction[]
  delayMinutes?: number    // 0 or absent = immediate
  deleted?: boolean
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  createdByRef?: MemberRef
  updatedByRef?: MemberRef
}

export type AutomationRuleInput = Omit<AutomationRule, 'id' | 'createdAt' | 'updatedAt'>

export interface PendingAutomation {
  id: string
  orgId: string
  ruleId: string
  triggerEvent: TriggerEvent
  actions: AutomationAction[]
  contextDealId?: string
  contextContactId?: string
  contextContactEmail?: string
  contextOwnerEmail?: string
  scheduledAt: Timestamp
  status: 'pending' | 'executed' | 'failed'
  executedAt?: Timestamp | null
  error?: string
  createdAt: Timestamp | null
}

export interface TriggerContext {
  dealId?: string
  contactId?: string
  contactEmail?: string
  ownerEmail?: string
  orgId: string
}
```

**Firestore collections:**
- `automation_rules/{ruleId}` — rule definitions (top-level with orgId)
- `pending_automations/{id}` — queued delayed actions (top-level with orgId)

---

## Core Library

### `lib/automations/store.ts`

Rule CRUD helpers:
- `listRules(orgId): Promise<AutomationRule[]>` — active (not deleted), any enabled state
- `getRule(orgId, ruleId): Promise<AutomationRule | null>`
- `createRule(orgId, input, actor): Promise<AutomationRule>`
- `updateRule(orgId, ruleId, patch, actor): Promise<AutomationRule>`
- `deleteRule(orgId, ruleId, actor): Promise<void>` — soft-delete
- `getMatchingRules(orgId, event, context): Promise<AutomationRule[]>` — query enabled rules for this event + optional stage/pipeline filters
- `queuePendingAutomation(orgId, rule, context): Promise<void>` — writes PendingAutomation doc
- `getPendingDue(limit?: number): Promise<PendingAutomation[]>` — query cross-org where `scheduledAt <= now` and `status === 'pending'`
- `markExecuted(id): Promise<void>`
- `markFailed(id, error): Promise<void>`

### `lib/automations/executor.ts`

```ts
export async function executeActions(
  actions: AutomationAction[],
  context: TriggerContext
): Promise<{ succeeded: number; failed: number; errors: string[] }>
```

Action dispatch:
- `send_email` → `sendEmail({ to, subject, html })` from `lib/email/send.ts`; resolves `emailTo: 'contact'` from `context.contactEmail`, `emailTo: 'owner'` from `context.ownerEmail`
- `send_notification` → `lib/notifications/notify.ts`; for `'all_admins'` query org members with role admin
- `assign_owner` → `adminDb.collection('deals' | 'contacts').doc(id).update({ ownerUid, ownerRef })`
- `dispatch_webhook` → `fetch(webhookUrl, { method: 'POST', body: JSON.stringify(context) })`

Each action is wrapped in try/catch — one failed action doesn't block others.

### `lib/automations/trigger.ts`

```ts
export async function fireTrigger(
  orgId: string,
  event: TriggerEvent,
  context: TriggerContext
): Promise<void>
```

Logic:
1. `getMatchingRules(orgId, event, context)`
2. For each matching rule:
   - If `!rule.delayMinutes || rule.delayMinutes === 0`: call `executeActions(rule.actions, context)` immediately
   - Else: `queuePendingAutomation(orgId, rule, context)` (writes `pending_automations` doc with `scheduledAt = now + delayMinutes`)
3. Wrap entire function in try/catch — automation failures must NEVER break the primary CRM write

---

## API Surface

### Automation rules CRUD

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/v1/crm/automations` | member | List org rules |
| POST | `/api/v1/crm/automations` | admin | Create rule |
| PUT | `/api/v1/crm/automations/[id]` | admin | Update rule |
| DELETE | `/api/v1/crm/automations/[id]` | admin | Soft-delete |

NEVER_FROM_BODY: `id`, `orgId`, `createdAt`, `updatedAt`, `createdByRef`, `updatedByRef`

### Cron endpoint

`GET /api/v1/crm/cron/process-automations` — Bearer CRON_SECRET auth  
- Fetches up to 100 pending automations where `scheduledAt ≤ now` and `status === 'pending'`
- Executes each via `executeActions()`
- Marks executed/failed
- 55s time budget (same pattern as recompute-scores)
- Added to `vercel.json` crons: `{ "path": "/api/v1/crm/cron/process-automations", "schedule": "*/5 * * * *" }`

### Trigger wiring

After successful writes in:
- `deals/[id]/route.ts` PUT — fire `deal.stage_changed` (+ `deal.won`/`deal.lost` based on stage kind)
- `deals/route.ts` POST — fire `deal.created`
- `contacts/route.ts` POST — fire `contact.created`
- `contacts/[id]/route.ts` PUT — fire `contact.lifecycle_changed` when `type` field changes

All wrapped in `try { await fireTrigger(...) } catch { /* log, don't throw */ }`

---

## UI

### `/portal/settings/automations` (list page)

- Table: Name | Trigger | Delay | Actions | Status | Edit | Delete
- Inline enabled toggle (PATCH to PUT endpoint)
- "+ New automation" button → rule editor page
- Empty state: "No automation rules yet."

### `/portal/settings/automations/new` and `/portal/settings/automations/[id]/edit` (rule editor)

Form fields:
- **Name** (text, required)
- **Trigger** (select: deal.created / deal.stage_changed / deal.won / deal.lost / contact.created / contact.lifecycle_changed)
- **Stage filter** (appears for `deal.stage_changed`) — pipeline + stage selectors
- **Delay** — radio: "Immediately" | "After delay" + number input (value) + unit selector (minutes / hours / days)
- **Actions** — dynamic list; "+ Add action" appends a row:
  - Action type selector
  - Relevant fields per type (email: subject + body textarea + to; notification: message + to; assign: owner picker; webhook: URL)
- **Enabled** toggle
- Save / Cancel

Settings nav: add `{ href: '/portal/settings/automations', label: 'Automations', icon: 'bolt', minRole: 'admin' }` after Products.

---

## Firestore Indexes

```json
{ "collectionGroup": "automation_rules", "fields": [
    { "fieldPath": "orgId", "order": "ASCENDING" },
    { "fieldPath": "deleted", "order": "ASCENDING" },
    { "fieldPath": "enabled", "order": "ASCENDING" },
    { "fieldPath": "trigger.event", "order": "ASCENDING" }
  ]
},
{ "collectionGroup": "pending_automations", "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "scheduledAt", "order": "ASCENDING" }
  ]
}
```

---

## Build Plan — 3 Waves

### Wave 1 — Foundation (3 parallel agents)

**1A**: Types + store + executor + trigger function + indexes  
**1B**: Automations CRUD API + tests (~25 tests)  
**1C**: Cron process-automations endpoint + trigger wiring in deal/contact routes + tests (~25 tests)

### Wave 2 — UI (2 parallel agents)

**2A**: Automations list page + settings nav link  
**2B**: Rule editor (new + edit) with all form fields

### Wave 3 — Integration (sequential)

- `vercel.json` cron entry
- SKILL.md + hot.md + tag `crm-sub-a6-complete`

---

## Quality Bar

- `fireTrigger` failures MUST NOT throw to caller — always try/catch
- Executor actions are individually try/caught — one failure doesn't abort others
- NEVER_FROM_BODY denylist on all routes
- `withCrmAuth(minRole)` on all routes
- MemberRef attribution on all rule writes
- `next build` clean before tagging
