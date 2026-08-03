# Phase 5 residual gap map — post-Phase-4 world-class program

**Research task:** `rJGYtdSsd6hMqcCgqivH`  
**Research item:** `MjAevubofvCcbLOFsD5v`  
**Project:** `HRCSWl1cNnh6fYEGziAb` — Partners in Biz Finance, Accounting & South African Payroll  
**Source spec:** `Flie3SblIDXvplYmqOhy`  
**Org:** `pib-platform-owner`  
**Author:** Sage (research)  
**Date:** 2026-08-03  
**Visibility:** internal  
**Inventory HEAD (at research):** `f49c146e3dfe3725481f28250d87cd0532117b05` on `origin/development`  
**Prior gap map:** `docs/research/finance-phase4-competitor-gap-map-2026-08-02.md` (task `IzVNzZRz2dmhhrgJuxHA`, research `6OjqsbjAGkZue9vmTUbD`)

---

## Decision (CEO-facing)

**Is finance world-class after Phase 4 board close (44/44)? No.**

Phase 4 closed the **feature-table-stakes** that previously made PiB look unfinished versus Xero / Sage Business Cloud Accounting+Payroll / QBO Advanced / SimplePay / PaySpace on daily operator paths. That is necessary but not sufficient for a world-class claim.

World-class for SA SMB / agency / multi-entity means:

1. Features exist **and** survive multi-period real books (proving kit + browser golden paths).
2. Operators finish edge cases without spreadsheets (bulk depth, period-close blockers, role-dense UX).
3. Bank data arrives continuously (connector framework), still human-gated — not only CSV/OFX/MT940 upload.
4. Payroll can be run as a **bureau-like** multi-entity batch with SimplePay-class packaging experience (export-only, still no SARS submit / no pay initiate).
5. Light stock + COGS exists where product businesses touch AR (not full WMS).
6. Payment instruction packs match bank upload formats operators actually use (observe-only files).
7. Independent calc/security audit (Vera) + release QA (Quinn) + Peet promote gates stay hard.

**Phase 5 is a proving + density + selective depth program**, not another “build every missing module” phase. Hold multi-entity IC, cross-org pay confirm, unified ZA payroll packaging, and Projects-linked job costing as wedges. Do not chase payment rails or SARS e-file.

---

## Evidence basis

### Internal (verified on development HEAD)

| Source | Confirms |
| --- | --- |
| `components/finance/financeRoutes.ts` | 20 route keys live in nav: hub, documents, ledger, reports, tax, payroll, assets, job-costing, packaging, statements, bank-rules, budgets, intercompany, personal, cross-org, cutover, multi-currency, practice, setup, runbooks |
| `app/(portal)/portal/finance/**/page.tsx` | Matching portal pages present for all Phase 4 surfaces including assets, bank-rules, budgets, multi-currency, practice, job-costing, runbooks |
| `lib/finance/service-boundaries.ts` | 33 HTTP entrypoints (commands+queries) across assets, bank-rules, budgets, cross-org, cutover, documents, foundation, intercompany, job-costing, multi-currency, packaging, payroll, personal, practice, reports, statements, tax; `FINANCE_UI_SHIPPED=true`; hard gates: no SARS submit, no pay initiate, bank rules never auto-post, packaging `externalEgressAllowed=false`, counterparty statements `massEmailAllowed=false` |
| `lib/finance/policy.ts` `FinanceAction` | Full AR/AP depth actions (credit/debit notes, recurring, statement draft, bulk issue/void/allocate, aging, attachments); bank import/recon; IC/consolidation; payroll leave + ESS payslip reads; job costing; assets; practice roles/audit/notifications |
| Module types | Bank rules suggest-only; statements csv/ofx/mt940; packaging kinds sars.* + payment.eft_instructions + payment.payroll_net + accountant.*; FX rate sets + reval; budgets/forecast/cashflow.plan; cutover activate; cross-org notify/confirm |
| `__tests__/finance/*` | Broad unit/domain coverage; **no Playwright e2e golden-path suite** found under repo e2e for finance |
| CRM inventory APIs | `inventory-items` exists in CRM OS (quote→order→shipment reserve) — **not** finance COGS/stock-lite GL linkage |
| Project board Phase 5 sketches | Pending cards: proving kit `QkRVcgafdbuklU2hQyPs`, e2e `ByV0Q2WwB3XbpQavF82W`, operator depth `T5BOeWaQR0XGpb39VfuY`, bank feed `Bsk58c2oq7BuMKhLFcHm`, role UX `2W79LIFTV5v12J8CTW56`, payroll bureau `0KqsOlaCnVo6JomTdB8F`, inventory/COGS `m6P7jrp57im6pTp2Z56i`, payment formats `GiLXtg26kg477b2BYYul`, Phase 5 spec `y2BDxF7Iw78ShKRlGke3`, Peet gate `iA0dOv2NYxDjNim4S8L8` |
| Phase 4 acceptance pack | `docs/operations/finance/phase4-acceptance-pack-2026-08-02.md` — automated module verifies + manual route smoke; production promote separate |
| Wiki / prior research | Phase 4 gap map and QA go notes in agents/partners wiki |

**Confidence (PiB inventory):** high (code + board + prior QA docs).  
**Confidence (competitor cells):** medium-high (public vendor pages / reviews; not live product trial of every plan tier).

### External (public product claims; snapshot ~2026-08)

| Competitor | Primary public evidence | Residual bar for PiB |
| --- | --- | --- |
| Xero ZA | Bank feeds + bank rules (approve OK); multi-currency; inventory; projects; practice/HQ; ZA payroll via SimplePay partner + eFiling helpers | Continuous bank feed UX; inventory; polish/density; practice queue maturity |
| Sage Business Cloud Accounting + Payroll (ZA) | Multi-company add-ons; Advanced Inventory add-on; multi-currency on higher tiers; native payroll companion; NetCash payment rails | Inventory; multi-company ops polish; payment **files** (PiB export-only) |
| QuickBooks Online / Advanced | Bank rules/feeds; budgets; projects; fixed assets (Advanced); real-time inventory (Plus/Advanced, not warehouse-class); multi-entity weak in core (IES for true multi-entity) | Inventory/COGS lite; e2e operator density; assets already roughly met in model |
| SimplePay | Leave, ESS app, EMP201 for eFiling upload, UIF declaration helpers, bank payment files, Xero/QBO journals | Bureau batch UX, leave calendar depth, payment file formats, mobile ESS (stretch) |
| PaySpace | Multi-company / multi-country HCM payroll, ESS, org structures | Upper bound for multi-entity payroll bureau depth — not GL template |

---

## Live PiB capability inventory (post-Phase-4)

Legend: **S** strong/live · **P** partial · **W** weak/missing · **N** non-goal · **D** differentiator

### A. Portal + HTTP surface (shipped)

| Surface | Route / API | Status | Notes |
| --- | --- | --- | --- |
| Command hub | `/portal/finance` | S | Design-system command centre; scope bar; stats |
| Setup / onboarding | `/portal/finance/setup` | S | Guided bootstrap |
| Runbooks | `/portal/finance/runbooks` | S | Operator day-0/day-2 pointers |
| AR/AP documents | `/portal/finance/documents` + documents HTTP | S | Credit/debit notes, recurring, statements draft/export, bulk, aging, attachments |
| Ledger | `/portal/finance/ledger` + foundation HTTP | S | Periods, COA, journal post/reverse |
| Reports | `/portal/finance/reports` | S | TB / P&L / BS |
| Tax | `/portal/finance/tax` | S | Codes, prepare/approve return — no SARS submit |
| Payroll | `/portal/finance/payroll` | S–P | Calc, lock/correct/reverse, leave, ESS payslip read, statutory prepare — bureau depth residual |
| Statements import | `/portal/finance/statements` | P–S | File import csv/ofx/mt940 + human-gated recon suggestions; **no live bank feed connector** |
| Bank rules | `/portal/finance/bank-rules` | S | Configure/evaluate; accept/dismiss only; never auto-post |
| Multi-currency | `/portal/finance/multi-currency` | S | Rate sets, reval journals, functional reports |
| Job costing | `/portal/finance/job-costing` | S | Project dimensions, P&L/WIP, time cost apply without double-bill |
| Assets | `/portal/finance/assets` | S | Register, SL dep, dispose, NBV reports |
| Budgets / cashflow | `/portal/finance/budgets` | S | Budget/forecast/cashflow plan — planning only |
| Practice | `/portal/finance/practice` | S–P | Role matrix, multi-client switcher (membership), notifications, audit explorer — role-dense guided UX residual |
| Intercompany | `/portal/finance/intercompany` | S | Pair/propose/receive/elim/consolidation |
| Cross-org | `/portal/finance/cross-org` | S | Notify/confirm/dispute — no initiate |
| Personal books | `/portal/finance/personal` | S | Owner-private |
| Cutover | `/portal/finance/cutover` | S | Opening TB package validate/approve/activate |
| Packaging | `/portal/finance/packaging` | S–P | SARS-ready + accountant packs + eft_instructions + payroll_net; **not** full ACB/NetCash bank-file matrix |
| Inventory/COGS in finance | — | W | CRM inventory-items ERP-lite only; no finance stock + COGS journals |
| Playwright finance e2e | — | W | Unit/module verifies strong; browser golden paths pending Phase 5 |
| Demo company multi-period fixture | — | W | Acceptance pack manual; no durable proving kit artifact yet |

### B. Hard gates (must remain true)

| Gate | Code posture |
| --- | --- |
| SARS e-file submit | Absent / `sarsSubmissionInitiated=false` |
| External payment initiation | Absent / observe + export only |
| Bank rule auto-post | Never — suggestions only |
| Packaging egress | `externalEgressAllowed=false` |
| Mass statement/payslip email | `massEmailAllowed=false` on statement export path |
| Ordinary agent production promote | Forbidden without Peet gate |

---

## Residual gap matrix vs competitors

| Capability | PiB post-P4 | Xero | Sage Acct+Pay | QBO Adv | SimplePay | PaySpace | Phase 5 rank |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Feature modules (AR/AP depth, FX, assets, budgets, bank rules, job cost, practice, IC) | S | S | S | S | N (GL) | N (GL) | Hold |
| Multi-entity + eliminations | S | P | P–S | W–P | P cos | S orgs | Hold / Diff |
| Cross-org pay confirm | S | W | W | W | W | W | Hold / Diff |
| Unified ZA payroll in books product | S core | Partner | S | W ZA | S | S | Hold |
| Continuous bank feeds | W (file only) | S | S | S | N | N | **Must-have** (mock-first framework) |
| Operator bulk / period-close density | P | S | S | S | P | S | **Must-have** |
| Browser e2e golden paths | W | (vendor QA) | (vendor) | (vendor) | (vendor) | (vendor) | **Must-have** |
| Real-world proving kit / multi-period close | W–P | S demos | S | S | S demos | S | **Must-have** |
| Role-specific guided UX | P | S | S | S | S ESS | S | **Must-have** |
| Payroll bureau multi-entity batch | P | via partner | S | W | S | S | **Must-have** (lite) → Diff |
| Payment bank-file formats (export) | P (eft + payroll_net) | S rails | NetCash | S rails | Payment files | Payment files | **Must-have** observe-only expansion |
| Inventory + COGS | W (CRM only) | S | Adv Inventory | S lite | N | N | **Differentiator** for product SMBs / Stretch for pure agency |
| Mobile ESS | W | via partner | P–S | P | S app | S | Stretch |
| Full WMS / manufacturing inventory | N | P | P | W–P | N | N | **Non-goal** |
| SARS e-file submit | N | partner path | product path | N/W | helpers/upload | product path | **Non-goal** |
| Payment initiation / open banking pay | N | S | S | S | files | files | **Non-goal** |
| Paid bank-feed vendor contract without approval | N | S | S | S | N | N | **Non-goal** until Peet approves vendor |
| Independent calc audit (Vera) | W (not yet scheduled evidence) | n/a | n/a | n/a | n/a | n/a | **Must-have** internal |
| Quinn e2e + Peet promote | P (unit QA done; e2e/promote open) | n/a | n/a | n/a | n/a | n/a | **Must-have** internal |

---

## Ranked Phase 5 program (sketched board → decision ranks)

### Must-have (cannot claim world-class without)

1. **Real-world proving kit** (`QkRVcgafdbuklU2hQyPs`)  
   Demo company, seeded multi-entity books, multi-period close fixture, accountant acceptance pack that a human can run in one sitting. Proves IC, FX reval, payroll lock, packaging, cutover without tribal knowledge.

2. **Browser e2e golden paths** (`ByV0Q2WwB3XbpQavF82W`)  
   Playwright (or equivalent) smoke: hub → AR/AP credit path → bank rule accept → payroll lock → packaging download → hard-gate negatives. Unit verifies are not enough for world-class confidence.

3. **Operator edge-case depth / bulk polish** (`T5BOeWaQR0XGpb39VfuY`)  
   Advanced filters, bulk actions completeness, period-close command centre blockers (unreconciled, unapproved pay runs, open FX reval, incomplete cutover checks). Closes the “feels unfinished under load” gap vs Xero/QBO.

4. **Bank feed connector framework — mock-first** (`Bsk58c2oq7BuMKhLFcHm`)  
   Provider interface + sync jobs + statement materialization into existing import/suggestion pipeline; **human-gated apply only**; no pay initiate; no paid vendor contract without separate Peet approval. File import remains fallback.

5. **Role-specific UX density** (`2W79LIFTV5v12J8CTW56`)  
   Owner / bookkeeper / accountant / practice guided workflows on the same design system — not a second skin. Reduces training time to competitor “day one” feel.

6. **Payroll bureau depth (lite)** (`0KqsOlaCnVo6JomTdB8F`)  
   Multi-entity batch runs, bulk payslip pack download, leave calendar polish, EMP501 annual packaging polish — still prepare/approve/export only.

7. **Payment instruction export formats (observe-only)** (`GiLXtg26kg477b2BYYul`)  
   Expand beyond generic eft_instructions / payroll_net toward ACB / NetCash-style **file shapes** operators upload manually. Never initiate.

8. **Vera calc audit** (assign under Phase 5 QA track)  
   Independent PAYE/UIF/SDL / leave / FX / depreciation calc spot-checks against published tables and golden fixtures; evidence on board.

9. **Quinn QA + Peet promote** (`iA0dOv2NYxDjNim4S8L8` + e2e card)  
   Phase 5 acceptance pack after must-haves; production/main only via Peet.

### Differentiator (build deliberately)

1. **Inventory/stock lite + COGS** (`m6P7jrp57im6pTp2Z56i`)  
   Thin stock movements + COGS on sales documents linked to finance books; reuse CRM inventory-items where possible. Wins product SMBs; pure agencies may deprioritize. Rank **Differentiator** (agency-first cohort can sequence after must-haves).

2. **Keep extending multi-entity IC + consolidation UX** inside proving kit and role UX — already ahead of vanilla QBO.

3. **Projects/time job costing closed loop polish** (quote→time→WIP→invoice→cash) — deepen, don’t rebuild.

4. **Cross-org multi-tenant pay confirm** — unique PiB graph story; keep in demos.

5. **Agent/Kanban-operable finance** — runbooks + evidence remain a wedge competitors lack.

### Stretch

- Mobile ESS (SimplePay app parity).
- Full multi-country payroll (PaySpace upper bound).
- Deep cash forecasting / scenario AI beyond cashflow planner.
- Expense claims / receipts OCR.
- Revenue recognition schedules (QBO Advanced-class).
- True firm→client grant practice model beyond membership switcher.
- Warehouse/WMS, BOM, manufacturing (explicitly out).

### Non-goals (do not schedule as Phase 5 parity)

- SARS e-filing **submit** / auto SARS payment.
- External payment **initiation** (EFT/ACB/card money movement).
- Unapproved **paid** bank-feed / open-banking vendor contracts or spend.
- Mass client-visible statement/payslip email campaigns without separate approval.
- Ordinary agent merge to `main` / `vercel --prod` without Peet promote gate.
- Full ERP WMS / manufacturing inventory.

---

## Why Phase 4 was not enough (honest residual narrative)

Phase 4 answered: “Do we have the modules rivals put on the brochure?”

World-class asks: “Can a bookkeeper close three entities for three months without a spreadsheet, with bank data flowing, payroll batch done, exports the bank and accountant accept, under role-appropriate UI, with automated proof it still works next month?”

Residual risk clusters:

| Cluster | Risk if skipped | Competitor embarrassment mode |
| --- | --- | --- |
| Proving + e2e | Silent regressions; can’t demo multi-period close | “It worked in unit tests” |
| Operator density | Power users bounce to Xero/QBO | Bulk and close week friction |
| Bank feeds | Daily recon still file-choreography | Xero/QBO/Sage default path |
| Payroll bureau | Multi-client accountants stay on SimplePay/PaySpace | Batch + leave calendar |
| Payment file formats | Manual rekey into bank | SimplePay/Sage NetCash files |
| Inventory/COGS | Product SMBs dual-system | Xero/Sage/QBO stock |
| Vera/Quinn/Peet | Calc or gate failure in production | Trust collapse |

---

## Recommended Phase 5 sequencing

```
Peet scope gate iA0dOv2NYxDjNim4S8L8
  → Spec update y2BDxF7Iw78ShKRlGke3 (Flie3SblIDXvplYmqOhy)
  → Proving kit + e2e harness (parallel foundations)
  → Operator depth / period-close blockers
  → Bank feed connector framework (mock provider first)
  → Role-specific UX density
  → Payroll bureau lite + payment file formats (parallel)
  → Inventory/stock lite + COGS (differentiator; after must-have backbone if capacity tight)
  → Vera calc audit
  → Quinn Phase 5 acceptance + Peet promote
```

**Capacity cut rule:** never cut proving kit, e2e, hard gates, or bank-feed **framework**. Cut inventory/COGS and stretch ESS mobile first.

---

## Acceptance criteria inputs (for docs/spec task)

### Proving kit
- Seeded demo org with ≥2 legal entities, open+closed periods, AR/AP, bank import, FX doc, asset dep, job-costed project, pay run locked, packaging packs downloadable.
- Multi-period close checklist produces balanced books + export evidence folder.

### E2E golden paths
- Automated: login-scoped portal paths for hub, invoice→credit→statement, statement import→rule suggest→accept, payroll approve/lock, packaging download.
- Negative: no SARS submit control; no pay initiate control; rule accept does not skip human.

### Bank feed framework
- `BankFeedProvider` interface; mock provider emits transactions on schedule/job.
- Materializes into statement lines compatible with existing recon suggestion + bank rules.
- Credentials vault pattern stubbed; production vendor binding behind Peet approval.

### Operator depth
- Period-close panel lists blockers with deep links.
- Bulk ops cover top 5 bookkeeper actions without N+1 UI pain.

### Payroll bureau lite
- Select multiple entities → batch calculate/submit queue (per-entity approve still enforced).
- Bulk payslip PDF/zip pack; leave calendar month view.

### Payment formats
- At least one SA bank bulk-file shape + one NetCash-like shape as **download only**, schema documented, never submitted by PiB.

### Inventory/COGS lite
- Stock item linked to income/COGS/inventory accounts; invoice issue posts COGS + stock movement; report stock on hand — no warehouse bins.

### Vera / Quinn / Peet
- Vera: written calc audit with fixture IDs and variance=0 on golden set.
- Quinn: Phase 5 pack green on development/staging.
- Peet: explicit promote gate only.

---

## Implications for strategic wedges

1. **Multi-entity** — still a win; Phase 5 should **prove** consolidation across periods, not rebuild.  
2. **CRM/Projects finance** — job costing live; inventory/COGS and closed-loop polish extend the agency+product story.  
3. **ZA payroll** — core moat held; bureau density and payment **files** are the residual SimplePay/PaySpace embarrassment gaps — without taking on submit/initiate.

---

## Open questions (do not block research close)

1. First paying cohort: agency-only (defer inventory) vs mixed product SMB (pull inventory earlier)?  
2. Bank feed: stay mock + manual file through first production promote, or Peet-approve one ZA aggregator?  
3. Practice model: membership switcher enough for v1 bureau, or firm grant ACL required?  
4. ESS mobile: PWA vs native later?

---

## Artifacts & links

| Artifact | Ref |
| --- | --- |
| Project | `HRCSWl1cNnh6fYEGziAb` |
| Spec | `Flie3SblIDXvplYmqOhy` |
| This research task | `rJGYtdSsd6hMqcCgqivH` |
| Research item | `MjAevubofvCcbLOFsD5v` (status verified, internal) |
| Phase 4 gap map | `docs/research/finance-phase4-competitor-gap-map-2026-08-02.md` |
| Phase 4 acceptance | `docs/operations/finance/phase4-acceptance-pack-2026-08-02.md` |
| This repo doc | `docs/research/finance-phase5-residual-gap-map-2026-08-03.md` |
| Matrix HTML (throwaway visual) | `docs/research/finance-phase5-residual-gap-map-matrix-2026-08-03.html` |
| Inventory HEAD | `f49c146e3dfe3725481f28250d87cd0532117b05` |
| Downstream | Spec `y2BDxF7Iw78ShKRlGke3`; Peet gate `iA0dOv2NYxDjNim4S8L8` |
| Wiki topic | `agents/partners/wiki/finance-phase5-residual-gap-map-2026-08-03.md` |

---

## Safety readback

- Read-only competitor research + internal inventory + durable docs.
- No SARS submit, payment initiation, mass payslip/statement email, production deploy, or main promote.
- No paid bank-feed vendor contract.
- No client-visible finance mutations.
- Temporary matrix HTML is chat/repo throwaway visual only; decision lives in Messages + this markdown + Research item.
