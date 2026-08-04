# Finance operator runbooks — Phase 6 world-class market proof + product depth

**Status:** internal operator + external-accountant guide (development/staging first)  
**Date:** 2026-08-03  
**Project:** `HRCSWl1cNnh6fYEGziAb`  
**Canonical product spec:** `Flie3SblIDXvplYmqOhy`  
**Docs task:** `upcYUjl6v1R44SC7kd3Z`  
**Scope approval gate:** `eqZUnsjDmKnE5tsnNXxX` (development only — not production promote)  
**Org scope:** always send `X-Org-Id` and use `scopedPortalPath` / `scopedApiPath`  
**Portal map:** `/portal/finance/runbooks` · Period close: `/portal/finance/period-close` · Proving: `/portal/finance/proving` · Bank feeds: `/portal/finance/bank-feeds`  
**Extends:** [Phase 5 close runbooks](./operator-runbooks-phase5-close-2026-08-03.md) · [Phase 4 operator runbooks](./operator-runbooks-phase4-2026-08-02.md)

## Purpose

Phase 5 made month-end **possible** with a proving kit, period-close centre, mock bank-feed framework, role hubs, and bureau payroll. Phase 6 makes finance **defensible as world-class** for a real SA bookkeeper week and an external accountant sitting:

1. Multi-month live-style close program (≥3 periods, ≥2 entities) with market-proof evidence  
2. Bank feeds as the **daily** recon product path (not only a connector framework)  
3. Expense claims, revenue recognition lite, practice firm→client grants, ESS (payslips + leave), cash scenarios, job-cost closed loop  
4. External accountant sign-off pack walkthrough (checklist artifact, download-only)  
5. Hard gates restated for every surface  
6. Inputs for Quinn’s Phase 6 acceptance pack  

This page set is **not** a permanent CEO dashboard. Decision answers stay in Messages; runbooks are operator procedures. Temporary proving fixtures remain throw-away proof paths.

## What shipped before Phase 6 (do not re-teach from zero)

Use Phase 5 runbooks for single-period close, mock feed basics, IC consolidation checklist, payroll bureau month-end, and import incident rollback. Phase 6 **adds program depth and daily product paths** on top of those surfaces.

| Baseline | Portal |
| --- | --- |
| Role hub + guided workflows | `/portal/finance` |
| Period-close blockers | `/portal/finance/period-close` |
| Mock bank feeds + statements/rules | `/portal/finance/bank-feeds`, statements, bank-rules |
| Multi-entity IC + consol | `/portal/finance/intercompany` |
| Payroll bureau + statutory prepare | `/portal/finance/payroll` |
| Packaging + proving kit | `/portal/finance/packaging`, proving |
| Job costing foundation | `/portal/finance/job-costing` |
| Practice membership switcher | `/portal/finance/practice` |

---

## Hard gates (always on — restated for Phase 6)

| Gate | Operator meaning | Surfaces |
| --- | --- | --- |
| No SARS e-file submit | Tax/payroll/packaging prepare + download only | Tax, Payroll, Packaging, Proving, ESS |
| No external payment initiate | Record/observe/allocate/export instructions only | Documents, Expense claims, Statements, Bank feeds, Bank rules, Payroll, Packaging |
| Bank feed / rules never auto-post | Sync stages lines; suggestions need Accept/Dismiss (bulk only when safe filters pass) | Bank feeds, Statements, Bank rules |
| Recon never silent-posts journals | Accept is an explicit command with audit | Statements, recon centre |
| OCR / AI assist never auto-applies | Human confirm into claim lines only | Expense claims |
| Rev-rec runs post only via explicit period run | No silent schedule drift posts | Revenue recognition |
| Cash scenarios planning-only | No GL post, no bank movement from planner | Budgets / cash scenarios |
| Practice grants least privilege | Grant prepare/review/export — not silent full owner | Practice grants |
| ESS least privilege | Employee sees own payslips/leave only | ESS / PWA |
| Mass email separately gated | Payslip packs and statements are download/export | Payroll, Documents, Packaging, ESS |
| Paid bank-feed / open-banking vendor | Separate Peet commercial gate (`a1NFXI8IbZFsv68rBCIl`); mock default | Bank feeds adapter stub |
| Tenant isolation | Wrong org cannot read/write another book | Every command/query |
| Production promote is a Peet gate | Ordinary cards stay on `development` (`oITb4OznO8sTtoTmQwxH`) | Kanban / release |

Every close-critical response and packaging dry-run must still carry (or imply via verify scripts):

- `externalPaymentInitiated: false`  
- `sarsSubmissionInitiated: false`  
- `externalEgressAllowed: false`  
- bank apply human-gated (`never auto-post`)

---

## Runbook P6-A — Multi-month close program how-to

**Goal:** Prove books can be closed for **≥3 accounting periods** across **≥2 legal entities** with IC, payroll lock, bank recon history, packaging exports, and frozen TB evidence — not only a single synthetic period fixture.

**Board owner task:** `O2hbOSJb4gydptVGEOG2`  
**Builds on:** Phase 5 proving kit (`QkRVcgafdbuklU2hQyPs`) + period-close (`T5BOeWaQR0XGpb39VfuY`)

### A0. Choose the proof environment

| Option | When to use | Notes |
| --- | --- | --- |
| Proving kit multi-period fixture | Fast staging demos, Quinn regression | `/portal/finance/proving` · `proving.seed` + `proving.close_fixture.run` |
| Dedicated internal demo org | Market-proof narrative for external accountant | Admin/dev seed only; deterministic reset script; never production client org |
| Tenant under test | Real internal PiB books only with Peet OK | Same hard gates; no client-visible mass send |

Prefer proving or internal demo for acceptance. Do not run multi-month proof against a live client tenant without explicit Peet instruction.

### A1. Program entry criteria

1. Org has ≥2 legal entities + books (ops + holding/service style) and a consolidation book when IC is in scope.  
2. COA + open periods exist for the three consecutive months under test (example: `2026-04`, `2026-05`, `2026-06`).  
3. Roles assigned: bookkeeper, accountant/finance_approver, payroll_approver distinct from clerk (SOD).  
4. Practice switcher or Phase 6 grant path ready if multi-client handoff is part of the demo.  
5. Bank path ready: feed connection **or** statement import fallback.  
6. Hard gates confirmed verbally with anyone joining the sitting.

### A2. Per-period close loop (repeat for each month M1 → M3)

For **each** legal entity book:

| Step | Action | Portal / API |
| --- | --- | --- |
| 1 | Confirm entity + book on scope bar | FinanceScopeBar |
| 2 | Bookkeeper capture: invoices, bills, credit notes, expense claims posted, payment allocate | documents · expense-claims |
| 3 | Daily bank path for the month (P6-B) — leave month with zero-diff recon approved | bank-feeds · statements |
| 4 | Rev-rec period run if schedules open (P6-C) | revenue recognition surface |
| 5 | Job-cost WIP/invoice hygiene for open projects (P6-C) | job-costing |
| 6 | FX reval when multi-currency books require it | multi-currency |
| 7 | Depreciation run if assets open | assets |
| 8 | Payroll: calculate → submit → **other user** locks; no open pay runs | payroll |
| 9 | Period-close evaluate → clear blockers | `period-close.evaluate` |
| 10 | Review TB / P&L / BS | reports |
| 11 | Soft-close then hard-close per policy when `readyToClose=true` | foundation period commands |
| 12 | Freeze TB evidence + packaging slice for the period | packaging / proving |

Then multi-entity:

| Step | Action | Portal |
| --- | --- | --- |
| 13 | IC propose/confirm pairs for the period | intercompany |
| 14 | Eliminations **only** on consolidation book | intercompany |
| 15 | Consolidated TB explainable: entities − elims | reports + consol scope |
| 16 | Cross-org notify/confirm only if multi-tenant cash observed | cross-org (observe only) |

### A3. Cross-period continuity checks (program pass bar)

| # | Check | Pass criteria |
| --- | --- | --- |
| 1 | Three periods hard-closed (or soft-closed with documented policy) | Period status continuous; no open gap blockers |
| 2 | Opening balances of M2/M3 = closed TB of prior period | Continuity holds after hard close |
| 3 | Bank recon history retained per period | Unreconciled not silently zeroed |
| 4 | Payroll locks immutable; corrections are new runs | No edit of locked lines |
| 5 | IC elims never mutated entity books | Attribution preserved |
| 6 | Packaging dry-run / downloads succeed with egress false | Hard gates false |
| 7 | Audit explorer shows actors across all three months | Org-scoped CSV exportable |
| 8 | Evidence folder / Kanban artifacts list period ids + SHAs | Quinn can re-run |

### A4. Deterministic seed / reset (admin/dev only)

1. Prefer `proving.seed` with stable `seedKey` (idempotent).  
2. Prefer `proving.close_fixture.run` when the multi-period fixture covers IC + payroll + packaging.  
3. If using a dedicated demo org reset script: document command, orgId, seedKey, and what it deletes/rebuilds; never point at production client data.  
4. After reset, re-run period-close evaluate before claiming green.

### A5. Evidence to attach after the program

- Period ids + statuses for each entity/book  
- Screenshots or command logs: period-close blockers → 0  
- Packaging manifest paths / dry-run JSON with hard-gate flags  
- External accountant checklist completion (P6-D)  
- Git commit SHAs for any seed/program tooling  
- Confirm: no SARS submit, no payment initiate, no mass email

**Done when:** ≥3 periods closed across ≥2 entities with IC + payroll + bank recon + packaging evidence, and external accountant checklist can be walked in one sitting.

HTTP: operator-depth, foundation, bank-feeds, statements, payroll, intercompany, packaging, proving, reports, documents, expense-claims, rev-rec, job-costing as implemented on branch.

---

## Runbook P6-B — Bank feed daily recon product path

**Goal:** Make bank feeds the path operators prefer every morning — connection health, multi-account status, recon centre aging, safe bulk human gates — with file import as fallback. Still **never** auto-post and **never** pay out.

**Board owner tasks:** productization `6b2T04ZyWNXYn7yB9UAd` · adapter stub `vaNKABngcZf4TqYPpVcV` · optional paid vendor later `a1NFXI8IbZFsv68rBCIl`

### B1. Morning operator loop (preferred)

| Step | Action | Portal / notes |
| --- | --- | --- |
| 1 | Open `/portal/finance/bank-feeds` with correct org/entity/book | Scope bar first |
| 2 | Read connection health: connected / syncing / error / stale / draft / disconnected | Stale threshold: 48h without successful sync |
| 3 | Multi-account list: per-account last sync, cursor/status, last error | Fix account errors before Accept |
| 4 | **Sync now** (or scheduled sync job when enabled) | `bank_feed.sync` — stages lines only |
| 5 | Review recon centre: unreconciled aging buckets `0-7` / `8-30` / `31-60` / `61+` | Productization aging helpers |
| 6 | Review suggestions: match / transfer / etc. | `flag_review` never bulk-accepted |
| 7 | Accept/Dismiss single items **or** safe bulk accept/dismiss | Bulk accept only confidence ≥ 0.8, not `flag_review`, reason not SARS/PAYE/payment-initiation |
| 8 | Finish zero-difference statement recon approval (SOD) | `/portal/finance/statements` |
| 9 | Confirm period-close `unreconciled_bank` clears for the period | period-close |

Commands (Phase 5 + Phase 6 productization):  
`bank_feed.connection.configure` · `bank_feed.sync` · `bank_feed.suggestion.accept` · `bank_feed.suggestion.dismiss` · bulk variants when shipped · health/recon-centre reads · audit read

HTTP: `/api/v1/finance/bank-feeds/commands|queries`

### B2. Safe bulk rules (operators must know)

| Allowed bulk | Forbidden bulk |
| --- | --- |
| Pending suggestions with confidence ≥ 0.8 | `flag_review` kind |
| Ordinary match suggestions with clean reason text | Anything mentioning SARS / PAYE / payment initiation in reason |
| Bulk dismiss of obvious noise after visual scan | Bulk accept when connection health is error/stale without re-sync |

Bulk is still **human-gated** — it is not auto-post. Each accepted suggestion remains an audited Accept event.

### B3. Fallback: file import + bank rules

When no feed connection, or feed is down:

1. Import CSV/OFX/MT940 on `/portal/finance/statements`  
2. Evaluate `/portal/finance/bank-rules` (suggestions only)  
3. Accept/Dismiss with audit  
4. Approve recon only at zero difference  

Do not force operators onto file import when a healthy feed exists — product path is feed-first.

### B4. Real-provider adapter stub (no paid bind)

| Step | Meaning |
| --- | --- |
| Provider registry | Mock is default; non-mock skeleton fails closed without credentials |
| Credential vault stub | Secrets never committed; no live keys in repo |
| Org/feature setting | Provider selection remains mock unless Peet vendor gate opens |
| Network | No paid vendor calls from this stub card |
| Commercial | Paid open-banking / aggregator contract = task `a1NFXI8IbZFsv68rBCIl` only |

### B5. Failure and incident touchpoints

- Sync failed → read audit `sync.failed`; re-sync (idempotent fingerprints)  
- Garbage amounts → dismiss; do not Accept; disconnect until fixed  
- Wrong account linked → reconfigure **before** Accept  
- Bad accept already posted → reverse journals (Phase 5 P5-F); never delete posted history  
- Paid vendor temptation → stay mock; escalate Peet gate  

**Hard gates:** human accept only; never auto-post; noEgress; no payment initiate; no paid vendor without Peet.

---

## Runbook P6-C — Expense claims, rev-rec, practice grants, ESS, cash scenarios, job-cost loop

**Goal:** Day-2 and month-end product depth that closes competitor embarrassment gaps without opening hard gates.

### C1. Expense claims + receipt capture

**Board task:** `SZRWufZ64Qnr3aqF9YyZ`  
**Portal (target):** `/portal/finance/expense-claims` (or finance documents adjacent surface when routed)  
**Domain:** `lib/finance/expense-claims/*`

| Step | Action | Notes |
| --- | --- | --- |
| 1 | Draft claim: payee, claim date, currency, entity/book | Status `draft` |
| 2 | Add VAT-aware lines (net/VAT/gross minor units; tax rate codes) | Optional `projectId` |
| 3 | Attach receipt image/PDF (storage ref — not inline bytes) | |
| 4 | Optional OCR assist → **confirm or dismiss** | `autoApplied: false`, `autoPosted: false` always |
| 5 | Submit for approval | `submitted` |
| 6 | Manager approve/reject (bulk approve where role allows) | SOD vs claimant |
| 7 | Post to books: journal proposal **or** payable | `posted` |
| 8 | Optional payment **instruction** export only | `payment_instruction_exported` — observe/export, never initiate |

**Must not:** initiate bank payout from claim; auto-post OCR; mass email receipts.

Month-end: open submitted/unposted claims are bookkeeper blockers before hard close (treat like unapproved journals if still open).

### C2. Revenue recognition schedules (deferral/accrual lite)

**Board task:** `ng0kop4wEjqP68gt3M5f`  
**Portal (target):** `/portal/finance/revenue-recognition` (or reports-adjacent)  

| Step | Action | Pass |
| --- | --- | --- |
| 1 | Create schedule linked to AR document/contract | Straight-line or milestone lite |
| 2 | Review deferred vs recognized vs billed | Report readable |
| 3 | Run **period recognition** for open period | Posts balanced journals with audit |
| 4 | Reverse/adjust with audited reverse if wrong | No silent rewrite of posted lines |
| 5 | Period-close: no material unrun schedules left undocumented | Accountant sign-off |

**Not in scope:** full ASC-606 engine. Keep SA agency/retainer practical.

### C3. Practice firm → client grant ACL

**Board task:** `OpHGMxtFJ4fLXehncO9t`  
**Portal:** `/portal/finance/practice` (grants section when shipped)

Phase 5 membership switcher remains. Phase 6 adds **grants** so a firm org can access client books without full membership sprawl.

| Grant role | May | Must not |
| --- | --- | --- |
| `prepare` | Capture drafts, import/sync, draft journals, draft claims | Approve pay runs; hard-close alone if policy forbids; export mass email |
| `review` | Period-close evaluate, reports, audit, approve within grant | Escalate beyond grant; change secrets |
| `file-export` | Packaging downloads, statutory prepare packs | SARS submit; payment initiate |

| Step | Action |
| --- | --- |
| 1 | Firm admin creates grant: firm org → client org/entity/book + role |
| 2 | Audit event written (actor, grant id, scope) |
| 3 | Practice queue: clients with close blockers / open periods |
| 4 | Revoke grant → access denied on next command |
| 5 | Security tests: wrong org / revoked grant / least privilege |

### C4. Mobile / PWA ESS (payslips + leave)

**Board task:** `7f4RaCyCoYdWWShb2dxg`  
**Portal (target):** employee ESS / PWA shell under portal design tokens  

| Step | Action | Gates |
| --- | --- | --- |
| 1 | Employee signs in; sees **own** payslip list only | Least privilege |
| 2 | Download single payslip PDF/ZIP item | User-initiated download; no mass email |
| 3 | View leave balances | |
| 4 | Submit leave request → routes to existing leave approval model | |
| 5 | Approver acts in payroll/admin leave calendar | Not on ESS admin controls |

**Must not:** expose admin payroll, other employees’ payslips, SARS, payout, mass email.

### C5. Cash forecast scenarios

**Board task:** `MlELj0UlZw2ChNnBlqpJ`  
**Portal:** `/portal/finance/budgets` (scenarios)  

| Step | Action |
| --- | --- |
| 1 | Create named scenarios: base / downside / upside |
| 2 | Adjust inflows/outflows; snapshot compare |
| 3 | Optionally overlay actuals from reconciled cash accounts (read-only) |
| 4 | Owner/bookkeeper review for cash decisions in Messages if CEO ask |

**Hard gate:** planning-only — no GL post, no bank movement, not a permanent CEO dashboard product.

### C6. Job costing closed loop (quote → time → WIP → invoice → cash)

**Board task:** `ioOg7I9jaHtMwQoS2tVU`  
**Portal:** `/portal/finance/job-costing` (+ Projects/time + Documents for issue/cash)

| Step | Traceability | Operator action | Pass |
| --- | --- | --- | --- |
| 1 | Quote/project linked | Enter stable `projectId` (+ optional quote id) | Project dimension on finance lines |
| 2 | Time cost applied | Purpose `wip_cost` → Apply time cost | Labor cost application + proposed journal lines |
| 3 | WIP recognition + aging | **Load closed loop** or WIP only | Open WIP + aging buckets; released when billed |
| 4 | Invoice draft / WIP release | Purpose `draft_invoice_lines` on same TE | No double-bill claim; open WIP drops for that TE |
| 5 | Cash application on receipt | Documents → allocate payment on project invoice | Job P&L cash applied / open AR updates |
| 6 | Month-end job P&L review | Closed loop stats + line detail | Margin + cash slices; accountant pack optional |

Regression tests must hold: no double-bill time, no double-cost WIP release (verify: `npm run verify:finance:job-costing`).

HTTP: `/api/v1/finance/job-costing/commands|queries` (`bundle`, `project-pnl`, `project-wip`, `closed-loop`) plus documents/payments as needed.

In-app runbooks: **H**, **P6-C**, **P6-C6** on `/portal/finance/runbooks`.

---

## Runbook P6-D — External accountant sign-off pack walkthrough

**Goal:** A human external accountant completes a one-sitting review and signs a **checklist artifact** (not a wet-signature product). Download-only; no live write required for the external party.

**Board task:** `O2hbOSJb4gydptVGEOG2` (pack) · packaging / proving surfaces

### D1. Internal preparer builds the pack

1. Complete multi-month program readiness (P6-A) or at least latest closed period + prior two closed.  
2. Open `/portal/finance/packaging` and/or `/portal/finance/proving` dry-run.  
3. Generate / gather:

| Pack slice | Source |
| --- | --- |
| Frozen TB per entity + consol | reports / hard-close |
| Journal listing / audit slice | ledger + practice audit CSV |
| AR/AP open items + aging | documents |
| Bank recon evidence (incl. feed accept audit) | statements · bank-feeds |
| Expense claims posted summary (if used) | expense-claims |
| Rev-rec deferred/recognized schedule (if used) | rev-rec |
| Job P&L / WIP aging snapshot (if agency) | job-costing |
| Payroll summaries + EMP201/EMP501/IRP5 prepare | payroll · packaging |
| IC / consolidation summary | intercompany |
| Hard-gate attestation page | this runbook § Hard gates |

4. Confirm `externalEgressAllowed=false` on every packaging result.  
5. Print or export the **External accountant acceptance checklist** (below / proving checklist).  
6. Hand off via secure download share **outside** mass-email product paths (or sitting side-by-side). Do not blast client-visible payslips/statements from PiB.

### D2. One-sitting walkthrough script

| # | Show | What to say | Sign-off field |
| --- | --- | --- | --- |
| 1 | Entity/book scope | Each legal entity has its own book; consol is separate. | Scope understood |
| 2 | Multi-month continuity | ≥3 periods; opening = prior closed TB. | Continuity OK / gap noted |
| 3 | Period-close centre | Blockers are system-enforced with deep links. | Blockers=0 or waiver list |
| 4 | TB / P&L / BS | Traceable to journals. | Reports OK |
| 5 | Bank recon + feed path | Human-accepted matches; feeds never auto-post; bulk only when safe. | Recon OK |
| 6 | Expense claims (if any) | Posted with VAT; OCR never auto-applied; no payout from claim. | Claims OK / N/A |
| 7 | Rev-rec (if any) | Explicit period runs; deferred vs billed explainable. | Rev-rec OK / N/A |
| 8 | Job cost loop (if agency) | Quote→time→WIP→invoice→cash without double-bill. | Jobs OK / N/A |
| 9 | Payroll lock | Immutable locked runs; corrections = new audited runs. | Payroll OK |
| 10 | Statutory prepare | EMP201/EMP501/IRP5 download for eFiling **outside** PiB. | Statutory OK |
| 11 | Practice grants (if firm) | Least-privilege prepare/review/export; audit on access. | Grants OK / N/A |
| 12 | Packaging ZIP/CSV | Download only; egress false. | Pack received |
| 13 | Hard gates read-aloud | No SARS submit; no payment initiate; no mass email; no auto-post; promote separate. | Attested |
| 14 | Sign checklist | Name, firm, date, period range, pass/fail, exceptions. | Signed artifact |

### D3. Checklist artifact minimum fields

```
Program: PiB Finance external accountant acceptance
Org / demo id: _______________
Period range: _______________ (≥3 months)
Entities/books: _______________
Accountant name: _______________
Firm: _______________
Date: _______________
Overall: PASS / PASS WITH EXCEPTIONS / FAIL
Exceptions (if any): _______________
Hard gates confirmed false/absent: SARS submit · payment initiate · mass email · bank auto-post · packaging egress
Signature / typed name: _______________
```

Store completed checklist under packaging evidence, proving checklist export, or Kanban `agentOutput.artifacts` — not as the only chat prose.

### D4. Proving kit shortcut

| Step | Surface |
| --- | --- |
| Seed | `proving.seed` |
| Multi-period close | `proving.close_fixture.run` |
| Packaging dry-run | `proving.packaging.dry_run` |
| Checklist toggle | `proving.checklist.read` / `toggle` |

Portal: `/portal/finance/proving`  
Verify: `npm run verify:finance:proving`

---

## Runbook P6-E — Scale, a11y, and power-user density (operator notes)

**Board tasks:** bulk scale `vh23AlAoh9E6l5Pvm6fP` · keyboard/a11y `fALOfEzGszHdjYynPHyO`

| Topic | Operator expectation |
| --- | --- |
| Large ledgers / statement imports | Progress/feedback; no silent timeout without retry path; bulk select caps remain (e.g. 50) — finish in batches |
| Keyboard | Bookkeeper can tab primary tables, accept/dismiss with documented shortcuts when shipped |
| A11y | Labels on finance controls; focus visible; ESS mobile usable |
| Failure | Prefer reverse/correct; never “delete to fix” posted books |

These are acceptance inputs for Quinn more than daily narrative — still listed so operators know batching is expected under load.

---

## HTTP / surface inventory (Phase 6 focus)

Full inventory: `lib/finance/service-boundaries.ts` → `FINANCE_HTTP_ENTRYPOINTS`.

| Module | Routes / portal |
| --- | --- |
| Bank feeds (daily product) | `/api/v1/finance/bank-feeds/*` · `/portal/finance/bank-feeds` |
| Operator depth / period-close | `/api/v1/finance/operator-depth/*` · `/portal/finance/period-close` |
| Proving + packaging | `/api/v1/finance/proving/*`, packaging · portal proving/packaging |
| Expense claims | finance expense-claims HTTP when inventoried · portal expense-claims |
| Revenue recognition | rev-rec commands/queries when inventoried |
| Practice grants | practice commands/queries extension |
| ESS | employee-scoped portal/PWA routes |
| Cash scenarios | budgets commands/queries extension |
| Job costing | `/api/v1/finance/job-costing/*` · `/portal/finance/job-costing` |
| Payroll / IC / documents / reports | unchanged Phase 4–5 modules |

When a Phase 6 surface is still landing on `development`, treat the **board task AC** as source of truth for route names and keep this runbook’s process steps stable.

---

## Related acceptance

Quinn staging checklist: [phase6-acceptance-pack-2026-08-03.md](./phase6-acceptance-pack-2026-08-03.md)  
Phase 5 baseline: [phase5-acceptance-pack-2026-08-03.md](./phase5-acceptance-pack-2026-08-03.md)  
Phase 4 baseline: [phase4-acceptance-pack-2026-08-02.md](./phase4-acceptance-pack-2026-08-02.md)

## Board map (Phase 6 docs + dependents)

| Workstream | Task id |
| --- | --- |
| Research residual gap | `ENqHqSQMrpK49AyIMhBm` |
| Spec update | `5rOjpXW4VzNsgtCxwz7I` |
| Scope approval (dev only) | `eqZUnsjDmKnE5tsnNXxX` |
| Multi-month + external pack | `O2hbOSJb4gydptVGEOG2` |
| Bank feed daily UX | `6b2T04ZyWNXYn7yB9UAd` |
| Provider adapter stub | `vaNKABngcZf4TqYPpVcV` |
| Expense claims | `SZRWufZ64Qnr3aqF9YyZ` |
| Revenue recognition | `ng0kop4wEjqP68gt3M5f` |
| Practice grants | `OpHGMxtFJ4fLXehncO9t` |
| ESS PWA | `7f4RaCyCoYdWWShb2dxg` |
| Cash scenarios | `MlELj0UlZw2ChNnBlqpJ` |
| Job-cost loop | `ioOg7I9jaHtMwQoS2tVU` |
| Bulk scale | `vh23AlAoh9E6l5Pvm6fP` |
| Keyboard/a11y | `fALOfEzGszHdjYynPHyO` |
| This docs pack | `upcYUjl6v1R44SC7kd3Z` |
| Vera expansion | `pSz1QwT7wC6Q98og327J` |
| Quinn Phase 6 suite | `2JNBdajxES3cqzP66Fmw` |
| Paid vendor gate (optional) | `a1NFXI8IbZFsv68rBCIl` |
| Peet promote gate | `oITb4OznO8sTtoTmQwxH` |

## Safety readback

- Internal only — **no client publish** from this task.  
- No SARS submit, no external payment initiate, no mass payslip/statement email.  
- No paid bank-feed vendor bind from ordinary cards.  
- No production promote / main merge from these runbooks alone.  
- Temporary HTML/proving fixtures are throw-away proof paths, not permanent CEO dashboards.  
- Agents: prefer finance HTTP commands; record commit SHAs + verify output in `agentOutput.artifacts[]`.
