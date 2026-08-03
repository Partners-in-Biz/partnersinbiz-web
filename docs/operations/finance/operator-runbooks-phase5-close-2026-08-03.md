# Finance operator runbooks — Phase 5 world-class close

**Status:** internal operator + accountant guide (development/staging first)  
**Date:** 2026-08-03  
**Project:** `HRCSWl1cNnh6fYEGziAb`  
**Canonical product spec:** `Flie3SblIDXvplYmqOhy`  
**Docs task:** `iaR4dsqPlUyGWuTlUENY`  
**Org scope:** always send `X-Org-Id` and use `scopedPortalPath` / `scopedApiPath`  
**Portal map:** `/portal/finance/runbooks` · Period close: `/portal/finance/period-close` · Proving kit: `/portal/finance/proving`  
**Extends:** [Phase 4 operator runbooks](./operator-runbooks-phase4-2026-08-02.md)

## Purpose

Give owners, bookkeepers, accountants, practice staff, and QA a single world-class **month-end close** path that uses shipped Phase 5 surfaces:

- Role-dense hubs and guided workflows (`/portal/finance` + practice)
- Period-close command centre with deep-linked blockers
- Mock-first bank feed connector (sync + human-gated suggestions only)
- Multi-entity IC + consolidation books
- Payroll bureau month-end (batch board, bulk payslip ZIP, leave calendar, EMP501 readiness)
- Proving kit + accountant acceptance checklist
- Explicit incident/rollback notes for bad imports

This page set is **not** a permanent CEO dashboard. Decision answers stay in Messages; runbooks are operator procedures.

## Hard gates (always on)

| Gate | Operator meaning | Surfaces |
| --- | --- | --- |
| No SARS e-file submit | Tax/payroll/packaging prepare + download only | Tax, Payroll, Packaging, Proving |
| No external payment initiate | Record/observe/allocate/export instructions only | Documents, Statements, Bank feeds, Bank rules, Payroll, Packaging |
| Bank feed / rules never auto-post | Sync stages lines; suggestions need Accept/Dismiss | Bank feeds, Statements, Bank rules |
| Recon never silent-posts journals | Accept is an explicit command with audit | Statements, Operator depth |
| Budgets/cashflow planning-only | No GL post from planner | Budgets |
| Mass email separately gated | Payslip packs and statements are download/export | Payroll, Documents, Packaging |
| Tenant isolation | Wrong org cannot read/write another book | Every command/query |
| Production promote is a Peet gate | Ordinary cards stay on `development` | Kanban / release |

## Role matrix for monthly close

| Persona | Primary close jobs | Must not |
| --- | --- | --- |
| **Owner** | Cash position, approval queue, pack download review | Initiate bank payouts; e-file SARS; skip SOD |
| **Bookkeeper** | Daily capture, bank import/feed sync, rule suggestions, draft journals, draft pay run calc/submit | Approve own pay run; hard-close period alone if role is bookkeeper-only; auto-accept recon |
| **Accountant** | Period-close blockers, adjustments, FX reval, IC elim/consolidation, TB freeze, accountant pack | SARS submit; payment initiate; mutate locked pay history |
| **Practice** | Multi-client switch, notification centre, audit explorer CSV, client pack handoff | Leak org scope; mass email client packs without separate approval |
| **Payroll clerk** | Bureau board, leave calendar, calculate/submit runs, bulk payslip ZIP | Approve/lock if not payroll_approver; salary payout |
| **Payroll approver** | SOD lock on runs; EMP201/EMP501 approve-ready | Submit and approve same run; SARS e-file |

Least privilege is enforced via practice role assignments (`/portal/finance/practice`). Bookkeeper cannot approve pay runs.

---

## Runbook P5-A — Monthly close (role-specific)

**Goal:** Take one open accounting period from “still working” → blockers clear → soft/hard close readiness with frozen trial balance evidence.

### A0. Shared preflight (all roles)

1. Confirm portal org via topbar / practice switcher (`X-Org-Id`).
2. Select **legal entity + book** on `FinanceScopeBar`.
3. Open `/portal/finance/period-close` and load sources.
4. Optionally seed/prove with `/portal/finance/proving` on demo orgs only (`seedKey` e.g. `pib-demo-proving-v1` — idempotent).

### A1. Owner path (approve + watch)

| Step | Action | Portal |
| --- | --- | --- |
| O1 | Open Cash position + Approval queue modules | `/portal/finance` (role hub) |
| O2 | Clear SOD items: recon awaiting approval, pay runs in review, tax packs | `/portal/finance/practice` |
| O3 | Spot-check runway/budget only if needed (planning, no GL) | `/portal/finance/budgets` |
| O4 | After accountant ready signal, download accountant pack | `/portal/finance/packaging` or proving checklist |
| O5 | Do **not** hard-close without accountant confirmation that blockers = 0 | period-close |

**Done when:** owner has no open approval chips for the period and pack is downloaded.

### A2. Bookkeeper path (capture + bank)

| Step | Action | Portal |
| --- | --- | --- |
| B1 | Finish invoices, bills, credit notes, payment allocate | `/portal/finance/documents` |
| B2 | Post routine journals (balanced); leave approval-required items in review | `/portal/finance/ledger` |
| B3 | Bank feed sync **or** statement import (see P5-B) | `/portal/finance/bank-feeds` + `/portal/finance/statements` |
| B4 | Accept/Dismiss recon suggestions only (human gate) | statements |
| B5 | Submit pay run for review if clerk; do not self-approve | `/portal/finance/payroll` |
| B6 | Re-run period-close evaluate until bookkeeper-owned blockers clear | `/portal/finance/period-close` |

**Empty state:** empty suggestion queues mean no unmatched lines or no rules/feed evaluated yet.

### A3. Accountant path (blockers → close)

| Step | Action | Portal / API |
| --- | --- | --- |
| C1 | Evaluate close centre | `POST /api/v1/finance/operator-depth/commands` → `period-close.evaluate` |
| C2 | Clear **blockers** (severity blocker) via deep links | see table below |
| C3 | Optional FX reval when multi-currency books require it | `/portal/finance/multi-currency` |
| C4 | Depreciation run if assets open for period | `/portal/finance/assets` |
| C5 | IC confirm + eliminations for group close (P5-C) | `/portal/finance/intercompany` |
| C6 | Review TB / P&L / BS | `/portal/finance/reports` |
| C7 | Soft-close / hard-close period via foundation period commands when `readyToClose=true` | ledger + foundation commands |
| C8 | Freeze TB evidence + export accountant pack | packaging / proving |

#### Period-close blocker catalogue (command centre)

| Code | Severity | Meaning | Deep link |
| --- | --- | --- | --- |
| `unreconciled_bank` | blocker | Recon not approved/closed | `/portal/finance/statements` |
| `unapproved_journals` | blocker | Draft/pending journals | `/portal/finance/ledger` |
| `open_pay_runs` | blocker | Pay runs not locked | `/portal/finance/payroll` |
| `missing_fx_reval` | blocker | Required when `requireFxReval` | `/portal/finance/multi-currency` |
| `incomplete_cutover` | warning | Opening TB not activated (first periods) | `/portal/finance/cutover` |
| `open_accounting_period_gap` | blocker/warn | Period continuity issues when detected | ledger |

Centre response always carries `externalPaymentInitiated: false`, `sarsSubmissionInitiated: false`, `externalEgressAllowed: false`.

### A4. Practice path (multi-client)

| Step | Action | Portal |
| --- | --- | --- |
| P1 | Switch client membership; re-check entity/book | `/portal/finance/practice` |
| P2 | Work notification centre (pay run submitted, recon awaiting, cutover ready) | practice `#notifications` |
| P3 | Walk client through A2/A3 without changing org mid-command | runbooks |
| P4 | Export audit CSV for engagement file | practice `#audit` |
| P5 | Hand off download packs — no mass email | packaging |

**Done when (entity/book):** `readyToClose=true` on period-close centre, TB reviewed, period soft- or hard-closed per policy, pack downloaded, audit trail present.

HTTP: `/api/v1/finance/operator-depth/commands|queries`, foundation period commands, reports queries.

---

## Runbook P5-B — Bank feed sync + human recon

**Goal:** Bring bank lines into PiB without auto-posting or paying anyone.

### B1. Prefer feed connector when configured

| Step | Action | Portal / API |
| --- | --- | --- |
| 1 | Configure connection (mock provider in staging) | `/portal/finance/bank-feeds` · `bank_feed.connection.configure` |
| 2 | Link PiB bank account target | bank-feeds |
| 3 | Run sync | `bank_feed.sync` |
| 4 | Review staged lines (`importStatus`: staged / imported / duplicate / error) | bank-feeds |
| 5 | Review feed suggestions | accept/dismiss only |
| 6 | Continue into statements recon for zero-difference approval | `/portal/finance/statements` |

Commands:  
`bank_feed.connection.configure` · `bank_feed.sync` · `bank_feed.suggestion.accept` · `bank_feed.suggestion.dismiss` · read: `bank_feed.connection.read` · `bank_feed.audit.read`

HTTP: `/api/v1/finance/bank-feeds/commands|queries`

### B2. Fallback: file import + rules

Use Phase 4 Runbook D when no feed connection exists:

1. Import CSV/OFX/MT940 on `/portal/finance/statements`
2. Evaluate `/portal/finance/bank-rules` (suggestions only)
3. Accept/Dismiss with audit
4. Approve recon only at zero difference (SOD)

### B3. Human recon close checks

- Unmatched lines remaining → period-close `unreconciled_bank`
- Accept never initiates payout
- Dismissed patterns must not re-spam without rule edit
- Sync failures leave prior imported lines intact; re-sync is idempotent by source fingerprint

**Hard gates:** mock-first / no paid open-banking vendor required for staging; `noEgress` in unit verifies; never auto-post journals from sync.

---

## Runbook P5-C — Multi-entity consolidation checklist

**Goal:** Group close with entity attribution preserved and eliminations only on consolidation books.

Entities in proving seed (example): HOLD / OPS / SVC-style books with consol book — see proving kit `seedKey`.

| # | Check | Portal | Pass criteria |
| --- | --- | --- | --- |
| 1 | Each legal entity book closed or close-ready independently | period-close per book | Blockers=0 or documented waivers |
| 2 | IC pairs proposed and receive-confirmed | `/portal/finance/intercompany` | No silent mirror |
| 3 | Due-to / due-from recon difference = 0 for period | intercompany | Matched balances |
| 4 | Elimination entries posted **only** into consolidation book | intercompany | Entity books unchanged by elim |
| 5 | Consolidation run listed with period label | intercompany | Run status complete |
| 6 | Consolidated TB / reports reviewed | reports + consol book scope | Totals explainable from entities − elims |
| 7 | Cross-org payment notify/confirm only if multi-tenant cash movement observed | `/portal/finance/cross-org` | Observe/confirm; no initiate |
| 8 | Accountant pack includes multi-entity manifest | packaging / proving dry-run | Download only |

HTTP: `/api/v1/finance/intercompany/commands|queries`, foundation, reports, packaging.

**Non-goals:** automatic bank settlement between entities; external payment rails.

---

## Runbook P5-D — Payroll bureau month-end

**Goal:** Multi-entity payroll ops closed for the calendar month without payout or SARS submit.

| Step | Action | Portal / notes |
| --- | --- | --- |
| D1 | Open multi-entity / batch pay-run board + calendar density | `/portal/finance/payroll` |
| D2 | Leave month calendar: balances, pending requests, accrual summary | payroll leave calendar |
| D3 | Apply salary structure templates where used (create/activate/expand to period components) | payroll |
| D4 | Per entity: calculate → submit → **separate** approver locks | SOD enforced |
| D5 | Bulk payslip ZIP for locked runs (download only; no mass email) | payroll bureau pack |
| D6 | EMP201 prepare/approve package for month | payroll statutory |
| D7 | EMP501 annual readiness + IRP5 batch CSV when tax year requires | prepare/download only |
| D8 | Vera PAYE/UIF/SDL edge fixtures used in verify path (engineers/QA) | `npm run verify:finance:payroll` |
| D9 | Period-close must show no `open_pay_runs` blockers | period-close |

**Correction / reversal:** never mutate locked history. Use correction runs / reversal commands with audit. Net pay instruction files may be packaged for offline bank capture — **not** initiated inside PiB.

HTTP: `/api/v1/finance/payroll/commands|queries`  
Modules: `lib/payroll/bureau*.ts`, statutory service, pay-run service.

**Hard gates:** `externalPaymentInitiated=false`, `sarsSubmissionInitiated=false`, `massEmailAllowed=false`, `identitiesHold=true` on verify script.

---

## Runbook P5-E — Accountant external review pack walkthrough

**Goal:** External accountant can review without live write access or e-filing from PiB.

### E1. Build the pack (internal accountant / practice)

1. Confirm period close readiness (P5-A).
2. Open `/portal/finance/packaging` **or** proving packaging dry-run on demo.
3. Generate packs as needed:
   - Trial balance (frozen if hard-closed)
   - Journal listing / audit slice
   - AR/AP open items + aging
   - Bank recon evidence
   - Payroll summaries + statutory prepare packs
   - IC / consolidation summary when multi-entity
4. Confirm packaging flags: `externalEgressAllowed=false` (download/manifest only).
5. Toggle proving checklist items with evidence notes when using `/portal/finance/proving`.

### E2. Walkthrough script (call with external accountant)

| # | Show | What to say |
| --- | --- | --- |
| 1 | Entity/book scope | “Each legal entity has its own book; consol is separate.” |
| 2 | Period status | open → soft_closed → hard_closed; hard_closed freezes TB. |
| 3 | Period-close centre | Blockers are system-enforced with deep links — not a spreadsheet. |
| 4 | TB / P&L / BS | Reports are traceable to journals. |
| 5 | Bank recon | Human-accepted matches only; feeds never auto-post. |
| 6 | Payroll lock | Locked runs immutable; corrections are new audited runs. |
| 7 | Statutory | EMP201/EMP501/IRP5 are prepare/export for eFiling upload **outside** PiB. |
| 8 | Packaging ZIP/PDF/CSV | Download only; no PiB→SARS submit; no PiB→bank payout. |
| 9 | Audit explorer | Actor / action / entity / date + CSV for engagement file. |
| 10 | Hard gates | Read aloud the four non-goals. |

### E3. Proving kit shortcut (demo / staging only)

| Step | Command surface |
| --- | --- |
| Seed demo company | `proving.seed` (idempotent `seedKey`) |
| Multi-period close fixture | `proving.close_fixture.run` (blockers → hard_closed + frozen TB) |
| Packaging dry-run | `proving.packaging.dry_run` |
| Checklist | `proving.checklist.read` / `proving.checklist.toggle` |

Portal: `/portal/finance/proving`  
HTTP: `/api/v1/finance/proving/commands|queries`  
Verify: `npm run verify:finance:proving`

---

## Runbook P5-F — Incident / rollback notes for bad imports

**Goal:** Recover safely from bad bank imports, feed syncs, cutover packages, bulk allocates, or payroll drafts — without deleting audit history or initiating money movement.

### F1. Principles

1. **Prefer reverse / correct, never silent delete** of posted journals.
2. Posted journals are immutable; reversals are separate balanced posted entries (`reversesJournalEntryId`).
3. Imports should be idempotent by source fingerprint — duplicates land as `duplicate`, not double posts.
4. Keep org/entity/book scope on every recovery command.
5. Record incident in practice audit + Kanban evidence; do not hide in chat-only notes.

### F2. Bad bank statement file import

| Symptom | Immediate action | Rollback / fix |
| --- | --- | --- |
| Wrong account mapped | Stop Accept on suggestions | Do not approve recon; dismiss bad suggestions; re-import to correct account if lines still staged |
| Duplicate file | Expect `duplicate` fingerprints | Leave duplicates unmatched; do not force-match |
| Wrong dates / truncated file | Leave recon unapproved | Import corrected file; match only valid lines |
| Suggestions already accepted incorrectly | Stop further accepts | Reverse any journals created from bad accept (foundation reverse); re-match correctly |
| Recon approved with error | Escalate accountant | Reverse related journals; open adjustment period entry; **do not** unlock approved recon by deleting rows |

### F3. Bad bank feed sync

| Symptom | Action |
| --- | --- |
| Sync failed mid-run | Read `sync.failed` audit; re-run `bank_feed.sync` (idempotent) |
| Provider returned garbage amounts | Dismiss suggestions; do not Accept; disable connection until provider fixed |
| Wrong bank account linked | Reconfigure connection target **before** Accept; quarantine staged lines |
| Paid vendor temptation | Stay on mock/staging; paid open-banking vendor is a separate Peet commercial gate |

### F4. Bad cutover / opening TB

- Do **not** activate unbalanced packages.
- If activated incorrectly: reverse opening journal via audited reverse; create new cutover package; never rewrite activated package lines in place.
- `book.cutoverAt` changes are audit-bearing — escalate finance_admin.

### F5. Bad bulk allocate / multi-doc allocation plan

- Operator depth multi-allocate supports partial + on_account overpay modes.
- If over-allocated: reverse allocation / payment application entries; re-run plan with `reject` overpay mode if needed.
- Cap awareness: bulk select-all is capped (50) — incidents from partial bulk are expected; finish remaining in a second batch.

### F6. Bad payroll draft / wrong inputs

| State | Action |
| --- | --- |
| Draft / calculated | Edit inputs; recalculate |
| In review | Reject/return; correct; resubmit |
| Approved locked | **Correction run** or **reversal** only — never edit locked lines |
| Wrong EMP201 prepare | Prepare new package; do not “unsubmit” to SARS (PiB never submitted) |
| Bad bulk payslip ZIP | Re-download after correction run; old ZIP is stale evidence only |

### F7. Incident ticket minimum fields

- orgId, legalEntityId, bookId, periodId  
- Import/sync/run IDs  
- Actor + timestamp  
- What was accepted vs staged  
- Journals posted (ids)  
- Reversal journal ids  
- Verify commands re-run after fix  
- Hard-gate confirmation still false for SARS/pay/email  

---

## HTTP inventory (Phase 5 additions)

Full list: `lib/finance/service-boundaries.ts` → `FINANCE_HTTP_ENTRYPOINTS`.

Phase 5 close-critical modules:

| Module | Routes |
| --- | --- |
| Operator depth / period-close | `/api/v1/finance/operator-depth/commands\|queries` |
| Bank feeds | `/api/v1/finance/bank-feeds/commands\|queries` |
| Proving kit | `/api/v1/finance/proving/commands\|queries` |
| Payroll (bureau) | `/api/v1/finance/payroll/commands\|queries` |
| Intercompany | `/api/v1/finance/intercompany/commands\|queries` |
| Packaging | `/api/v1/finance/packaging/commands\|queries` |
| Practice / roles | `/api/v1/finance/practice/commands\|queries` |

## Related acceptance

Quinn staging checklist: [phase5-acceptance-pack-2026-08-03.md](./phase5-acceptance-pack-2026-08-03.md)  
Phase 4 baseline: [phase4-acceptance-pack-2026-08-02.md](./phase4-acceptance-pack-2026-08-02.md)

## Dependency evidence (board)

| Workstream | Task id |
| --- | --- |
| Proving kit | `QkRVcgafdbuklU2hQyPs` |
| Operator depth / period-close | `T5BOeWaQR0XGpb39VfuY` |
| Bank feed framework | `Bsk58c2oq7BuMKhLFcHm` |
| Role-specific UX | `2W79LIFTV5v12J8CTW56` |
| Payroll bureau depth | `0KqsOlaCnVo6JomTdB8F` |
| This docs pack | `iaR4dsqPlUyGWuTlUENY` |

## Safety readback

- Internal only — not client-published.
- No SARS submit, no external payment initiate, no mass payslip/statement email.
- No production promote / main merge from these runbooks alone.
- Temporary HTML/proving fixtures are throw-away proof paths, not permanent CEO dashboards.
- Agents: prefer finance HTTP commands; record commit SHAs + verify output in `agentOutput`.
