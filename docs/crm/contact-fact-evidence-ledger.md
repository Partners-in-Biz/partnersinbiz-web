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
- Optional research queue supports `schedule_recheck` with rep-visible reasons + budget.

## Collections

| Collection | Purpose |
|---|---|
| `contact_facts` | Field-level fact ledger |
| `crm_research_tasks` | Resident research / recheck queue |

## Contact fields (additive)

- `humanOwnedFields?: string[]` — contact columns a human typed
- `linkedinUrl`, `twitterUrl`, `githubUrl` — optional identity URLs for fact apply

## API

All routes: `withCrmAuth('member')`, org-scoped, assignment-access aware.

### Facts

```
GET  /api/v1/crm/contacts/:id/facts?status=PROPOSED&field=title&includePossible=false
POST /api/v1/crm/contacts/:id/facts
POST /api/v1/crm/contacts/:id/facts/:factId/decide   { "decision": "accept"|"dismiss" }
POST /api/v1/crm/contacts/:id/facts/from-mailbox
POST /api/v1/crm/contacts/:id/facts/job-change
GET  /api/v1/crm/contacts/:id/graph?includeResearchTasks=true
```

### Research queue

```
GET  /api/v1/crm/research-tasks?contactId=&status=pending&due=true
POST /api/v1/crm/research-tasks
  { "contactId", "reason": "Rep-visible why", "kind"?, "delaySeconds"?, "budgetUnits"? }
```

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

Portal contact detail (`/portal/contacts/[id]`): **Agent proposals** panel
(`ContactFactProposalsPanel`) — accept/dismiss with evidence and band chips.

## Hermes agent usage

1. Prefer `GET .../graph` before acting — neighbour IDs are already there.
2. Record facts with observation kinds only.
3. For mailbox identity: `POST .../facts/from-mailbox` with `bodyText` (or `dryRun: true`).
4. For uncertain future work: `POST /crm/research-tasks` with a clear `reason`.
5. Job changes: `POST .../facts/job-change` (employer fact-only + optional title + recheck).

## Hard rules (code)

1. No model confidence on tools.
2. Never re-propose dismissed field+value.
3. Never auto-apply over `humanOwnedFields`.
4. VERIFIED requires a primary evidence source.
5. Contradictions hold (score capped); no auto-apply path via VERIFIED.
6. Multi-tenant: every read/write checks `orgId` (+ assignment access).

## Tests

```
npx jest __tests__/lib/crm/facts-evidence-ledger.test.ts --no-coverage
```

## Out of scope / follow-ups

- Background worker that leases `crm_research_tasks` and runs Hermes enrichment loops
- Auto-ingest of connected Gmail into from-mailbox on inbound webhooks
- Admin contact detail parity panel (portal shipped first)
- Firestore composite indexes if list filters grow beyond current in-memory patterns
