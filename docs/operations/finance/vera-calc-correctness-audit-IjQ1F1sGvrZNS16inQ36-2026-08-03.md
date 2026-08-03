# Vera Phase 4+5 finance calculation correctness audit

- **Task:** `IjQ1F1sGvrZNS16inQ36`
- **Project:** `HRCSWl1cNnh6fYEGziAb` — Partners in Biz Finance, Accounting & South African Payroll
- **Auditor:** Vera (data)
- **Date (UTC):** 2026-08-03
- **Repo HEAD at audit start:** `4b1960a8369d019b9ac4fe24eb13756b4c182cc8`
- **Mode:** read-only independent correctness audit + golden fixtures. No production changes. No SARS submit. No external payment initiation.

## Decision

**Engine pure math is trustworthy inside the pinned packages** (PAYE/UIF/SDL vs 2025/26 tables variance=0; VAT 15% line math; FX realized/unrealized; straight-line depreciation/disposal; job-costing labor/WIP/P&L).

**Two material product gaps block “production-correct SA books without human tax-year care”:**

1. **HIGH — payroll tax-year package gap.** Package `za-payroll-tax-tables-2026-v1` is labeled **2025/26** (`effectiveFrom=2025-03-01`, `effectiveTo=null`). Calendar pay periods from **2026-03-01** are tax year **2026/27**, but the engine still applies 2025/26 brackets/rebates. Against Budget 2026/27 secondary tables, PAYE systematically differs (example: R40,000/mo age 35 → engine **R7,839.33** vs ~**R7,602.25** under 2026/27).
2. **HIGH — VAT return period scoping.** `prepareTaxReturn` aggregates `journalTaxTraces` by book via tax-code scope only. Traces lack `taxPointDate` / `taxPeriodId`; `sourceCutoffAt` is validated as inside the period but **not used as a filter**. Multi-period books can overstate return totals.

Ship exact golden fixtures + regression suite now; Theo owns the two HIGH fixes.

## Evidence summary

| Domain | Result vs independent math | Notes |
|---|---|---|
| PAYE brackets/rebates (package 2025/26) | **PASS variance=0** | Matches SARS-style 2025/26 tables embedded in `lib/jurisdictions/za/payroll.ts` |
| PAYE vs Budget 2026/27 tables | **FAIL by design of package** | Documented drift probe fixture |
| UIF 1% + R17,712 monthly ceiling | **PASS** | Cap = 17,712 cents contribution |
| SDL employer 1%, employee 0 | **PASS** | No R500k employer exemption modeled (LOW product gap) |
| VAT 15% exclusive/inclusive half-up | **PASS** | Line calculator correct |
| VAT return vs ledger traces | **Logic gap** | Totals = sum(all traces in book), not period-bounded |
| FX realized AR/AP + unrealized open | **PASS** | Integer scaled-rate half-up; role sign correct |
| Straight-line dep + disposal gain/loss | **PASS** | Final-month remainder catch-up; NBV/proceeds |
| Job costing labor / WIP journal / P&L | **PASS** | Labor half-up minutes; balanced WIP journal; margin = rev − cost |

### Module verifies run during audit

- `vera-phase45-calc-audit` goldens: **25/25 PASS** (jest)
- `tsx scripts/finance/verify-vera-calc-audit.ts`: **ok true**, passCount **28**, failCount **0**
- Existing: multi-currency 8/8, assets 8/8, job-costing 12/12, tax-reporting 13/13, payroll-domain+bureau 12/12

Hard gates observed: `externalPaymentInitiated=false`, `sarsSubmissionInitiated=false`, `noEgress=true`.

## Tax year documentation

| Label | Calendar | Package status in code |
|---|---|---|
| **2025/26** | 1 Mar 2025 – 28 Feb 2026 | **Pinned** as `ZA_PAYROLL_PACKAGE_V2026` / `taxYearLabel: '2025/26'` |
| **2026/27** | 1 Mar 2026 – 28 Feb 2027 | **Not packaged.** Secondary Budget 2026 figures used only for variance (KPMG SA Budget Guide 2026, SARS Budget 2026 FAQ snippets, employer guides). Not a live SARS API. |

Primary rebate 2025/26: **R17,235**. Budget 2026/27 secondary: **R17,820**.

UIF ceiling in package: **R17,712.00 / month** (`monthlyCeilingMinor=1_771_200`). SDL employer **1%**.

## Sample employee PAYE/UIF/SDL (exact engine cents)

All under package 2025/26, monthly salaried, subjectToUif+Sdl, identitiesHold=true.

| Fixture ID | Gross | PAYE | UIF EE | SDL ER | Net | Period tax year |
|---|---:|---:|---:|---:|---:|---|
| paye-25k-monthly-age35-in-year | 2,500,000 | 348,308 | 17,712 | 25,000 | 2,133,980 | 2025/26 |
| paye-40k-monthly-age35-in-year | 4,000,000 | 783,933 | 17,712 | 40,000 | 3,198,355 | 2025/26 |
| uif-at-ceiling-remuneration | 1,771,200 | 175,191 | 17,712 | 17,712 | 1,578,297 | 2025/26 |
| uif-above-ceiling-50k | 5,000,000 | 1,130,267 | 17,712 | 50,000 | 3,852,021 | 2025/26 |
| paye-secondary-rebate-age66 | 4,000,000 | 705,233 | 17,712 | 40,000 | 3,277,055 | 2025/26 |
| paye-tertiary-rebate-age76 | 4,000,000 | 679,025 | 17,712 | 40,000 | 3,303,263 | 2025/26 |
| drift-probe-40k-aug-2026-calendar | 4,000,000 | 783,933 | 17,712 | 40,000 | 3,198,355 | **calendar 2026/27, package 2025/26** |

## VAT return vs tax codes

- Line calculator (`calculateTaxAmount`) vs independent half-up: **exact match** on exclusive R100, inclusive R115, R33.33, 1c, R9,999.99 cases.
- Return assemble (`FinanceTaxService.prepareTaxReturn`):  
  `netTaxMinor = outputTaxMinor - inputTaxMinor` from **all** in-memory `journalTaxTraces` whose tax code is in the book.  
  **Missing:** period start/end filter, cutoff filter, tax point date on trace, recoverability partial rules, VAT201 box mapping polish.

## FX

| Case | Expected FX minor | Actual |
|---|---:|---:|
| AR settle 1000 @ 18.5→19.0 | +50,000 | 50,000 |
| AP settle 1000 @ 18.5→18.0 | +50,000 (gain) | 50,000 |
| AR partial 40% | +20,000 | 20,000 |
| AR open 60% reval 18.5→19.2 | +42,000 unrealized | 42,000 |

Journals forced balanced; settlement does not initiate external payment.

## Depreciation / disposal

- Remainder catch-up: base 10,000 over 3 months → `[3333,3333,3334]`, sum=base.
- Disposal gain/loss = proceeds − NBV (signed).
- Fully depreciated path covered by existing assets domain tests.

## Job costing WIP / project P&L

- `laborCostMinor(minutes, rate)` = half-up `minutes * rate / 60`.
- WIP journal: Dr labor expense (per project line) / Cr WIP clearing — **balanced**.
- P&L: income/expense lines with project dimension; `grossMarginMinor = totalRevenue − totalCost`.
- WIP report: sum of applied `wip_cost` time applications (unbilled labor cost applications), not a full BS roll-forward after classic Dr WIP capitalization. Design note, not scored as a math bug.

## Artifacts (Theo regression)

| Path | Purpose |
|---|---|
| `lib/finance/audit/vera-phase45-golden-fixtures.ts` | Exact golden rows + runner + material findings |
| `__tests__/finance/vera-phase45-calc-audit.test.ts` | Jest regression (25 tests) |
| `scripts/finance/verify-vera-calc-audit.ts` | CLI JSON evidence |
| `npm run test:finance:vera-calc-audit` | Suite |
| `npm run verify:finance:vera-calc-audit` | Suite + script |

## Material findings → Theo tasks

| Severity | Code | Ask |
|---|---|---|
| HIGH | `PAYROLL_TAX_YEAR_PACKAGE_GAP` | Add approved 2026/27 package (or freeze effectiveTo on 2025/26); resolve rule by pay period/tax year; refuse calc when no effective package; wire goldens including drift probe that must flip when 2026/27 is live. |
| HIGH | `VAT_RETURN_TRACE_NOT_PERIOD_SCOPED` | Add taxPointDate (and optional taxPeriodId) to journal tax traces at post; filter prepareTaxReturn by period+cutoff; multi-period golden that fails before fix. |
| MEDIUM | `VERA_FIXTURE_RANGE_ONLY` | Optional: tighten `vera-calc-fixtures.ts` to exact expects or delegate to this pack. |
| LOW | `SDL_EMPLOYER_EXEMPTION_NOT_MODELED` | Product decision: model annual leviable threshold exemption or document out-of-scope. |

## Safety readback

- No production deploy
- No SARS submission
- No external payment initiation
- No client-visible sends
- No destructive data mutation
- Audit is development/repo + unit evidence only

## Reusable workflow

1. Pin tax year + package id on every payroll golden.
2. Independent half-up annualize PAYE / UIF ceiling / SDL 1%.
3. Run `npm run verify:finance:vera-calc-audit`.
4. File Theo only for variance≠0 inside package **or** multi-period assemble bugs / missing tax-year packages.
5. Return decision + evidence in Messages; durable report on project + repo docs.
