# C-phase Design — Automation & Intelligence (C1–C6)

**Date:** 2026-05-18  
**Status:** Approved  
**Tag target:** `crm-sub-c-complete`

---

## Overview

Activates the dormant sequences infrastructure, adds AI intelligence to the contact workflow, builds duplicate detection/merge, and wires sequence enrollment into the automation rules engine.

`lib/sequences/types.ts` already has complete types for Sequence, SequenceEnrollment, SequenceStep, branching, wait conditions, and goals. No type changes needed — only store + API + UI + cron.

---

## C1 — Email Sequence API + Management UI

### Store: `lib/sequences/store.ts`

```ts
listSequences(orgId): Promise<Sequence[]>
getSequence(orgId, sequenceId): Promise<Sequence | null>
createSequence(orgId, input: SequenceInput, actor): Promise<Sequence>
updateSequence(orgId, sequenceId, patch, actor): Promise<Sequence>
deleteSequence(orgId, sequenceId, actor): Promise<void>   // soft-delete
```

Firestore collection: `sequences` (top-level, orgId field).

### API routes

| Method | Route | Auth |
|--------|-------|------|
| GET | `/api/v1/crm/sequences` | member |
| POST | `/api/v1/crm/sequences` | admin |
| PUT | `/api/v1/crm/sequences/[id]` | admin |
| DELETE | `/api/v1/crm/sequences/[id]` | admin |

NEVER_FROM_BODY: `id`, `orgId`, `createdAt`, `updatedAt`, `createdByRef`, `updatedByRef`.

### Management UI: `/portal/settings/sequences`

- List: name, status badge (draft/active/paused), step count, enrolled count
- "+ New sequence" → sequence editor
- Edit / Delete / Toggle status (active ↔ paused)

### Sequence editor: `/portal/settings/sequences/new` + `/[id]/edit`

Form:
- Name, description
- Status selector (draft / active / paused)
- Steps list — each step: stepNumber (auto), delayDays, subject, bodyHtml (textarea), channel (email/sms)
- "+ Add step" appends a new step
- Drag to reorder (or up/down buttons)

---

## C2 — Enrollment API + Contact Enrollment Panel

### Store: `lib/sequences/enrollment.ts`

```ts
listEnrollments(orgId, opts?: { sequenceId?, contactId?, status? }): Promise<SequenceEnrollment[]>
getEnrollment(orgId, enrollmentId): Promise<SequenceEnrollment | null>
enrollContact(orgId, sequenceId, contactId, actor): Promise<SequenceEnrollment>
  // creates enrollment: status=active, currentStep=0, nextSendAt=now+step[0].delayDays
unenrollContact(orgId, enrollmentId, actor): Promise<void>
  // sets status=exited, exitReason=manual
```

Firestore collection: `sequence_enrollments` (top-level, orgId + sequenceId + contactId fields).

### Enrollment API routes

| Method | Route | Auth |
|--------|-------|------|
| GET | `/api/v1/crm/sequences/[id]/enrollments` | member |
| POST | `/api/v1/crm/sequences/[id]/enrollments` | member |
| DELETE | `/api/v1/crm/sequences/[id]/enrollments/[enrollmentId]` | member |
| GET | `/api/v1/crm/contacts/[id]/enrollments` | member |

### Sequence processing cron

`GET /api/v1/crm/cron/process-sequences` — Bearer CRON_SECRET, runs every 5 minutes.

Query `sequence_enrollments` where `status=active` and `nextSendAt <= now`, limit 100.

For each enrollment:
1. Load the sequence + contact
2. Fetch the current step (`sequence.steps[enrollment.currentStep]`)
3. Send email via `sendEmail({ to: contact.email, subject, html: step.bodyHtml })`
4. Advance: if more steps remain, set `nextSendAt = now + nextStep.delayDays * 86400000` and increment `currentStep`
5. If no more steps: set `status = completed`, `exitReason = completed`
6. Wrap per-enrollment in try/catch — failure marks that enrollment as `failed` (add `failed` to ExitReason or use a separate error field) without blocking others

Add to `vercel.json` crons.

### Contact enrollment panel (on contact detail page)

Below the activity timeline on `/portal/contacts/[id]`:
- List active enrollments: sequence name, current step N/total, next send date
- "+ Enroll in sequence" button → modal with sequence picker (fetch active sequences)
- Unenroll button per enrollment

---

## C3 — AI Email Composer

### API: `POST /api/v1/crm/ai/compose-email`

Body: `{ contactId: string, purpose: string, tone?: string }`

Implementation:
1. Fetch contact from Firestore (name, email, company, stage, leadScore, last activity)
2. Call `generateText` from `ai` package (same pattern as `lib/ai/email-generators.ts`)
   - Model: `BRIEF_MODEL` from `@/lib/ai/client`
   - Prompt: "You are a CRM email assistant. Write a short, personalised sales email for: Contact: {name}, Company: {company}, Stage: {stage}, Lead score: {leadScore}. Purpose: {purpose}. Tone: {tone}. Return JSON: { subject, bodyText }."
3. Parse response, return `{ subject, bodyText }`
4. Wrap in try/catch, return 500 on AI failure with a helpful error message
5. Auth: `withCrmAuth('member')`

### UI: AI composer on contact detail

Above the log-activity bar on `/portal/contacts/[id]`:
```
[✨ AI draft email]
```

Clicking opens a small form:
- "Purpose" text input (e.g. "Follow up after demo")
- "Tone" select: professional / friendly / bold
- [Generate] button → calls compose-email API → shows generated subject + body in a preview card
- [Copy to clipboard] or [Use in email] buttons

---

## C4 — Duplicate Detection + Merge

### API: `GET /api/v1/crm/contacts/duplicates`

Auth: `withCrmAuth('admin')`. No body.

Implementation:
1. Fetch all non-deleted contacts for org (limit 2000)
2. Group by exact `email` match → any email match = definite duplicate group
3. Among contacts with no email matches, fuzzy-group by normalized name (`name.toLowerCase().trim()`) + same company
4. Return groups where count ≥ 2: `{ groups: [{ contacts: Contact[], reason: 'email' | 'name' }] }`

### API: `POST /api/v1/crm/contacts/merge`

Body: `{ winnerId: string, loserId: string }`

Implementation:
1. Fetch both contacts, verify same orgId
2. Winner keeps all its own fields; loser's non-null fields fill any nulls on winner (backfill)
3. Winner's tags = union of both tag arrays
4. Update all deals + activities referencing loserId to reference winnerId
5. Soft-delete loser (set `deleted: true, mergedIntoId: winnerId`)
6. Return `{ winner: Contact }`

### UI: Duplicates on contacts list

- "Find duplicates" button (top of contacts page, near bulk actions)
- Opens a modal listing duplicate groups: each group shows contacts side by side
- "Merge" button per group → pick winner (radio) + confirm → POST merge → reload

---

## C5 — Smart Next-Action Suggestions

### API: `GET /api/v1/crm/contacts/[id]/suggestions`

Auth: `withCrmAuth('member')`.

Implementation:
1. Fetch contact + last 5 activities + lead/ICP scores
2. Generate suggestions with simple rule engine (no LLM needed for V1):
   - No activity in 7+ days + stage=contacted → suggest "Follow up"
   - leadScore < 30 → suggest "Qualify or archive"
   - stage=proposal + no activity in 3 days → suggest "Chase proposal"
   - leadScore > 70 + stage=replied → suggest "Move to demo"
   - stage=demo + probability > 60 → suggest "Send proposal"
3. Return `{ suggestions: [{ action: string, reason: string, urgency: 'high'|'medium'|'low' }] }`

### UI: Suggestions chip on contact detail

Small card at the top of contact detail (below header, above panels):
- "💡 Suggested actions" collapsible section
- Each suggestion: action text + reason + urgency badge
- Clicking an action logs it (e.g. "Follow up" → opens log-activity form pre-filled)

---

## C6 — Sequence Enrollment Automation Action

Extend `AutomationAction` in `lib/automations/types.ts`:
```ts
// Add to ActionType union:
| 'enroll_in_sequence'

// Add to AutomationAction interface:
sequenceId?: string
sequenceName?: string   // display only
```

Extend `lib/automations/executor.ts` `executeActions` to handle `enroll_in_sequence`:
- Call `enrollContact(orgId, action.sequenceId, context.contactId, SYSTEM_ACTOR)`
- Skip if `contactId` not in context

Extend `AutomationRuleForm` in the UI: when action type = `enroll_in_sequence`, show a sequence picker (fetch `GET /api/v1/crm/sequences` and render a select).

---

## Firestore Indexes

```json
{ "collectionGroup": "sequences", "fields": [
    { "fieldPath": "orgId", "order": "ASCENDING" },
    { "fieldPath": "deleted", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" }
  ]
},
{ "collectionGroup": "sequence_enrollments", "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "nextSendAt", "order": "ASCENDING" }
  ]
},
{ "collectionGroup": "sequence_enrollments", "fields": [
    { "fieldPath": "orgId", "order": "ASCENDING" },
    { "fieldPath": "contactId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" }
  ]
}
```

---

## Build Plan — 3 Waves

### Wave 1 — Foundation (3 parallel agents)

**1A**: `lib/sequences/store.ts` + `lib/sequences/enrollment.ts` + Firestore indexes + store tests (~16 tests)

**1B**: Sequences CRUD API + enrollment API routes + tests (~25 tests)

**1C**: 
- Sequence processing cron (`/api/v1/crm/cron/process-sequences`) + tests (~10 tests)
- AI compose API (`/api/v1/crm/ai/compose-email`) + tests (~6 tests)
- Duplicate detection API (`/api/v1/crm/contacts/duplicates`) + merge API + tests (~10 tests)
- Contact suggestions API (`/api/v1/crm/contacts/[id]/suggestions`) + tests (~6 tests)

### Wave 2 — UI (3 parallel agents)

**2A**: Sequences management pages (`/portal/settings/sequences/` list + editor)

**2B**: Contact detail additions — enrollment panel + AI composer + suggestions chip

**2C**: Duplicates UI (contacts page button + modal + merge flow)

### Wave 3 — Integration (sequential)

- C6: `enroll_in_sequence` action type in automations
- `vercel.json` cron entry for process-sequences
- SKILL.md + hot.md + tag `crm-sub-c-complete`
