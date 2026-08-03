# Phase 4 acceptance pack — Finance competitor parity

**Status:** internal staging acceptance (do not promote production from this pack alone)  
**Date:** 2026-08-02  
**Project:** `HRCSWl1cNnh6fYEGziAb`  
**Source spec:** `Flie3SblIDXvplYmqOhy` (currentVersion expected `oK7CieqaGyuosUPQAT25`)  
**Docs task:** `vlFetrXdGLLdqXw4gUmg`  
**QA owner:** Quinn (`qa-release`) · Reviewer: Pip · Final promote: Peet  
**Branch:** `development` only for ordinary work  
**Onboarding dependency:** `qKZr6XbtjQ6A2BqQrvxz` @ `12b14f8e`

## How to use

1. Work on latest `origin/development`.
2. Run automated gates below; paste command output into the QA task `agentOutput`.
3. Walk human golden paths on staging/preview (not production).
4. Mark each checklist row Pass / Fail / N/A with evidence links.
5. Peet production promote is a **separate** gate (`ZxfIaOp6KO3tlDaDN7lQ` or successor). This pack does not merge to `main`.

## Hard non-goals (must remain false / absent)

| Control | Expected |
| --- | --- |
| SARS e-file submit route/UI | Absent / blocked |
| External payment initiation | Absent / blocked |
| Mass payslip/statement email send | Absent / `massEmailAllowed=false` |
| Bank rule auto-post | Never |
| Packaging external egress | `externalEgressAllowed=false` |
| Ordinary card production promote | Forbidden |

---

## A. Automated gates (run on development checkout)

```bash
git rev-parse --abbrev-ref HEAD   # expect development
git status --short --branch

npm run verify:finance:security
npm run test:finance:unit
npm run verify:finance:foundation
npm run verify:finance:documents
npm run verify:finance:payroll
npm run verify:finance:multi-currency
npm run verify:finance:job-costing
npm run verify:finance:assets

npx jest __tests__/finance/portal-design-system-parity.test.ts \
  __tests__/finance/workbench-delivery.test.ts --runInBand
```

### Pass criteria

| Check | Pass when |
| --- | --- |
| Branch | `development` (not main) |
| Security verify | EXIT 0; `noEgress` / `sarsSubmissionInitiated=false` / `externalPaymentInitiated=false` style gates green |
| Unit finance | EXIT 0 |
| Design-system parity | EXIT 0 |
| Workbench delivery | EXIT 0; HTTP inventory length matches `FINANCE_HTTP_ENTRYPOINTS` |
| Module verifies | Each EXIT 0 for foundation, documents, payroll, FX, job costing, assets |

Record HEAD SHA: `____________________`

---

## B. Quinn checklist (product AC)

| Area | Check | Pass criteria | Evidence |
| --- | --- | --- | --- |
| Branch/deploy | Work on development | No main commits from Phase 4 cards | git log |
| Tenant | Org isolation | Wrong `X-Org-Id` cannot read/write another org book | security tests + practice switcher trial |
| Design system | Portal parity | ModuleShell / PageHeader / Card / Button / HudChip / StatCard / ThemedSelect | parity jest + visual spot check |
| UX hub | Command centre | Entity/book scope, AR/AP/unreconciled/pay-run/packaging stats, deep links | `/portal/finance` |
| AR/AP | Golden path | Invoice → partial pay → credit note → statement totals | documents workbench |
| Bank rules | Human gate | Suggestions only; Accept audits; Dismiss no re-spam | statements + bank-rules |
| FX | Realized vs unrealized | Pay at different rate realizes; reval unrealized only | multi-currency verify |
| Job costing | Time → report | Project report shows labor cost + billed revenue | job-costing verify |
| Payroll | Leave + ESS | Leave impacts when configured; ESS own payslips; lock intact | payroll verify |
| Roles | Least privilege | Bookkeeper cannot approve pay run; practice switcher no leak | practice |
| Onboarding | New org path | Opening TB + invoice + draft pay run without external docs | setup + cutover |
| Non-goal APIs | Negative tests | No SARS submit; no payment initiate; no mass email send | security verify |
| Audit | Explorer + events | Key actions by actor/action/entity/date | practice audit |
| Packaging | Egress flag | Exports succeed with externalEgressAllowed=false | packaging |
| Regression | P1–P3 foundation | IC, cross-org confirm, payroll lock/correct, tax prepare green | unit + module verifies |
| Runbooks | Operator path | In-app `/portal/finance/runbooks` + repo docs present | this pack + runbooks page |
| Evidence | agentOutput | Commit SHAs, commands, routes, hard-gate confirmation | QA task |

---

## C. Portal route smoke (manual)

Open each route under tenant scope; confirm ModuleShell frame, no crash, empty-state next action when empty:

| Route | Role |
| --- | --- |
| `/portal/finance` | Command centre |
| `/portal/finance/setup` | Guided onboarding |
| `/portal/finance/runbooks` | Operator runbooks |
| `/portal/finance/documents` | AR/AP |
| `/portal/finance/ledger` | COA / journals |
| `/portal/finance/reports` | Financial reports |
| `/portal/finance/statements` | Bank import / recon |
| `/portal/finance/bank-rules` | Rules |
| `/portal/finance/tax` | VAT prepare |
| `/portal/finance/payroll` | ZA payroll |
| `/portal/finance/multi-currency` | FX |
| `/portal/finance/job-costing` | Projects costing |
| `/portal/finance/assets` | Fixed assets |
| `/portal/finance/budgets` | Budgets/cashflow |
| `/portal/finance/practice` | Roles / switcher / audit |
| `/portal/finance/cutover` | Opening TB |
| `/portal/finance/packaging` | Download packs |
| `/portal/finance/intercompany` | IC |
| `/portal/finance/cross-org` | Notify/confirm |
| `/portal/finance/personal` | Owner-private books |

---

## D. Board workstream close-out map

| Workstream | Task id | Expected state before promote discussion |
| --- | --- | --- |
| UX hub | `4p1ZBV9vibdhsaeaQSp0` | done + approved |
| AR/AP depth | `bxqKt69UsWvPOizjuWO8` | done + approved |
| Bank rules | `CnMg9ge0t6UHtqMN802t` | done + approved |
| Multi-currency | `iACbzxceanSCnV9zQ4fE` | done + approved |
| Job costing | `jAX4qjJgY1Gx1vMxFB1c` | done + approved |
| Fixed assets | `RnMLfqa2JAmZf8l3Jp6h` | done + approved |
| Budgets/cashflow | `AVijmBwNNnpkAhtNUHDx` | done + approved |
| Payroll maturity | `mXVpPtLOUcxSQt3fzk1b` | done + approved |
| Practice/roles | `g5ULd3s7K20lfdN44PPL` | done + approved |
| Onboarding polish | `qKZr6XbtjQ6A2BqQrvxz` | done @ `12b14f8e` |
| Operator runbooks + this pack | `vlFetrXdGLLdqXw4gUmg` | done with doc + commit evidence |
| QA regression suite | `0jb39DpUrG0AWKI0MFm5` | Quinn executes this pack |
| Peet prod promote | separate gate | only after Quinn green |

---

## E. Evidence template (paste into QA agentOutput)

```text
Phase 4 acceptance pack
HEAD: <sha>
Branch: development
verify:finance:security: PASS|FAIL
test:finance:unit: PASS|FAIL
portal-design-system-parity: PASS|FAIL
workbench-delivery: PASS|FAIL
module verifies: foundation/documents/payroll/fx/job-costing/assets = ...
Golden paths: AR/AP= bank rules= cutover= payroll lock= packaging=
Hard gates: sarsSubmit=false paymentInitiate=false massEmail=false autoPostRules=false egress=false
Runbooks: /portal/finance/runbooks + docs/operations/finance/*
Spec: Flie3SblIDXvplYmqOhy
Project: HRCSWl1cNnh6fYEGziAb
Production promote: NOT requested from this pack
```

## F. Safety readback

- No public publish of client documents without Peet.
- No SARS submit, no payment initiate, no mass payslip/statement email.
- No production promote / main merge from this acceptance pack alone.
- Staging/preview only when Peet asks for a build-triggering push (`[vercel-build]` / `[preview-build]`).

## Related

- Operator runbooks: [operator-runbooks-phase4-2026-08-02.md](./operator-runbooks-phase4-2026-08-02.md)
- Spec mirror: [finance-phase4-product-spec-2026-08-02.md](../../specs/finance-phase4-product-spec-2026-08-02.md)
- Gap map: [finance-phase4-competitor-gap-map-2026-08-02.md](../../research/finance-phase4-competitor-gap-map-2026-08-02.md)
