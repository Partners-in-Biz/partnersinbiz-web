# CRM ContactFact Evidence Ledger

Comp AI–inspired multi-tenant evidence ledger for Partners in Biz CRM.
Shipped on `development` as implementation of research `lZLfr9HK6Izd4RTatIwq`.

## Goals

- Agents report **observations** (evidence kinds), never model confidence.
- Code prices evidence → VERIFIED / PROBABLE / POSSIBLE.
- VERIFIED + primary source may auto-apply (unless human-owned).
- PROBABLE becomes a human proposal (accept/dismiss).
- Dismissed field+value pairs are never re-proposed.
- Human-edited identity fields become `humanOwnedFields` and block agent overwrite.
- Mailbox signatures/replies feed proposals via local heuristics (no third-party egress of body text).
- Graph endpoint always returns neighbour IDs.
- Research queue supports `schedule_recheck` with rep-visible reasons + budget.
- Multi-machine worker loop leases due work, applies payload-backed enrichment, and completes tasks.

## Collections

| Collection | Purpose |
|---|---|
| `contact_facts` | Field-level fact ledger |
| `crm_research_tasks` | Resident research / recheck queue |

## Contact fields (additive)

- `humanOwnedFields?: string[]` — contact columns a human typed
- `linkedinUrl`, `twitterUrl`, `githubUrl` — optional identity URLs for fact apply

## API

All routes: `withCrmAuth('member')`, org-scoped, assignment-access aware (except cron).

### Facts

```
GET  /api/v1/crm/contacts/:id/facts?status=PROPOSED&field=title&includePossible=false
POST /api/v1/crm/contacts/:id/facts
POST /api/v1/crm/contacts/:id/facts/:factId/decide   { "decision": "accept"|"dismiss" }
POST /api/v1/crm/contacts/:id/facts/from-mailbox
POST /api/v1/crm/contacts/:id/facts/job-change
GET  /api/v1/crm/contacts/:id/graph?includeResearchTasks=true
GET  /api/v1/crm/companies/:id/graph
GET  /api/v1/crm/deals/:id/graph
```

### Research queue + worker

```
GET  /api/v1/crm/research-tasks?contactId=&status=pending&due=true
POST /api/v1/crm/research-tasks
  { "contactId", "reason": "Rep-visible why", "kind"?, "delaySeconds"?, "budgetUnits"?, "metadata"? }
POST /api/v1/crm/research-tasks/lease
  { "workerId"?, "leaseSeconds"? }  // multi-worker safe lease of next due pending task
POST /api/v1/crm/research-tasks/claim
  // alias of lease (Comp-style naming)
POST /api/v1/crm/research-tasks/work
  { "workerId"?, "leaseSeconds"? }  // org-scoped Hermes: lease next + process payload
POST /api/v1/crm/research-tasks/:id/complete
  { "resultSummary"?, "budgetSpentDelta"?, "failed"?, "error"? }
GET  /api/v1/crm/cron/process-research-tasks
  // Bearer CRON_SECRET — global multi-tenant batch (Firebase scheduledCron every 5 min)
```

### Worker payload contract (`metadata` on research tasks)

Auto-enrichment is **payload-backed only** (no invented external enrichment):

- `bodyText` / `mailboxBodyText` — local signature/reply parse via `applyMailboxFactsToContact`
- `observations` / `evidenceEntries` / `facts` — array of `{ field, value, evidence[] }`
- Optional: `fromName`, `fromEmail`, `direction`, `sourceUrl`

### POST fact body (no confidence)

```json
{
  "field": "title",
  "value": "Head of Growth",
  "method": "agent.research_person",
  "evidence": [
    { "kind": "crm.signature-block", "detail": "Signature line: Head of Growth", "sourceUrl": "https://..." }
  ]
}
```

Rejected if body includes `confidence`, `score`, or `band`.

### Evidence kinds

See `lib/crm/facts/evidence.ts` `WEIGHTS`. Primaries include signature, thread-reply, LinkedIn employer+name, email-match, meeting attendance, GitHub identity.

### Fact fields → contact columns

| Fact field | Contact column |
|---|---|
| name | name |
| title | jobTitle |
| department | department |
| phone | phone |
| linkedinUrl | linkedinUrl |
| website | website |
| twitterUrl | twitterUrl |
| githubUrl | githubUrl |
| employer, seniority, function, location, tenure | fact-only (no silent companyId rewrite) |

## UI

- Portal contact detail (`/portal/contacts/[id]`): **Agent proposals** + **Research queue** panels
- Admin selected-org contact (`/admin/org/[slug]/crm/contacts/[id]`): same proposals + research panels
- Company command center contact rows deep-link to admin contact detail

## Mailbox coverage

| Path | Behaviour |
|---|---|
| `POST .../facts/from-mailbox` | Explicit API (supports `dryRun`) |
| CRM Gmail integration inbound | Full body fetch → local signature facts |
| Agent mailbox Gmail sync (new inbound) | Match From email → local signature facts |
| Research worker task metadata body | Same local parse when task runs |

## Hermes agent usage

1. Prefer `GET .../graph` before acting — neighbour IDs are already there.
2. Record facts with observation kinds only.
3. For mailbox identity: `POST .../facts/from-mailbox` with `bodyText` (or `dryRun: true`).
4. For uncertain future work: `POST /crm/research-tasks` with a clear `reason` and optional observation payload in `metadata`.
5. Org workers: `POST /crm/research-tasks/work` (lease+process) or lease → act → complete.
6. Job changes: `POST .../facts/job-change` (employer fact-only + optional title + recheck).

## Hard rules (code)

1. No model confidence on tools.
2. Never re-propose dismissed field+value.
3. Never auto-apply over `humanOwnedFields`.
4. VERIFIED requires a primary evidence source.
5. Contradictions hold (score capped); no auto-apply path via VERIFIED.
6. Multi-tenant: every read/write checks `orgId` (+ assignment access).
7. Cron is CRON_SECRET only; workers never invent external facts without payload evidence.

## Tests

```
npx jest \
  __tests__/lib/crm/facts-evidence-ledger.test.ts \
  __tests__/api/v1/crm/contacts/facts.test.ts \
  __tests__/lib/crm/research-worker.test.ts \
  __tests__/api/v1/crm/cron/process-research-tasks.test.ts \
  __tests__/lib/mailbox/applyInboundContactFacts.test.ts \
  __tests__/api/integrations-gmail.test.ts \
  --no-coverage
```

## Multi-machine / multi-worker notes

- Research lease walks due **pending** tasks and **expired leases**, then claims via Firestore transaction.
- Global cron (`runCrmResearchQueue` / `process-research-tasks`) walks cross-tenant candidates the same way.
- Contention on one task continues to the next candidate (no single-point stall).
- `POST /crm/research-tasks/claim` is an alias of `/lease` for Comp-style naming.
- Workers should pass stable `workerId` (agent id or hostname+pid).
- Gmail paths fetch full message bodies and run **local** signature → fact proposals (no third-party body egress).

## Ops follow-ups (not product gaps)

- Confirm Firestore composite indexes for `contact_facts` / `crm_research_tasks` are live: `firebase deploy --only firestore:indexes` (definitions already in `firestore.indexes.json`).
- Production promote remains explicit (development only until release approval).
- SMTP/IMAP inbound auto-facts: only Gmail full-body import paths today; other providers use `from-mailbox` API or research-task metadata body.
