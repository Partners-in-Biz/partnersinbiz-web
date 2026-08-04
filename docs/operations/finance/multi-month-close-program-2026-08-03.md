# Multi-month close program (Phase 6 proving)

**Status:** development/staging proof path  
**Date:** 2026-08-03  
**Project:** `HRCSWl1cNnh6fYEGziAb`  
**Task:** `O2hbOSJb4gydptVGEOG2`  
**Host evidence:** Peets-Mac-mini.local  
**Portal:** `/portal/finance/proving`  
**Runbooks map:** `/portal/finance/runbooks` (lane **P6-M**)  
**Acceptance pack doc:** [phase6-accountant-acceptance-pack-2026-08-03.md](./phase6-accountant-acceptance-pack-2026-08-03.md)  
**Evidence root:** `artifacts/finance/multi-month-close/`

## Goal

Prove world-class close **beyond** a single synthetic Phase 5 close fixture:

- ≥ **3 closed periods** (`2026-05`, `2026-06`, `2026-07`)
- across ≥ **2 entities** (`OPS`, `SVC`)
- with **IC** fixture match evidence, **FX** close where open, **payroll lock**, **packaging** dry-run exports, and **bank recon history**

Hard gates always false: no SARS submit, no payment initiate, no mass client email, no production promote from this program alone.

## How to run (deterministic)

```bash
git checkout development
git pull --ff-only origin development

# Full gate (jest + script + evidence folder write)
npm run verify:finance:proving

# Explicit runner (optional --reset for clean seed)
npx tsx scripts/finance/run-multi-month-close-program.ts
npx tsx scripts/finance/run-multi-month-close-program.ts --reset
```

### Portal (interactive)

1. Open `/portal/finance/proving` with org scope.
2. **Seed demo company** (idempotent by seedKey `pib-demo-proving-v1`).
3. **Multi-month close program** (OPS+SVC × 3 periods, resolve blockers, packaging).
4. **Export acceptance pack** (markdown+JSON sign-off artifact).
5. Optional **Reset proving workspace** (org owner/admin only).

## Evidence folder structure

```
artifacts/finance/multi-month-close/
  HOW-TO-RUN.md
  seed/latest-seed-digest.txt
  close-runs/latest-program.json
  packaging/pack-count.txt
  acceptance/latest-acceptance-pack.md
  acceptance/latest-acceptance-pack.json
```

Also linked from portal proving kit and finance runbooks.

## Program acceptance bar

| Check | Pass when |
| --- | --- |
| Periods | `closedPeriodCount >= 3` |
| Entities | `closedEntityCount >= 2` |
| Close runs | 6 freezes for OPS+SVC × 3 months (default matrix) |
| IC | `evidence.icMatchedCount > 0` |
| Payroll | locked runs across matrix (`payrollLockedCount >= 6` after resolve) |
| Bank history | `bankHistoryPeriods` covers May–July |
| Packaging | dry-run pack count = all packaging kinds; initiate/submit/egress false |
| Acceptance pack | markdown includes checklist + blank human sign-off; `wetSignatureProduct=false` |
| Reset | admin/dev `proving.reset` clears workspace; viewer denied |

## Known gaps (filed, not hidden)

1. **ic_fixture_not_live_service** — program uses proving-kit IC markers (matched due-to/due-from), not the full live `FinanceIntercompanyService` propose/receive journal chain. Follow-up: optional wire-through.
2. **proving_store_process_local** — gateway store is process-local for dev/staging fixture sittings, not multi-instance durable Firestore demo org.
3. **Foundation journals** — seed posts opening/activity journals per entity/period; IC amounts are fixture evidence alongside those books.

## Safety readback

- development/staging only  
- no production deploy  
- no external payment initiation  
- no SARS submission/payment  
- no client-visible mass send  
