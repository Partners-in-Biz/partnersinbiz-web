# Vera Phase 6 calc + recon correctness audit expansion

- **Task:** `pSz1QwT7wC6Q98og327J`
- **Project:** `HRCSWl1cNnh6fYEGziAb` — Partners in Biz Finance, Accounting & South African Payroll
- **Auditor:** Vera (data) on **Peets-Mac-mini.local**
- **Date (UTC):** 2026-08-03
- **Depends on (approved):** `O2hbOSJb4gydptVGEOG2`, `6b2T04ZyWNXYn7yB9UAd`, `SZRWufZ64Qnr3aqF9YyZ`, `ng0kop4wEjqP68gt3M5f`
- **Predecessor audit:** `IjQ1F1sGvrZNS16inQ36` (Phase 4+5)
- **Mode:** independent correctness + recon integrity. No production changes. No SARS submit. No external payment initiation. No auto-post.

## Decision

**Phase 6 depth is calc-clean inside hermetic goldens:**

1. **Payroll/VAT/FX/dep (+ job costing) Phase 4+5 pack** — re-run **variance=0** against pinned 2025/26 tables and pure engines.
2. **Expense claim → GL journal proposal** — multi-line VAT-aware postings balance; Debit expense(+VAT input) = Credit payable/gross.
3. **Revenue recognition** — straight-line schedule posts across periods with balanced Dr deferred / Cr revenue; reverse restores deferred; reports match.
4. **Bank feed (mock)** — materialization stamps `reconMaterializedAt`; 1:1 suggestions; unique fingerprints; second sync idempotent; SARS stays out of safe bulk; hard gates hold.

**Still open (documented, not new regressions):** predecessor HIGH findings remain open product work for Theo:

- `PAYROLL_TAX_YEAR_PACKAGE_GAP` (2026/27 package missing)
- `VAT_RETURN_TRACE_NOT_PERIOD_SCOPED`

**Phase 6 LOW notes (design, not math bugs):**

- Expense post certifies **journalProposal** balance/shape; foundation ledger dual-write is a separate path.
- Bank suggestions are deterministic heuristics (not ML).

## Evidence commands

```bash
npm run verify:finance:vera-calc-audit   # phase45 + phase6
# or focused:
npm run test:finance:vera-phase6-audit
npx tsx scripts/finance/verify-vera-phase6-audit.ts
```

Hard gates observed on every pack: `externalPaymentInitiated=false`, `sarsSubmissionInitiated=false`, `autoPosted=false`, `noEgress=true`.

## Fixture ID catalogue

### A. Phase 4+5 re-run (aggregate + individuals)

| Fixture ID | Domain | Expected |
|---|---|---|
| `vera-phase45-aggregate` | phase45_pack | failCount=0 |
| (all IDs from `lib/finance/audit/vera-phase45-golden-fixtures.ts`) | payroll/VAT/FX/dep/job_costing | variance=0 |

Sample payroll IDs still certified: `paye-25k-monthly-age35-in-year`, `paye-40k-monthly-age35-in-year`, `uif-at-ceiling-remuneration`, `uif-above-ceiling-50k`, `paye-secondary-rebate-age66`, `paye-tertiary-rebate-age76`, `drift-probe-40k-aug-2026-calendar` (package still 2025/26 by design).

### B. Expense claim → GL

| Fixture ID | Net | VAT | Gross | Shape |
|---|---:|---:|---:|---|
| `exp-gl-fuel-std15-payable` | 85000 | 12750 | 97750 | Dr travel 85000 + Dr VAT 12750 / Cr payable 97750 |
| `exp-gl-multi-line-mixed-vat` | 65000 | 6750 | 71750 | 3 expense lines + VAT / Cr payable |
| `exp-gl-zero-vat-only` | 120000 | 0 | 120000 | Dr training / Cr payable (no VAT line) |

Source helpers: `vatMinorForNet`, `normalizeClaimLine`, `sumClaimLines`, `buildPostJournalProposal`.

### C. Revenue recognition across periods

| Fixture ID | Detail |
|---|---|
| `revrec-sl-3mo-1200000-across-periods` | R12,000.00 / 3 months → R4,000.00 each for 2026-06, 2026-07, 2026-08; full recognize then reverse Aug → deferred 400000, recognized 800000; bps 6666 |
| `revrec-sl-remainder-10000-3mo` | 10000 → [3333,3333,3334] remainder catch-up |

Journal per period: Dr `acc-def` amount / Cr `acc-rev` amount (balanced).

### D. Bank feed materialization → recon

| Fixture ID | Detail |
|---|---|
| `bf-materialize-recon-mock-p6` | mock multi-account sync; lines≥8; suggestions=lines; unique FP; second sync 0 lines; SARS suggestion stays `pending` after safe bulk; reconUnreconciled>0; fallback `/portal/finance/statements` |
| `bf-safe-bulk-high-conf-rent` | safe=true @ conf≥0.8 non-SARS |
| `bf-safe-bulk-block-sars` | safe=false |
| `bf-safe-bulk-block-low-conf` | safe=false |
| `bf-safe-bulk-block-flag-review` | safe=false |
| `bf-safe-bulk-block-already-accepted` | safe=false |
| `bf-age-3` … `bf-age-61` | aging buckets 0-7 / 8-30 / 31-60 / 61+ |

Mock accounts: `mock-za-cheque-001`, `mock-za-savings-002`.

## Material findings

| Severity | Code | Action |
|---|---|---|
| HIGH (prior) | `PAYROLL_TAX_YEAR_PACKAGE_GAP` | Theo tasks already filed from IjQ1… |
| HIGH (prior) | `VAT_RETURN_TRACE_NOT_PERIOD_SCOPED` | Theo tasks already filed from IjQ1… |
| LOW (new note) | `EXPENSE_POST_IS_PROPOSAL_NOT_LEDGER_JOURNAL` | Document only unless dual-write required for close |
| LOW (new note) | `BANK_SUGGESTIONS_RULE_HEURISTIC` | Document only |

No new HIGH math variance found in Phase 6 surfaces.

## Artifacts

| Path | Purpose |
|---|---|
| `lib/finance/audit/vera-phase6-golden-fixtures.ts` | Exact goldens + async runners |
| `__tests__/finance/vera-phase6-calc-audit.test.ts` | Jest regression |
| `scripts/finance/verify-vera-phase6-audit.ts` | CLI JSON evidence |
| `npm run test:finance:vera-phase6-audit` | Suite |
| `npm run verify:finance:vera-phase6-audit` | Suite + script |
| `docs/operations/finance/vera-phase6-calc-recon-audit-pSz1QwT7wC6Q98og327J-2026-08-03.md` | This pack |

## Safety readback

- No production deploy / main merge
- No SARS submission
- No external payment initiation
- No bank auto-post
- No client-visible sends
- No paid bank-feed vendor
- Development hermetic evidence only on Peets-Mac-mini.local

## Reusable workflow

1. After any payroll/VAT/FX/dep/expense/rev-rec/bank-feed change: `npm run verify:finance:vera-calc-audit`.
2. Require `ok:true`, `failCount:0`, hard gates false.
3. File Theo only for variance≠0 inside packages or multi-period assemble bugs.
4. Keep fixture IDs stable in this pack for Quinn/accountant cross-walk.
