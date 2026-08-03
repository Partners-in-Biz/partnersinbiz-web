# Phase 5 acceptance pack — World-class close procedures

**Status:** internal staging acceptance (do not promote production from this pack alone)  
**Date:** 2026-08-03  
**Project:** `HRCSWl1cNnh6fYEGziAb`  
**Source spec:** `Flie3SblIDXvplYmqOhy`  
**Docs task:** `iaR4dsqPlUyGWuTlUENY`  
**QA owner:** Quinn (`qa-release`) · Reviewer: Pip · Final promote: Peet (`mvAO92O7YmOJCiX0RiiO`)  
**Branch:** `development` only for ordinary work  
**Operator narrative:** [operator-runbooks-phase5-close-2026-08-03.md](./operator-runbooks-phase5-close-2026-08-03.md)  
**Extends:** [phase4-acceptance-pack-2026-08-02.md](./phase4-acceptance-pack-2026-08-02.md)

## How to use (Quinn)

1. Work on latest `origin/development` (pull/rebase first).
2. Run automated gates below; paste command output into the QA task `agentOutput`.
3. Walk human golden paths on staging/preview (not production).
4. Mark each checklist row **Pass / Fail / N/A** with evidence (screenshot path, route, SHA, or log excerpt).
5. Peet production promote is a **separate** gate. This pack does not merge to `main`.

## Hard non-goals (must remain false / absent)

| Control | Expected |
| --- | --- |
| SARS e-file submit route/UI | Absent / blocked |
| External payment initiation | Absent / blocked |
| Mass payslip/statement email send | Absent / `massEmailAllowed=false` |
| Bank feed or bank rule auto-post | Never |
| Packaging external egress | `externalEgressAllowed=false` |
| Ordinary card production promote | Forbidden |
| Permanent CEO dashboard as delivery surface | Forbidden — answers in Messages; runbooks are operator maps |

---

## A. Automated gates (run on development checkout)

```bash
git rev-parse --abbrev-ref HEAD   # expect development
git status --short --branch
git rev-parse HEAD

# Security + unit baseline
npm run verify:finance:security
npm run test:finance:unit

# Phase 4 still green
npm run verify:finance:foundation
npm run verify:finance:documents
npm run verify:finance:payroll
npm run verify:finance:multi-currency
npm run verify:finance:job-costing
npm run verify:finance:assets
npm run verify:finance:intercompany
npm run verify:finance:tax-reporting

# Phase 5 world-class
npm run verify:finance:proving
npm run verify:finance:operator-depth
npm run verify:finance:bank-feeds
# inventory if present on branch:
npm run verify:finance:inventory || true

# Portal parity + HTTP inventory
npx jest __tests__/finance/portal-design-system-parity.test.ts \
  __tests__/finance/workbench-delivery.test.ts --runInBand
```

### Pass criteria

| Check | Pass when |
| --- | --- |
| Branch | `development` (not main) |
| Security verify | EXIT 0; `noEgress` / `sarsSubmissionInitiated=false` / `externalPaymentInitiated=false` |
| Unit finance | EXIT 0 |
| Design-system parity | EXIT 0; tabs include `runbooks`, `period-close`, `proving`, `bank-feeds` |
| Workbench delivery | EXIT 0; HTTP inventory matches `FINANCE_HTTP_ENTRYPOINTS` |
| Proving | EXIT 0; seed idempotent; close fixture → hard_closed; packaging dry-run hard gates false |
| Operator depth | EXIT 0; period-close blockers + deep links covered |
| Bank feeds | EXIT 0; sync + human accept/dismiss only; noEgress |
| Payroll | EXIT 0; bureau/EMP paths; no payout/SARS |
| Module verifies | Each EXIT 0 for listed modules |

Record HEAD SHA: `____________________`

---

## B. Quinn checklist — Phase 5 close product AC

| Area | Check | Pass criteria | Evidence | P/F/NA |
| --- | --- | --- | --- | --- |
| Branch/deploy | Work on development | No main commits from Phase 5 cards | git log | |
| Docs | Phase 5 runbooks + this pack | Files present under `docs/operations/finance/` | repo paths | |
| Portal map | Runbooks page | `/portal/finance/runbooks` lists Phase 5 close lanes + links to period-close, bank-feeds, proving, payroll, packaging | UI | |
| Tenant | Org isolation | Wrong `X-Org-Id` cannot read/write another org book | security tests + practice switcher | |
| Design system | Portal parity | ModuleShell / PageHeader / Card / Button / HudChip / StatCard | parity jest + spot check | |
| Role UX | Owner/bookkeeper/accountant/practice | Hub modules + guided steppers visible by role; bookkeeper cannot approve pay run | practice + payroll | |
| Monthly close | Role-specific path | Owner approvals, bookkeeper capture/bank, accountant blockers→close, practice multi-client | runbooks P5-A + UI | |
| Period-close centre | Blockers | Evaluate shows deep links for unreconciled bank, unapproved journals, open pay runs; optional FX/cutover | `/portal/finance/period-close` | |
| Bank feeds | Sync + human recon | Configure mock connection → sync → staged lines → Accept/Dismiss only → recon path | `/portal/finance/bank-feeds` + statements | |
| Bank rules | Still human-gated | File import path still suggestions-only | bank-rules | |
| Multi-entity | Consolidation checklist | IC confirm, elims on consol book only, consol TB explainable | intercompany + reports | |
| Payroll bureau | Month-end | Multi-entity board, bulk payslip ZIP download, leave calendar, EMP501 readiness prepare | payroll | |
| Accountant pack | External review walkthrough | Packaging dry-run / pack download with egress false; checklist walkthrough usable | packaging + proving | |
| Incident/rollback | Bad import notes | Runbook P5-F present; reverse-not-delete principle documented; duplicate fingerprint behaviour known | docs + bank-feeds tests | |
| Proving kit | Demo close | Seed idempotent; multi-period fixture blockers→hard_closed; frozen TB; checklist printable | `/portal/finance/proving` | |
| Operator depth | Bulk + filters | Advanced filters/saved views; bulk select-all cap 50; multi-doc allocation plan | documents/operator-depth | |
| Non-goal APIs | Negative tests | No SARS submit; no payment initiate; no mass email send | security + module verifies | |
| Audit | Explorer + events | Key close actions by actor/action/entity/date; CSV export org-scoped | practice | |
| Packaging | Egress flag | Exports succeed with `externalEgressAllowed=false` | packaging / proving dry-run | |
| Regression | P1–P4 foundation | IC, cross-org confirm, payroll lock/correct, tax prepare, AR/AP depth still green | unit + module verifies | |
| CEO delivery rule | No permanent dashboard | Acceptance evidence in QA task + Messages; runbooks are not the only answer surface | process | |
| Evidence | agentOutput | Commit SHAs, commands, routes, hard-gate confirmation | QA task | |

---

## C. Portal route smoke (manual) — Phase 5 focus

Open each route under tenant scope; confirm ModuleShell frame, no crash, empty-state next action when empty:

| Route | Role in close |
| --- | --- |
| `/portal/finance` | Role hub / cash / approvals |
| `/portal/finance/runbooks` | Operator map (Phase 4 + Phase 5) |
| `/portal/finance/period-close` | Close command centre |
| `/portal/finance/proving` | Demo seed + accountant checklist |
| `/portal/finance/bank-feeds` | Feed sync human-gated |
| `/portal/finance/statements` | Recon approve |
| `/portal/finance/bank-rules` | Rules suggestions |
| `/portal/finance/documents` | AR/AP capture + bulk allocate |
| `/portal/finance/ledger` | Journals / period status |
| `/portal/finance/reports` | TB / P&L / BS |
| `/portal/finance/payroll` | Bureau month-end |
| `/portal/finance/intercompany` | IC + consolidation |
| `/portal/finance/multi-currency` | FX reval when required |
| `/portal/finance/assets` | Depreciation if in scope |
| `/portal/finance/packaging` | Download packs |
| `/portal/finance/practice` | Roles, notifications, audit CSV |
| `/portal/finance/cutover` | Opening TB (first periods) |
| `/portal/finance/setup` | Day-0 if empty tenant |
| `/portal/finance/cross-org` | Notify/confirm only |
| `/portal/finance/inventory` | Stock lite if enabled on branch |

---

## D. Human golden paths (execute once on staging)

### D1. Monthly close (single entity)

1. Bookkeeper: post invoice + bill; import/sync bank; accept matches; zero-diff recon approved by approver.
2. Payroll: calculate → submit → different user locks.
3. Accountant: period-close evaluate → blockers 0 → review TB → close period.
4. Download accountant pack.

**Pass:** period soft/hard closed per UI; pack downloaded; hard gates false.

### D2. Bank feed + recon

1. Configure mock feed connection to bank account.
2. Sync; observe staged lines + suggestions.
3. Accept one; dismiss one; confirm audit events.
4. Complete recon; confirm no payout API called.

**Pass:** `verify:finance:bank-feeds` green + UI path above.

### D3. Multi-entity consolidation

1. Use proving seed or existing HOLD/OPS/consol books.
2. Confirm IC pair; post elim into consol only.
3. Entity books retain attribution; consol TB nets IC.

**Pass:** intercompany verify + checklist rows.

### D4. Payroll bureau month-end

1. Multi-entity board shows runs.
2. Lock one run; download bulk payslip ZIP (no email).
3. Leave calendar loads.
4. EMP501 readiness / IRP5 batch prepare download only.

**Pass:** `verify:finance:payroll` identitiesHold + noEgress.

### D5. Bad import incident drill (docs + behaviour)

1. Re-import same statement → duplicates not double-posted.
2. Attempt accept on garbage suggestion → dismiss path works.
3. Confirm runbook P5-F lists reverse-not-delete.

**Pass:** duplicate handling + docs present.

---

## E. Board workstream map (Phase 5 close docs)

| Workstream | Task id | Expected before promote discussion |
| --- | --- | --- |
| Proving kit | `QkRVcgafdbuklU2hQyPs` | done + verified |
| Operator depth | `T5BOeWaQR0XGpb39VfuY` | done + verified |
| Bank feeds | `Bsk58c2oq7BuMKhLFcHm` | done + verified |
| Role UX | `2W79LIFTV5v12J8CTW56` | done + verified |
| Payroll bureau | `0KqsOlaCnVo6JomTdB8F` | done + verified |
| Close runbooks + this pack | `iaR4dsqPlUyGWuTlUENY` | done with commit evidence |
| QA regression suite | `9FpncDVhnhaozaKKTgHt` | Quinn executes this pack |
| Peet prod promote | `mvAO92O7YmOJCiX0RiiO` | only after Quinn green |

---

## F. Evidence template (paste into QA agentOutput)

```text
Phase 5 acceptance pack — world-class close
HEAD: <sha>
Branch: development
verify:finance:security: PASS|FAIL
test:finance:unit: PASS|FAIL
portal-design-system-parity: PASS|FAIL
workbench-delivery: PASS|FAIL
verify:finance:proving: PASS|FAIL
verify:finance:operator-depth: PASS|FAIL
verify:finance:bank-feeds: PASS|FAIL
verify:finance:payroll: PASS|FAIL
module verifies: foundation/documents/intercompany/fx/job-costing/assets/tax = ...
Golden paths: monthly-close= bank-feed= multi-entity= payroll-bureau= bad-import=
Hard gates: sarsSubmit=false paymentInitiate=false massEmail=false autoPostFeed=false autoPostRules=false egress=false
Runbooks: /portal/finance/runbooks + docs/operations/finance/operator-runbooks-phase5-close-2026-08-03.md
Acceptance: docs/operations/finance/phase5-acceptance-pack-2026-08-03.md
Spec: Flie3SblIDXvplYmqOhy
Project: HRCSWl1cNnh6fYEGziAb
Docs task: iaR4dsqPlUyGWuTlUENY
Production promote: NOT requested from this pack
```

## G. Safety readback

- Internal only.
- No public publish of client documents without Peet.
- No SARS submit, no payment initiate, no mass payslip/statement email.
- No production promote / main merge from this acceptance pack alone.
- Staging/preview only when Peet asks for a build-triggering push (`[vercel-build]` / `[preview-build]`).
- CEO data-decision rule: temporary throw-away HTML only inside chat when useful; durable answer stays in Messages / QA evidence.

## Related

- Phase 5 close runbooks: [operator-runbooks-phase5-close-2026-08-03.md](./operator-runbooks-phase5-close-2026-08-03.md)
- Phase 4 runbooks: [operator-runbooks-phase4-2026-08-02.md](./operator-runbooks-phase4-2026-08-02.md)
- Phase 4 acceptance: [phase4-acceptance-pack-2026-08-02.md](./phase4-acceptance-pack-2026-08-02.md)
- Residual gap map: [finance-phase5-residual-gap-map-2026-08-03.md](../../research/finance-phase5-residual-gap-map-2026-08-03.md)
