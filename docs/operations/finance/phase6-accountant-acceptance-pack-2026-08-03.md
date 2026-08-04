# Phase 6 accountant acceptance pack — multi-month close

**Status:** internal staging acceptance (do not promote production from this pack alone)  
**Date:** 2026-08-03  
**Project:** `HRCSWl1cNnh6fYEGziAb`  
**Task:** `O2hbOSJb4gydptVGEOG2`  
**Extends:** [phase5-acceptance-pack-2026-08-03.md](./phase5-acceptance-pack-2026-08-03.md)  
**Operator program:** [multi-month-close-program-2026-08-03.md](./multi-month-close-program-2026-08-03.md)  
**Portal:** `/portal/finance/proving`  
**Generated artifact path:** `artifacts/finance/multi-month-close/acceptance/`

## Purpose

Give an **external accountant** a pack they can run in **one sitting** and **sign as a checklist artifact** (name / firm / date / signature lines).  
This is **not** a wet-signature product and does not e-sign, email, or submit anything.

## One-sitting runbook

1. Confirm branch `development` and non-production tenant.
2. Run `npm run verify:finance:proving` **or** portal proving kit:
   - Seed demo company  
   - Multi-month close program  
   - Export acceptance pack  
3. Open `artifacts/finance/multi-month-close/acceptance/latest-acceptance-pack.md`.
4. Tick checklist rows against evidence (program JSON + freeze hashes + packaging digests).
5. Complete sign-off table by hand (print or PDF).
6. File signed PDF/scan in QA evidence (Quinn) — do not mass-email clients.

## Hard non-goals

| Control | Expected |
| --- | --- |
| SARS e-file submit | Absent / false |
| External payment initiate | Absent / false |
| Mass payslip/statement email | Absent / false |
| Wet-signature SaaS | `wetSignatureProduct=false` |
| Production promote | Separate Peet gate only |

## Automated bar

```bash
npm run verify:finance:proving
# expect ok true; closedPeriodCount≥3; closedEntityCount≥2; packs>0; reset true
```

## Sign-off (human)

| Field | Sign |
| --- | --- |
| Accountant name | _______________________________ |
| Firm | _______________________________ |
| Date | _______________________________ |
| Signature (hand/print) | _______________________________ |
| Notes | _______________________________ |

_I confirm hard gates remained false and the multi-month program evidence matches the seed/program ids recorded in the pack._
