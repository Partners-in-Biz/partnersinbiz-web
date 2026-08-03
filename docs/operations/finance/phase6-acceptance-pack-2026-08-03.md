# Phase 6 acceptance pack — World-class market proof + product depth

**Status:** internal staging acceptance (do not promote production from this pack alone)  
**Date:** 2026-08-03  
**Project:** `HRCSWl1cNnh6fYEGziAb`  
**Source spec:** `Flie3SblIDXvplYmqOhy`  
**Docs task:** `upcYUjl6v1R44SC7kd3Z`  
**Scope gate (dev only):** `eqZUnsjDmKnE5tsnNXxX`  
**QA owner:** Quinn (`qa-release`) · Reviewer: Pip · Final promote: Peet (`oITb4OznO8sTtoTmQwxH`)  
**Optional paid bank-feed vendor:** Peet gate `a1NFXI8IbZFsv68rBCIl` (not part of ordinary Phase 6 AC)  
**Branch:** `development` only for ordinary work  
**Operator narrative:** [operator-runbooks-phase6-world-class-2026-08-03.md](./operator-runbooks-phase6-world-class-2026-08-03.md)  
**Extends:** [phase5-acceptance-pack-2026-08-03.md](./phase5-acceptance-pack-2026-08-03.md) · [phase4-acceptance-pack-2026-08-02.md](./phase4-acceptance-pack-2026-08-02.md)

## How to use (Quinn)

1. Work on latest `origin/development` (pull/rebase first).  
2. Confirm Phase 6 implementation tasks you are verifying are `done` with commit artifacts — several cards may still land during the program; mark **N/A** only when the surface is explicitly deferred with Peet note.  
3. Run automated gates below; paste command output into the QA task `agentOutput`.  
4. Walk human golden paths on staging/preview (not production).  
5. Mark each checklist row **Pass / Fail / N/A** with evidence (screenshot path, route, SHA, or log excerpt).  
6. Peet production promote is a **separate** gate (`oITb4OznO8sTtoTmQwxH`). This pack does not merge to `main`.  
7. Paid live bank-feed vendor is a **separate** gate (`a1NFXI8IbZFsv68rBCIl`). Mock/stub only unless that gate passes.

## Hard non-goals (must remain false / absent)

| Control | Expected |
| --- | --- |
| SARS e-file submit route/UI | Absent / blocked |
| External payment initiation | Absent / blocked |
| Mass payslip/statement email send | Absent / `massEmailAllowed=false` |
| Bank feed or bank rule auto-post | Never |
| OCR auto-apply to books | Never (`autoApplied=false`) |
| Cash scenario GL post / bank movement | Never |
| Packaging external egress | `externalEgressAllowed=false` |
| Paid open-banking vendor without Peet gate | Absent |
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

# Phase 4–5 still green
npm run verify:finance:foundation
npm run verify:finance:documents
npm run verify:finance:payroll
npm run verify:finance:multi-currency
npm run verify:finance:job-costing
npm run verify:finance:assets
npm run verify:finance:intercompany
npm run verify:finance:tax-reporting
npm run verify:finance:proving
npm run verify:finance:operator-depth
npm run verify:finance:bank-feeds
npm run verify:finance:inventory || true

# Phase 6 module verifies when present on branch (do not invent green):
npm run verify:finance:expense-claims 2>/dev/null || true
npm run verify:finance:revenue-recognition 2>/dev/null || true
npm run verify:finance:practice-grants 2>/dev/null || true
npm run verify:finance:ess 2>/dev/null || true
npm run verify:finance:cash-scenarios 2>/dev/null || true
npm run verify:finance:bank-feeds   # productization cases should fold here or sibling script

# Portal parity + HTTP inventory
npx jest __tests__/finance/portal-design-system-parity.test.ts \
  __tests__/finance/workbench-delivery.test.ts --runInBand

# Optional e2e golden paths
npm run verify:finance:e2e || true
```

### Pass criteria

| Check | Pass when |
| --- | --- |
| Branch | `development` (not main) |
| Security verify | EXIT 0; `noEgress` / `sarsSubmissionInitiated=false` / `externalPaymentInitiated=false` |
| Unit finance | EXIT 0 |
| Design-system parity | EXIT 0; runbooks page lists Phase 6 lanes when portal pointer shipped |
| Workbench delivery | EXIT 0; HTTP inventory matches `FINANCE_HTTP_ENTRYPOINTS` for shipped modules |
| Proving | EXIT 0; multi-period path still green |
| Operator depth | EXIT 0; period-close blockers + deep links |
| Bank feeds | EXIT 0; health/recon centre/safe bulk when productized; human accept only; noEgress |
| Job costing | EXIT 0; closed-loop regressions hold |
| Payroll | EXIT 0; ESS paths least-privilege when shipped; no payout/SARS |
| Phase 6 modules | Each shipped module EXIT 0; unshipped = N/A with task id |
| Module verifies P4–P5 | Each EXIT 0 |

Record HEAD SHA: `____________________`

---

## B. Quinn checklist — Phase 6 product AC

| Area | Check | Pass criteria | Evidence | P/F/NA |
| --- | --- | --- | --- | --- |
| Branch/deploy | Work on development | No main commits from Phase 6 ordinary cards | git log | |
| Docs | Phase 6 runbooks + this pack | Files under `docs/operations/finance/*phase6*` | repo paths | |
| Portal map | Runbooks page | `/portal/finance/runbooks` lists Phase 6 market-proof lanes + links | UI | |
| Tenant | Org isolation | Wrong `X-Org-Id` cannot read/write another org book | security tests | |
| Design system | Portal parity | ModuleShell / PageHeader / Card / Button / HudChip / StatCard | parity jest + spot check | |
| Multi-month program | ≥3 periods × ≥2 entities | Closed periods, continuity, IC, payroll lock, packaging, bank recon history | proving / demo org + P6-A | |
| External accountant | Sign-off pack | Checklist artifact walkthrough completable in one sitting; download-only | packaging + P6-D | |
| Bank feeds daily | Product path | Health, multi-account, sync, recon centre aging, safe bulk, human accept only | `/portal/finance/bank-feeds` | |
| Bank fallback | File import | Still works via statements + bank-rules | statements | |
| Provider stub | No paid bind | Non-mock adapter fails closed; no live vendor calls; mock default | adapter tests + docs | |
| Expense claims | Lifecycle | Draft→submit→approve→post; receipt attach; OCR confirm-only; no payout | expense-claims | |
| Revenue recognition | Lite schedules | Straight-line/milestone; period run posts journals; reverse audited; deferred report | rev-rec | |
| Practice grants | Firm→client ACL | prepare/review/file-export; audit; revoke; no membership sprawl required | practice + security | |
| ESS | Payslips + leave | Own payslips download; leave request; no admin payroll; no mass email | ESS/PWA | |
| Cash scenarios | Named scenarios | base/downside/upside compare; planning-only; optional actuals read-only | budgets | |
| Job-cost loop | Closed loop | quote→time→WIP→invoice→cash; no double-bill/double-cost | job-costing | |
| Scale | Large ledgers/imports | No silent corruption; batching caps documented | scale task evidence | |
| A11y / keyboard | Power-user density | Focus order; primary recon actions keyboardable when shipped | a11y task evidence | |
| Vera | Calc/recon expansion | Phase 6 audit task green or linked residual | `pSz1QwT7wC6Q98og327J` | |
| Non-goal APIs | Negative tests | No SARS submit; no payment initiate; no mass email; no auto-post | security + module verifies | |
| Packaging | Egress flag | Exports succeed with `externalEgressAllowed=false` | packaging / proving | |
| Regression | P1–P5 foundation | Close centre, IC, payroll, tax prepare, AR/AP, feeds still green | unit + module verifies | |
| CEO delivery rule | No permanent dashboard | Acceptance evidence in QA task + Messages | process | |
| Promote | Separate gate | This pack does not approve `main` / production | `oITb4OznO8sTtoTmQwxH` open until Peet | |
| Evidence | agentOutput | Commit SHAs, commands, routes, hard-gate confirmation, `artifacts[]` | QA task | |

---

## C. Portal route smoke (manual) — Phase 6 focus

Open each route under tenant scope; confirm ModuleShell frame, no crash, empty-state next action when empty:

| Route | Role in Phase 6 |
| --- | --- |
| `/portal/finance` | Role hub |
| `/portal/finance/runbooks` | Operator map (P4 + P5 + P6) |
| `/portal/finance/period-close` | Close command centre |
| `/portal/finance/proving` | Multi-month fixture + checklist |
| `/portal/finance/bank-feeds` | Daily recon product |
| `/portal/finance/statements` | Recon approve / file fallback |
| `/portal/finance/bank-rules` | Rules suggestions |
| `/portal/finance/expense-claims` | Claims (when routed) |
| `/portal/finance/revenue-recognition` | Rev-rec (when routed) |
| `/portal/finance/job-costing` | Closed-loop polish |
| `/portal/finance/budgets` | Cash scenarios |
| `/portal/finance/practice` | Grants + switcher + audit |
| `/portal/finance/payroll` | Bureau + leave calendar |
| ESS / PWA employee route | Payslips + leave (when shipped) |
| `/portal/finance/documents` | AR/AP |
| `/portal/finance/ledger` | Journals / period status |
| `/portal/finance/reports` | TB / P&L / BS |
| `/portal/finance/intercompany` | IC + consolidation |
| `/portal/finance/packaging` | Download packs |
| `/portal/finance/multi-currency` | FX reval |
| `/portal/finance/assets` | Depreciation |
| `/portal/finance/cutover` | Opening TB |
| `/portal/finance/cross-org` | Notify/confirm only |

If a Phase 6 route is not yet on the branch, mark N/A and cite the open implementation task id.

---

## D. Human golden paths (execute once on staging)

### D1. Multi-month close program

1. Seed proving or internal demo org (≥2 entities).  
2. Close three consecutive periods per P6-A (capture, bank, payroll SOD, period-close, IC/elim, packaging).  
3. Confirm continuity of openings and frozen TB history.  

**Pass:** three closed periods; hard gates false; evidence artifacts attached.

### D2. Bank feed daily recon

1. Configure mock connection; observe health.  
2. Sync multi-account; open recon centre aging.  
3. Accept one; dismiss one; safe bulk only if filters pass.  
4. Complete zero-diff recon; confirm no payout API.  
5. Optional: force error/stale state and reconnect path.  

**Pass:** `verify:finance:bank-feeds` green + UI path; never auto-post.

### D3. Expense claim + OCR confirm

1. Draft claim with VAT lines + receipt.  
2. Run OCR assist if available → confirm lines manually.  
3. Submit → different user approves → post to payable/journal.  
4. Confirm no payment initiation.  

**Pass:** statuses and audit; `autoApplied=false`.

### D4. Revenue recognition period run

1. Create straight-line schedule on an AR document.  
2. Run period recognition; inspect journals.  
3. Reverse one run; confirm audit.  
4. Deferred vs recognized report readable.  

**Pass:** balanced journals + reverse path.

### D5. Practice grant least privilege

1. Create firm→client grant `prepare`.  
2. Prepare user can draft; cannot approve pay run / escalate beyond grant.  
3. Revoke; next command denied.  
4. Audit events present.  

**Pass:** security tests + manual path.

### D6. ESS payslip + leave

1. Employee opens ESS; sees only own payslips.  
2. Download one payslip.  
3. Submit leave request; approver sees it in payroll leave.  
4. No mass email; no admin controls on ESS.  

**Pass:** least privilege + download only.

### D7. Cash scenarios + job-cost loop

1. Create base/downside/upside scenarios; compare; no GL post.  
2. Trace one project: time cost → WIP → invoice → cash apply.  
3. Confirm no double-bill.  

**Pass:** job-costing verify + planning-only cash.

### D8. External accountant sitting

1. Build pack (P6-D).  
2. Walk checklist script in one sitting.  
3. Capture signed checklist artifact (typed name OK).  

**Pass:** checklist PASS or PASS WITH EXCEPTIONS documented.

---

## E. Board workstream map (Phase 6)

| Workstream | Task id | Expected before promote discussion |
| --- | --- | --- |
| Residual research | `ENqHqSQMrpK49AyIMhBm` | done |
| Spec update | `5rOjpXW4VzNsgtCxwz7I` | done |
| Scope approval (dev) | `eqZUnsjDmKnE5tsnNXxX` | done |
| Multi-month + external pack | `O2hbOSJb4gydptVGEOG2` | done + verified |
| Bank feeds daily UX | `6b2T04ZyWNXYn7yB9UAd` | done + verified |
| Provider stub | `vaNKABngcZf4TqYPpVcV` | done + verified |
| Expense claims | `SZRWufZ64Qnr3aqF9YyZ` | done + verified |
| Revenue recognition | `ng0kop4wEjqP68gt3M5f` | done + verified |
| Practice grants | `OpHGMxtFJ4fLXehncO9t` | done + verified |
| ESS PWA | `7f4RaCyCoYdWWShb2dxg` | done + verified |
| Cash scenarios | `MlELj0UlZw2ChNnBlqpJ` | done + verified |
| Job-cost loop | `ioOg7I9jaHtMwQoS2tVU` | done + verified |
| Bulk scale | `vh23AlAoh9E6l5Pvm6fP` | done + verified |
| Keyboard/a11y | `fALOfEzGszHdjYynPHyO` | done + verified |
| Docs runbooks (this) | `upcYUjl6v1R44SC7kd3Z` | done |
| Vera expansion | `pSz1QwT7wC6Q98og327J` | done |
| Quinn suite | `2JNBdajxES3cqzP66Fmw` | done |
| Paid vendor (optional) | `a1NFXI8IbZFsv68rBCIl` | Peet decision; may remain open |
| Peet promote | `oITb4OznO8sTtoTmQwxH` | explicit Peet only |
| Hygiene after promote | `hcxiWte16yN3800y95mu` | after promote |

---

## F. Suggested agentOutput template (Quinn)

```
Phase 6 acceptance: PASS | FAIL | PASS_WITH_EXCEPTIONS
HEAD: <sha>
Branch: development
Automated: security=… unit=… bank-feeds=… proving=… job-costing=… payroll=… (list)
Golden paths: D1…D8 = Pass/Fail/NA
Hard gates: sars=false pay=false massEmail=false autoPost=false egress=false paidVendor=unset
Exceptions: …
Artifacts: [{type, ref, label}, …]
Promote: NOT approved by this pack — see oITb4OznO8sTtoTmQwxH
```

## Safety readback

- Internal staging acceptance only.  
- No client publish from docs or QA cards.  
- No SARS submit, no external payment initiate, no mass email, no bank auto-post.  
- No production promote from this pack alone.  
- No paid bank-feed vendor without `a1NFXI8IbZFsv68rBCIl`.
