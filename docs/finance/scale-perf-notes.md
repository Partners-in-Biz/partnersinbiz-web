# Finance scale / performance notes (Phase 6)

Task: Bulk scale/performance — large ledgers and statement imports  
Host worktree: `partnersinbiz-web` development  
Smoke: `npm run test:finance:scale-perf` → `tsx scripts/finance/perf-scale-smoke.ts`

## Targets

| Path | Target | Notes |
| --- | --- | --- |
| Statement CSV parse | 10k lines without UI death | Server parse + paged list (default 100 lines) |
| Recon suggestion generate | 10k unmatched × thousands payments | Amount-bucket index, not full cartesian scan |
| Statement list bundle | paginated lines/suggestions/batches | `lineLimit`/`lineOffset` query params |
| Journal list | newest first, cap 200 | Prefer `orderBy entryNumber desc` |
| Firestore writes | chunked ≤400 ops | `createChunkedBatchWriter` |

Hard gates unchanged: never auto-post bank matches; no payment initiate; no SARS submit.

## Hot-path fixes (2026-08-03)

1. **Org-scoped statement Firestore load** — `finance_statement_*` queries filter `orgId ==` (was global unscoped `limit(N)`).
2. **Chunked statement/bank-rules saves** — large import/suggestion writes no longer single 500-op batch.
3. **Amount-indexed recon matching** — `lib/finance/scale/recon-index.ts`.
4. **Bank-rules evaluate de-dupe set** — O(1) pending txn+rule keys instead of scanning suggestions per txn.
5. **listForOrg pagination + totals** — UI renders one page; totals for “Showing X of Y”.
6. **Parse/apply HTTP preview** — gateway returns first 200 lines + `linesTotal`/`linesTruncated`.
7. **listJournals** — ordered by `entryNumber desc` when composite index available; safe fallback.

## Query / index notes

### Single-field (no composite required)

- `finance_statement_import_batches` where `orgId ==`
- `finance_statement_import_lines` where `orgId ==`
- `finance_recon_suggestions` where `orgId ==`
- `finance_statement_claims` where `orgId ==`
- `finance_bank_rules` / `_suggestions` / `_claims` where `orgId ==`

### Composite (recommended)

Collection `journal_entries`:

- Fields: `orgId` ASC, `legalEntityId` ASC, `bookId` ASC, `entryNumber` DESC  
- Used by `FirestoreFoundationRepository.listJournals` for large COA books.

Deploy via Firebase console or `firestore.indexes.json` when the project maintains one. Code falls back to unordered limit + in-memory sort if the index is missing.

## Soft caps

| Collection load | Cap |
| --- | --- |
| Statement batches / org | 2_000 |
| Statement lines / org | 25_000 |
| Recon suggestions / org | 10_000 |
| Statement claims / org | 25_000 |
| Max lines per import batch | 20_000 (`STATEMENT_IMPORT_MAX_LINES`) |
| UI/API default line page | 100 |
| Max page limit | 500 |
| Journal list max | 200 |

## Remaining scale debt (not this task)

- Multi-currency / cutover gateways still load global collections in some paths (pattern residual).
- Statement `applyStatement` still imports bank transactions sequentially (correctness over throughput).
- Documents bundle for bank txns/payments may still be large — feed generateSuggestions with filtered unmatched only when possible.
- True cursor pagination on Firestore (not offset slices of org-scoped maps) if single-org line counts exceed soft caps.

## Verification

```bash
npm run test:finance:scale-perf
# or
npx jest --runInBand __tests__/finance/statements-domain.test.ts __tests__/finance/bank-rules-domain.test.ts
npx tsx scripts/finance/perf-scale-smoke.ts
```

Evidence JSON: `artifacts/finance/perf/scale-smoke-*.json`
