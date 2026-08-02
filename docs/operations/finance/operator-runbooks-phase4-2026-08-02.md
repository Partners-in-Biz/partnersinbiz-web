# Finance operator runbooks — Phase 4

**Status:** internal operator guide (development/staging first)  
**Date:** 2026-08-02  
**Project:** `HRCSWl1cNnh6fYEGziAb`  
**Canonical product spec:** `Flie3SblIDXvplYmqOhy`  
**Org scope:** always send `X-Org-Id` and use `scopedPortalPath` / `scopedApiPath`  
**Portal:** `/portal/finance/runbooks` · Setup guide: `/portal/finance/setup`

## Purpose

Give operators and agents a single path from empty tenant → opening books → day-2 AR/AP, bank, payroll, packaging — without inventing SARS submit, payment initiate, or mass email rails.

## Hard gates (always on)

| Gate | Operator meaning | Where it shows |
| --- | --- | --- |
| No SARS e-file submit | Tax/payroll/packaging prepare + download only | Tax, Payroll, Packaging, HudChips |
| No external payment initiate | Record/observe/allocate/export instructions only | Documents, Statements, Bank rules, Payroll, Packaging |
| Bank rules never auto-post | Suggestions only; Accept/Dismiss human-gated | Statements, Bank rules |
| Suggestions never auto-post journals | Recon accept is an explicit command | Statements |
| Budgets/cashflow are planning-only | No GL post from planner | Budgets |
| Mass email separately gated | Counterparty statements + payslip packs are download/export | Documents, Payroll |
| Tenant isolation | Wrong org cannot read/write another book | Every command/query |
| Production promote is a Peet gate | Ordinary cards stay on `development` | Kanban / release |

## Tenant and scope checklist

1. Active org is correct in the portal topbar / practice switcher.
2. Finance URLs keep org query params via `scopedPortalPath`.
3. API calls use `scopedApiPath` and `X-Org-Id`.
4. Legal entity + book are selected on workbenches that need them (`FinanceScopeBar`).
5. Practice multi-client switcher only lists orgs the user already belongs to — switch, then re-check entity/book.

Empty hub entity/book pickers mean bootstrap has not run. Do not start with journals.

---

## Runbook A — Day-0 bootstrap (new org / new books)

**Goal:** finance_admin assigned, legal entity + primary book, COA, open period.

| Step | Operator action | Portal | API surface |
| --- | --- | --- | --- |
| A1 | Assign `finance_admin` for the planned legal entity | `/portal/finance/practice` | `POST /api/v1/finance/practice/commands` |
| A2 | Create legal entity + primary book (bootstrap or foundation commands) | `/portal/finance` | `POST /api/v1/finance/foundation/commands` (`legal-entity.create`, `book.create`) |
| A3 | Create chart of accounts | `/portal/finance/ledger` | foundation accounts commands |
| A4 | Open at least one non-overlapping accounting period | `/portal/finance/ledger` | foundation period commands |
| A5 | Confirm hub shows entity/book scope + empty-but-actionable stats | `/portal/finance` | foundation/reports queries |

**Empty states**

- Practice shows no assignments → start at A1, not ledger.
- Empty COA/periods → expected on a new book; create before posting.
- Hub pickers empty → bootstrap missing.

**Done when:** entity + book selectable, COA has core accounts, one open period, hub loads without error.

---

## Runbook B — Opening trial balance / cutover

**Goal:** balanced opening TB + AR/AP open-item recon, approved, `book.cutoverAt` set.

| Step | Operator action | Portal | Notes |
| --- | --- | --- | --- |
| B1 | Create cutover package with opening TB lines | `/portal/finance/cutover` | Must balance |
| B2 | Attach opening AR/AP open items / credits as required | cutover | Control recon against TB |
| B3 | Validate package | cutover | Fix imbalance before approve |
| B4 | Approve with separate approval evidence | cutover | Immutable audit |
| B5 | Activate cutover | cutover | Sets `book.cutoverAt`; materialises opening journal + open_items `sourceType=opening` |

**Hard gates:** no SARS, no payment initiate. Activation is not a production deploy.

**Done when:** opening journal posted, open items reconcilable, hub/reports reflect opening balances.

HTTP: `POST/GET /api/v1/finance/cutover/commands|queries`

---

## Runbook C — AR/AP golden path

**Goal:** invoice → partial payment observe/allocate → credit note → statement totals.

| Step | Operator action | Portal |
| --- | --- | --- |
| C1 | Create customer invoice (issue when ready) | `/portal/finance/documents` |
| C2 | Observe inbound payment; allocate partially | documents |
| C3 | Create/issue credit note; allocate against invoice | documents |
| C4 | Generate customer statement draft/export | documents |
| C5 | Review AR aging (current / 30 / 60 / 90+) | documents + hub |
| C6 | Optional: supplier bill, bill credit, recurring schedule (preview only — no auto external send), bulk issue/void/allocate | documents |

**Empty state:** no documents yet is normal after COA — create first invoice/bill.

**Hard gates:** massEmailAllowed=false on statement drafts; no payment initiation from allocate.

HTTP: `/api/v1/finance/documents/commands|queries`

---

## Runbook D — Bank import, rules, recon

**Goal:** import statement → rule suggestions → human Accept/Dismiss → no silent post.

| Step | Operator action | Portal |
| --- | --- | --- |
| D1 | Import bank statement | `/portal/finance/statements` |
| D2 | Review recon suggestions | statements |
| D3 | Create bank rules (description/amount → account/tax/counterparty suggestion) | `/portal/finance/bank-rules` |
| D4 | Re-import or re-evaluate; confirm rule fires | statements + bank-rules |
| D5 | Accept matched suggestion (audit event) or Dismiss | statements |
| D6 | Confirm dismissed patterns do not re-spam without edit | statements |

**Empty state:** empty suggestion queues mean no unmatched lines or no rules evaluated yet.

**Hard gates:** rules emit suggestions only; Accept never initiates payout; never auto-posts without human action.

HTTP: `/api/v1/finance/statements/*`, `/api/v1/finance/bank-rules/*`

---

## Runbook E — Tax prepare (no submit)

| Step | Action | Portal |
| --- | --- | --- |
| E1 | Configure VAT/tax codes and periods | `/portal/finance/tax` |
| E2 | Prepare return | tax |
| E3 | Approve prepare package | tax |
| E4 | Download/export only | tax / packaging |

**Done when:** return status prepared/approved for export. **Never** e-file to SARS from PiB.

---

## Runbook F — ZA payroll day-2

| Step | Action | Portal |
| --- | --- | --- |
| F1 | Confirm employees, pay profiles, calendar cutoffs | `/portal/finance/payroll` |
| F2 | Configure leave types/balances where used | payroll |
| F3 | Create pay run → calculate → submit for review | payroll |
| F4 | Separate approver locks run | payroll |
| F5 | Download payslip pack (no mass email) | payroll |
| F6 | Employee ESS: linked user views **own** payslip only | payroll ESS |
| F7 | Corrections/reversals only via auditable correction paths — never mutate locked history | payroll |
| F8 | IRP5/IT3(a), EMP201, EMP501 prepare/export only | payroll + packaging |

**Hard gates:** no bank payout, no SARS submit, no mass payslip email.

HTTP: `/api/v1/finance/payroll/commands|queries`

---

## Runbook G — Multi-currency

| Step | Action | Portal |
| --- | --- | --- |
| G1 | Approve immutable accounting rate set (effective dated) | `/portal/finance/multi-currency` |
| G2 | Raise foreign-currency document (currency + rate + functional amount) | documents + FX |
| G3 | Settle at different rate → realized FX | documents / multi-currency |
| G4 | Period-end revaluation journal (balanced; optional reverse-next-period) | multi-currency |
| G5 | Reports in functional currency; document retains original | reports |

HTTP: `/api/v1/finance/multi-currency/*`

---

## Runbook H — Job costing (Projects / time)

| Step | Action | Portal |
| --- | --- | --- |
| H1 | Post bill/invoice/journal lines with `projectId` (optional task) | documents / job-costing |
| H2 | Optionally pull billable time into WIP or draft invoice lines | `/portal/finance/job-costing` |
| H3 | Run project P&L / cost vs revenue | job-costing |
| H4 | Confirm no double-billing of time outside explicit cost/revenue lines | job-costing |

---

## Runbook I — Fixed assets

| Step | Action | Portal |
| --- | --- | --- |
| I1 | Register asset (cost, residual, straight-line, start, GL accounts) | `/portal/finance/assets` |
| I2 | Run depreciation for period (balanced journals) | assets |
| I3 | Dispose with gain/loss; stop future depreciation | assets |

---

## Runbook J — Budgets and cashflow (planning only)

| Step | Action | Portal |
| --- | --- | --- |
| J1 | Create budget version (period × account; optional project/branch) | `/portal/finance/budgets` |
| J2 | Budget vs actual report | budgets |
| J3 | Cashflow planner lite: opening bank + AR + AP + payroll net + adjustments | budgets |
| J4 | Save scenario — **no GL post** | budgets |

---

## Runbook K — Practice, roles, notifications, audit

| Step | Action | Portal |
| --- | --- | --- |
| K1 | Assign finance roles per book/entity (least privilege) | `/portal/finance/practice` |
| K2 | Switch client org via practice switcher; confirm X-Org-Id scope | practice |
| K3 | Confirm bookkeeper cannot approve pay run | practice + payroll |
| K4 | Review in-app notices (pay run submitted, recon awaiting, cutover ready) | practice |
| K5 | Audit explorer filter by actor / action / entity / date | practice |

---

## Runbook L — Packaging downloads

| Pack kind | Use | Gate |
| --- | --- | --- |
| SARS-ready | EMP/VAT prepare packages for accountant | externalEgressAllowed=false; no submit |
| Payment instruction | Export payment files for offline bank capture | no initiate |
| Accountant pack | TB, journals, open items, payroll summaries | download/manifest only |

Portal: `/portal/finance/packaging`  
HTTP: `/api/v1/finance/packaging/commands|queries`

---

## Runbook M — Intercompany and cross-org (differentiators)

| Flow | Portal | Rule |
| --- | --- | --- |
| IC propose → receive confirm → eliminations | `/portal/finance/intercompany` | Linked pairs; no silent mirror without confirm path |
| Cross-org payment notify/confirm | `/portal/finance/cross-org` | Observe/confirm only; CRM linkedOrgId or active businessRelationships |

---

## Runbook N — Agent / Kanban operable finance

Agents must:

1. `GET /api/v1/agent/project/HRCSWl1cNnh6fYEGziAb` before finance board work.
2. Prefer finance HTTP commands/queries over ad-hoc Firestore.
3. Record evidence in `agentOutput` (commit SHA, test commands, routes, hard-gate confirmation).
4. Never call non-existent SARS submit or payment initiate endpoints.
5. Keep client-visible document publish and production promote behind Peet approval.
6. Use this runbook set + `/portal/finance/runbooks` as the operator path; do not invent a permanent CEO dashboard for routine finance ops.

---

## HTTP inventory (commands + queries)

See `lib/finance/service-boundaries.ts` → `FINANCE_HTTP_ENTRYPOINTS` (33 routes). Modules:

foundation, documents, statements, bank-rules, tax, payroll, packaging, cutover, intercompany, personal, cross-org, multi-currency, practice, budgets, assets, job-costing, reports (queries).

## Related acceptance

Staging verification steps and expected commands: [phase4-acceptance-pack-2026-08-02.md](./phase4-acceptance-pack-2026-08-02.md)

## Safety readback

- Document status for product spec remains internal until Peet promotes.
- These runbooks do not authorise production deploy, main merge, SARS submit, payment initiate, or mass finance/payroll email.
