# Phase 4 competitor gap map — PiB Finance vs SA SMB / agency tools

**Research task:** `IzVNzZRz2dmhhrgJuxHA`  
**Project:** `HRCSWl1cNnh6fYEGziAb` — Partners in Biz Finance, Accounting & South African Payroll  
**Source spec:** `Flie3SblIDXvplYmqOhy`  
**Org:** `pib-platform-owner`  
**Author:** Sage (research)  
**Date:** 2026-08-02  
**Visibility:** internal  

## Decision (for Phase 4 product direction)

Phase 4 should **not** try to out-feature global GL suites on every accounting module. It should close the **operator-parity gaps** that make Xero/Sage/QBO feel finished for day-to-day books, while doubling down on three PiB wedges:

1. **Multi-entity + intercompany inside one portal org** (already a structural head-start vs vanilla QBO / multi-file Xero).
2. **CRM / Projects / time-linked finance** (agency native job costing — competitors bolt this on).
3. **ZA payroll maturity in the same product as books** (vs Xero+SimplePay or Sage Accounting+Payroll split), with **export/packaging only** (no SARS e-file submit, no payment initiation).

**Must-have for Phase 4 (rival table stakes):** UX hub polish, AR/AP depth, bank rules (human-gated), multi-currency books/FX, payroll leave + ESS payslips, roles/practice multi-client switcher + audit explorer, guided onboarding/cutover polish.

**Differentiators (build deliberately, not as afterthoughts):** project/job costing linked to PiB Projects + time entries; multi-entity consolidation already present; cross-org payment notify/confirm; unified finance+ZA payroll packaging; agent/Kanban-operable finance surfaces.

**Explicit non-goals (unchanged):** no SARS e-filing submit; no external bank/payment initiation; no mass client-visible email of statements/payslips without separate approval.

---

## Evidence basis

### Internal (verified in repo / platform)

| Source | What it confirms |
| --- | --- |
| Spec `Flie3SblIDXvplYmqOhy` v `DCAh9tNOlloqSOwYSUP2` | Multi-entity books; double-entry; VAT; AR/AP observe-not-initiate; SA payroll lock/correct; IRP5/EMP201/EMP501-ready; SARS submit & auto-pay out of R1 |
| `/portal/finance/*` routes | Hub + ledger, setup, reports, tax, documents, intercompany, payroll, personal, cross-org, statements, cutover, packaging |
| `lib/finance/service-boundaries.ts` | Phase 2–3 live: statement import + human-gated recon suggestions; cutover; packaging with `externalEgressAllowed=false` |
| Finance command surfaces | Invoices/bills/payments/recon; journals post/reverse; IC propose/confirm/elim/consolidation; payroll full run lifecycle + statutory prepare/approve; no credit-note/recurring/FX/assets/budget/job-cost commands found |
| Project Phase 4 board | 17 competitor-parity tasks already chained off this research + `BKF7tuwiI5DPguKgktQF` spec update |

### External (public product pages / reviews; snapshot ~2026-08)

| Competitor | Primary evidence | Role in map |
| --- | --- | --- |
| Xero ZA | xero.com/za feature + pricing pages; multi-currency, projects, HQ/practice, bank feeds; payroll partner path | Cloud SMB GL + practice standard |
| Sage Business Cloud Accounting + Payroll (ZA) | sage.com/en-za; multi-company add-on pricing; NetCash payments; payroll integration | ZA SMB accounting+payroll bundle |
| QuickBooks Online / Advanced | intuit feature matrix; Advanced fixed assets, budgets, projects; weak native multi-entity (IES for true multi-entity) | Global SMB GL depth benchmark |
| SimplePay | simplepay.co.za/features | ZA payroll specialist (not full GL) |
| PaySpace | payspace.com product pages | Multi-company / multi-country HCM payroll |
| Practice multi-client | Xero HQ / QBO Accountant positioning | Agency & bookkeeper UX benchmark |

Confidence: **high** on PiB current capability (code). **medium-high** on competitor feature presence (vendor marketing + secondary reviews; not a live product trial). Treat competitor cells as “publicly claimed / widely reported,” not certified audit of every plan tier.

---

## Competitor snapshots

### Xero (ZA SMB / firms)

- Strengths: polished AR/AP (invoices, bills, credit notes, repeating docs, statements), bank feeds + **bank rules**, multi-currency, **projects/job tracking**, inventory, expense claims, cash coding, practice tools (Xero HQ / multi-org), ecosystem apps (fixed assets often via app or higher workflow).
- Payroll in ZA: typically **partner** path (e.g. SimplePay) rather than deep native SA statutory in core GL.
- Multi-entity: multi-org/files + consolidation apps/practice patterns; not the same as first-class intercompany + elimination books inside one product model.
- Payments: strong “get paid / pay bills” product motion (opposite of PiB R1 non-goal).

### Sage Business Cloud Accounting (ZA) + Sage Payroll

- Strengths: ZA-local SMB accounting, VAT, multi-company add-ons (priced per extra company), inventory/debtors add-ons, NetCash payment rails (ZA), **native payroll companion** with PAYE/UIF/SDL and salary journals into accounting.
- Weak vs PiB wedge: not CRM/project OS; practice multi-client is accountant-channel oriented, not PiB portal multi-product.
- Multi-company supported commercially; consolidation/intercompany depth varies vs ERP-class tools.

### QuickBooks Online (+ Advanced / IES)

- Strengths: AR/AP maturity, bank rules, projects/profitability, budgets & cash-flow tools, multi-currency (plan-gated), **fixed assets + depreciation on Advanced**, batch ops, accountant firm tools.
- Gap: **native multi-entity / eliminations are not QBO core** — Advanced still multi-company reporting workarounds; true multi-entity pushed to Intuit Enterprise Suite.
- ZA payroll: not the SimplePay-class SA statutory depth inside QBO core.

### SimplePay

- Strengths: SA payroll processing, PAYE/UIF/SDL, leave, ESS (payslips/leave/claims), EMP201 + UIF declarations, tax certificate export for eFiling/e@syFile upload, bank payment **files**, Xero/QBO journal sync.
- Not a GL competitor — **payroll maturity bar** for PiB Phase 4 payroll cards.
- PiB non-goal alignment: SimplePay does filing helpers and payment files; PiB stays at prepare/approve/export packs only unless later approval expands scope.

### PaySpace

- Strengths: multi-company payroll, multi-country HCM orientation, ESS, leave, org structures, enterprise payroll ops.
- Use as **upper bound** for payroll multi-entity / ESS maturity, not as GL feature template.

### Multi-client practice tools (Xero HQ, QBO Accountant, generic practice suites)

- Strengths: client switcher, work queues, staff roles, notification digests, standardised onboarding checklists, bulk period close patterns.
- Direct input to Phase 4 cards: `g5ULd3s7K20lfdN44PPL` (roles/practice) and `qKZr6XbtjQ6A2BqQrvxz` (onboarding).

---

## PiB current posture (as of this research)

**Already strong / live foundation**

| Area | PiB status | Competitor parity note |
| --- | --- | --- |
| Multi-entity, branches, books | Live foundation + UI | Ahead of vanilla QBO; comparable intent to Sage multi-company / Xero multi-org, with **IC + eliminations** as first-class |
| Double-entry, periods, COA, journal post/reverse | Live | Table stakes met at model level |
| VAT/tax codes, tax return prepare/approve | Live (no submit) | Parity on prepare; submit is intentional non-goal |
| Invoices, supplier bills, payment observe/allocate, bank import, recon approve | Live | Functional core; **depth** lags (credit notes, recurring, statements, bulk) |
| Statement import + recon **suggestions** (human-gated) | Live Phase 2 | Partial bank-rules story; missing durable rule engine UX |
| Intercompany + consolidation eliminations | Live | Differentiator vs QBO core / many SMB tools |
| Cross-org payment notify/confirm | Live | Differentiator for multi-tenant agency networks |
| SA payroll run lock/correct/reverse + IRP5/EMP201/EMP501 prepare | Live | Strong core vs needing third-party payroll; ESS/leave polish lag SimplePay |
| Cutover packages + packaging exports | Live Phase 3 | Differentiator for controlled cutover; no pay initiate / no SARS submit |
| Roles (finance_admin etc.) | Bootstrap exists | Practice switcher + notification/audit explorer incomplete |

**Material gaps vs Phase 4 board / competitors**

| Gap | Best competitor bar | Phase 4 task id |
| --- | --- | --- |
| UX hub / design-system command centre | Xero/QBO polish | `4p1ZBV9vibdhsaeaQSp0` |
| AR/AP depth: credit notes, recurring, statements, bulk | Xero / QBO | `bxqKt69UsWvPOizjuWO8` |
| Bank rules + recon intelligence (apply human-gated) | Xero / QBO | `CnMg9ge0t6UHtqMN802t` |
| Multi-currency + FX revaluation journals | Xero / QBO | `iACbzxceanSCnV9zQ4fE` |
| Job costing ↔ Projects/time | Xero Projects / QBO Projects | `jAX4qjJgY1Gx1vMxFB1c` |
| Fixed assets + depreciation | QBO Advanced | `RnMLfqa2JAmZf8l3Jp6h` |
| Budgets / forecasts / cashflow planner | QBO / Xero | `AVijmBwNNnpkAhtNUHDx` |
| Payroll calendar/leave/ESS payslips | SimplePay / PaySpace | `mXVpPtLOUcxSQt3fzk1b` |
| Roles, practice multi-client, notifications, audit explorer | Xero HQ / QBO Accountant | `g5ULd3s7K20lfdN44PPL` |
| Guided onboarding + cutover polish | All majors | `qKZr6XbtjQ6A2BqQrvxz` |

---

## Gap matrix (summary scores)

Legend: **S** strong / live · **P** partial · **W** weak/missing · **N** non-goal · **D** differentiator opportunity  

| Capability | PiB | Xero | Sage Acct+Pay | QBO | SimplePay | PaySpace | Rank |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UX hub / navigation polish | P | S | S | S | S | S | **Must-have** |
| Multi-entity separate books | S | P–S | S | W–P | P (companies) | S (payroll orgs) | Must-have (hold) |
| Intercompany + eliminations | S | P | P | W | N | N | **Differentiator** |
| Double-entry + audit | S | S | S | S | N | N | Must-have (hold) |
| AR/AP core issue/pay/match | P–S | S | S | S | N | N | Must-have deepen |
| Credit notes / recurring / statements / bulk | W | S | S | S | N | N | **Must-have** |
| Bank feeds/import | P | S | S | S | N | N | Must-have |
| Bank rules (human-gated apply) | P (suggestions) | S | P–S | S | N | N | **Must-have** |
| Multi-currency + reval | W–P | S | P–S | S | N | P | **Must-have** |
| Job costing / projects | W | S | P | S | N | N | **Differentiator if CRM-linked** |
| CRM/project OS linkage | D (native path) | P (apps) | W | P | W | W | **Differentiator** |
| Fixed assets | W | P (app/eco) | P | S (Adv) | N | N | Differentiator / later P1 |
| Budgets & cashflow | W | S | P | S | N | N | Must-have lite → full |
| ZA payroll calc PAYE/UIF/SDL | S core | P partner | S | W ZA | S | S | Must-have (hold) |
| Leave + ESS payslips | W–P | via partner | S | P | S | S | **Must-have** |
| IRP5/EMP201/EMP501 ready + export | S prepare | via partner | S | W | S (+ upload helpers) | S | Must-have (hold) |
| SARS e-file submit | N | partner | product path | N/W | helpers | product path | **Non-goal** |
| Payment initiation / ACB | N | S | S (NetCash) | S | payment files | payment files | **Non-goal** |
| Practice multi-client switcher | W–P | S (HQ) | P | S (Acct) | P | P | **Must-have** |
| Roles / approvals / audit explorer | P | S | S | S | P | S | **Must-have** |
| Onboarding / cutover | P | S | S | S | S | S | **Must-have** |
| Cross-org multi-tenant pay confirm | S | W | W | W | W | W | **Differentiator** |

---

## Ranking detail: must-have vs differentiator

### Must-have (Phase 4 cannot claim competitor parity without these)

1. **UX hub command centre** — same ModuleShell/PageHeader/Card/StatCard patterns as billing/CRM; empty/loading/error; book/entity scope always visible.
2. **AR/AP depth** — credit notes; recurring invoices/bills; customer/supplier statements; bulk issue/void/allocate; aging views.
3. **Bank rules** — save match patterns; suggest on import; **human accept/dismiss only** (extend existing suggestion model; never auto-post).
4. **Multi-currency** — book/entity currency already in model path; need rates, realized/unrealized FX journals, report presentation.
5. **Payroll maturity** — leave balances/requests (admin-first OK), pay calendar UX, employee self-serve **view** payslips (no mass email blast).
6. **Roles + practice** — multi-client/org switcher for accountants serving multiple PiB orgs; notification hooks; audit event explorer.
7. **Onboarding** — guided first book, sample COA, cutover checklist polish, operator empty states.

### Differentiator (build to win agencies / multi-entity SA groups)

1. **Job costing linked to PiB Projects + time** — WIP, project P&amp;L, billable utilization → invoice draft (finance read of existing time APIs).
2. **Keep/extend multi-entity IC + consolidation** — competitors charge apps or force multi-file; PiB should make this the default story for groups.
3. **Cross-org payment notify/confirm** — unique to PiB tenant graph / CRM linkedOrg relationships.
4. **Unified books + ZA payroll packaging** — one portal, one audit model, export packs without filing/payment rails.
5. **Agent-operable finance** — commands already structured; expose clear operator runbooks + Kanban evidence (docs/qa cards).

### Stretch / priority-second inside Phase 4

- **Fixed assets + depreciation** — needed for parity with QBO Advanced; can ship after AR/AP + bank rules if capacity tight.
- **Full budgets/forecasts/cashflow planner** — ship **cashflow lite** (AR/AP + payroll obligations + bank balance projection) before full budget versions if forced to cut.

### Non-goals (do not schedule as Phase 4 parity work)

- SARS e-filing submit / auto SARS payment  
- External payment initiation (EFT/ACB/card capture as money movement)  
- Mass client-visible statement/payslip email campaigns  
- Production promote / main merge from this research task  

---

## Acceptance criteria by workstream

Use these as Definition of Done inputs for docs task `BKF7tuwiI5DPguKgktQF` and implementation cards. All surfaces: `scopedPortalPath` / `scopedApiPath` + `X-Org-Id` tenant isolation; ModuleShell look-and-feel.

### 1) UX hub (`4p1ZBV9vibdhsaeaQSp0`)

- `/portal/finance` is a command centre: entity/book scope, key stats (open AR/AP, unreconciled, pay runs needing approval, packaging ready), deep links to all submodules.
- Shared loading/empty/error; HudChip status for book period open/closed; no separate “finance skin.”
- Keyboard-accessible primary actions; mobile-usable tables via existing portal patterns.

### 2) AR/AP depth (`bxqKt69UsWvPOizjuWO8`)

- Credit note create/issue/allocate against invoice; supplier debit/credit equivalent or bill credit.
- Recurring invoice/bill schedules with next-run preview (no auto external send).
- Customer & supplier statements (PDF/download) with opening/closing balance.
- Bulk select: issue, void, payment allocate; AR/AP aging report (current/30/60/90+).
- Acceptance: golden-path test covers invoice → partial pay → credit note → statement totals.

### 3) Bank rules (`CnMg9ge0t6UHtqMN802t`)

- Rule fields: match text/amount band/account → suggested counterparty + ledger account + tax code.
- On statement import, rules generate suggestions; operator Accept/Dismiss only.
- Audit event on accept; never posts without human action.
- Acceptance: same rule fires on second import; dismissed patterns do not re-spam without edit.

### 4) Multi-currency (`iACbzxceanSCnV9zQ4fE`)

- Book functional currency; foreign-currency documents store currency + rate + functional amount.
- Rate source manual or import; period-end revaluation journal (balanced) with reverse-next-period option.
- Reports can present functional currency; document retains original currency.
- Acceptance: FX invoice + payment at different rate produces realized FX; reval changes unrealized only.

### 5) Job costing (`jAX4qjJgY1Gx1vMxFB1c`)

- Dimension: `projectId` (and optional task) on journal lines / bill lines / invoice lines.
- Pull billable time entries into WIP or draft invoice lines (read existing time APIs).
- Project P&amp;L / cost vs revenue report for a book.
- Acceptance: time on project → finance line → project report shows labor cost and billed revenue.

### 6) Fixed assets (`RnMLfqa2JAmZf8l3Jp6h`)

- Asset register: cost, residual, method (straight-line min), start date, GL accounts.
- Depreciation run posts period journals; dispose with gain/loss journal.
- Acceptance: 12-month asset produces 12 balanced dep journals; dispose stops future runs.

### 7) Budgets / cashflow (`AVijmBwNNnpkAhtNUHDx`)

- Budget versions by period × account (and optional project/branch).
- Budget vs actual report.
- Cashflow planner lite: opening bank + forecast AR collections + AP + payroll net + manual adjustments.
- Acceptance: budget import/create; variance report; cashflow scenario saved without posting GL.

### 8) Payroll maturity (`mXVpPtLOUcxSQt3fzk1b`)

- Leave types, balances, accruals hook into pay components where configured.
- Pay calendar UX for monthly/weekly; cutoff visibility.
- Employee self-serve **read** payslip (authenticated portal user linked to employee); no mass email.
- Acceptance: leave affects pay run calculation when configured; employee sees only own payslips; locked run unchanged.

### 9) Roles / practice (`g5ULd3s7K20lfdN44PPL`)

- Role matrix enforced on every command (already partial); UI to assign roles per book/entity.
- Practice multi-client switcher: accountant user with access to multiple orgs lands correct `X-Org-Id` scope.
- Notifications: pay run submitted, recon awaiting approval, cutover ready (in-app first).
- Audit explorer: filter finance_audit_events by actor, action, entity, date.
- Acceptance: bookkeeper cannot approve pay run; practice user switches org without leaking data.

### 10) Onboarding (`qKZr6XbtjQ6A2BqQrvxz`)

- Guided checklist: entity → book → COA → opening TB/cutover → bank → first invoice → first pay run.
- Empty states with next action CTA on every submodule.
- Acceptance: new org can reach posted opening balances + one invoice + one draft pay run without docs outside UI.

### Cross-cutting non-goals checks (every card)

- No API path submits to SARS e-filing.
- No API path initiates external bank payment; payment instruction **export** only.
- No unsolicited client-visible statement/payslip email send.

---

## Recommended Phase 4 sequencing (evidence → delivery)

```
Research (this) → Spec update BKF7… → UX hub (parallel foundation)
  → AR/AP depth + Bank rules (operator daily path)
  → Multi-currency (if multi-currency books already sold/needed; else immediately after AR/AP)
  → Payroll leave/ESS (parallel after hub)
  → Roles/practice + Onboarding (parallel)
  → Job costing (differentiator; needs Projects/time contracts stable)
  → Cashflow lite then budgets
  → Fixed assets
  → Docs pack + QA suite → Peet promote gate ZxfIaOp6…
```

**Why this order:** close daily-operator embarrassment gaps first (Xero/QBO feel), protect ZA payroll completeness vs SimplePay, then spend unique engineering on job costing + practice switcher where PiB wins agencies.

---

## Implications for the three strategic wedges

### Multi-entity

- **Hold and productize** existing IC/consolidation; competitors are weaker or app-dependent.
- Must-have around it: multi-currency, roles per entity, consolidation UX polish inside hub — not a rewrite.

### CRM / project-linked finance

- Largest whitespace vs pure accounting tools.
- Job costing card is the thin end; later: quote→project→time→invoice→cash application closed loop (out of pure Phase 4 unless capacity).

### ZA payroll

- Core calc/lock/statutory prepare is a moat vs Xero core.
- Must reach SimplePay-class **operator experience** on leave + ESS view + calendar before claiming payroll product maturity.
- Stay disciplined on **export vs submit** and **observe vs initiate**.

---

## Open questions (do not block Phase 4 start)

1. Is multi-currency required for the first paying multi-entity cohort, or ZAR-only groups first?
2. ESS payslips: portal-only vs future mobile — portal-only is enough for Phase 4.
3. Fixed assets: ship in Phase 4 or park behind AR/AP+rules if engineering capacity slips?
4. Practice switcher: same user membership across orgs only, or true firm→client grant model? (recommend membership + finance role assignment first.)

---

## Artifacts & links

| Artifact | Ref |
| --- | --- |
| Project | `HRCSWl1cNnh6fYEGziAb` |
| Spec | `Flie3SblIDXvplYmqOhy` |
| This research task | `IzVNzZRz2dmhhrgJuxHA` |
| Research item | `6OjqsbjAGkZue9vmTUbD` (status verified, internal) |
| Project wiki doc | `LWonOIrWrCWXkIZYL3JA` |
| Dependency hygiene | `0z3fMPX4siAUcWIlfaES` |
| Downstream spec update | `BKF7tuwiI5DPguKgktQF` |
| Repo durable doc | `docs/research/finance-phase4-competitor-gap-map-2026-08-02.md` |
| Matrix HTML (throwaway visual) | `docs/research/finance-phase4-competitor-gap-map-matrix-2026-08-02.html` |
| Repo commits | `6cc8307ea961630ff8b3c169d9dfbead320f1741`, `adae5cb954e05334475d19cfc52a4e83e5c3e259` |
| Mac Cowork wiki topic | `/Users/peetstander/.hermes/cowork-wiki/agents/partners/wiki/finance-phase4-competitor-gap-map-2026-08-02.md` |
| Mac hot / log / index | `.../wiki/hot.md`, `.../logs/2026-08-02.md`, `.../index.md` |
| VPS wiki path | `/var/lib/hermes/cowork-wiki/agents/partners/wiki/finance-phase4-competitor-gap-map-2026-08-02.md` (sync when SSH available; not verified if offline) |

### Evidence hygiene (Pip review rework 2026-08-02)

- Durable repo paths are real on `origin/development` at the SHAs above.
- Findings f1–f4 and recommendations r1–r3 on Research `6OjqsbjAGkZue9vmTUbD` carry non-empty `sourceIds`.
- Source `fh62QHuK1Q9p4Vgr9mo5` is verified for repo markdown/HTML + commits only.
- Mac Cowork wiki topic + hot.md + 2026-08-02 log + index.md are the Sage-runtime knowledge persistence surface.
- Non-goals unchanged: no SARS e-file submit; no payment initiation; no mass client-visible statement/payslip email; no production deploy from this card.

## Safety readback

- Read-only competitor research + internal inventory.
- No client outreach.
- No SARS submit, payment initiation, production deploy, or main promote.
- No CRM/finance data mutations for clients.
