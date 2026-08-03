# Finance bank feed connector framework

**Status:** Phase 5 mock-first architecture (development)  
**Task:** `Bsk58c2oq7BuMKhLFcHm`  
**Hard gates:** `noEgress=true` in unit tests · never auto-post journals · never initiate payments · no SARS submit · no paid Yodlee/Stitch/etc. signup from this workstream

## Why mock-first

Competitors win on continuous bank feeds. PiB ships the **adapter + connection + sync + human-gated suggestion** path before any vendor contract so proving kits and E2E can exercise realistic SA lines without open-banking spend.

## Module layout

| Path | Role |
| --- | --- |
| `lib/finance/bank-feeds/adapter.ts` | `BankFeedConnectorAdapter` interface: `listAccounts`, `fetchTransactions`, `mapToBankLines`; registry; `live_stub` refuse-on-noEgress |
| `lib/finance/bank-feeds/mock-provider.ts` | Deterministic ZAR cheque lines (salary, rent, FNB fee, SARS PAYE, Vodacom, POS, supplier EFT) |
| `lib/finance/bank-feeds/types.ts` | Connection, sync run, bank line, suggestion, audit |
| `lib/finance/bank-feeds/service.ts` | In-memory transactional service: create/disconnect/sync/accept/dismiss/bundle |
| `lib/finance/bank-feeds/firestore-gateway.ts` | Org-scoped hydrate/persist |
| `app/api/v1/finance/bank-feeds/commands\|queries` | Authenticated HTTP |
| `/portal/finance/bank-feeds` | Connections, Sync now, suggestions, audit log |

## Adapter contract

```ts
interface BankFeedConnectorAdapter {
  providerId: 'mock' | 'live_stub' | …
  listAccounts(ctx): Promise<ProviderAccount[]>
  fetchTransactions(ctx, externalAccountId, cursor): Promise<{ transactions; nextCursor?; hasMore? }>
  mapToBankLines(input): BankFeedBankLine[]
}
```

Context always carries `noEgress: boolean`. Mock ignores network. Non-mock adapters **must** throw `BankFeedAdapterEgressError` when `noEgress === true` (unit tests / default sync).

Fingerprints are deterministic (`bankFeedSourceFingerprint`) so re-sync does not double-import.

## Connection record

Org + legal entity + book scoped:

- `providerId`, `status`, `bankAccountId`, `externalAccountId`, `cursor`, `lastSyncAt`, `lastError`
- `secretRefId` **only** for non-mock providers (approved secret pattern — never inline secrets)
- Mock **forbids** `secretRefId`
- Hard flags always false/`noEgress: true` on the record

## Sync job

1. Load connection (exact org/entity/book)
2. `fetchTransactions` since cursor with `noEgress` default true
3. `mapToBankLines`
4. Stage/import lines (optional `BankFeedTransactionImporter` hooks documents `bank_transactions`; in-memory path marks imported in feed store)
5. Emit **pending** coding suggestions (rent/telecoms/SARS/fees/inbound EFT heuristics — same human gate spirit as bank-rules)
6. Advance cursor; write audit `sync.started` / `sync.finished`
7. Accept/Dismiss suggestion updates status only — **`autoPosted` stays false**, **`externalPaymentInitiated` stays false**

## Portal

`/portal/finance/bank-feeds` under `FinanceModuleFrame` + `useFinanceBookScope`:

- Create mock connection
- Sync now / Disconnect
- Lines table, suggestions Accept/Dismiss, audit log
- Hard-gate readback in UI

## Server-only collections (deny-all client)

`finance_bank_feed_connections`, `finance_bank_feed_sync_runs`, `finance_bank_feed_lines`, `finance_bank_feed_suggestions`, `finance_bank_feed_audit_events`, `finance_bank_feed_claims`, `finance_bank_feed_fingerprints`

## Plugging in a future live provider

1. **Do not** sign Yodlee/Stitch/etc. or spend without a separate Peet approval task.
2. Read the Phase 6 boundary doc first: `docs/architecture/finance-bank-feed-za-aggregator-boundary.md` (provider registry, credential vault stub, org provider selection flags, Peet checklist).
3. Implement `BankFeedConnectorAdapter` in e.g. `lib/finance/bank-feeds/providers/<vendor>.ts` (not by hard-coding vendor secrets into `za_aggregator_stub`).
4. On real HTTP calls, require `ctx.noEgress === false` **and** effective live egress (compile-time master switch + org `allowLiveEgress`) **and** a resolved secret via `ctx.secretRefId` only (never log secret material).
5. Register: `createBankFeedAdapterRegistry({ … })` and extend `BankFeedProviderId`.
6. Keep unit tests on mock + `live_stub` + `za_aggregator_stub` with `noEgress: true` (assert no network).
7. Connection create for live providers already requires `secretRefId`; mock forbids it. Org settings default to mock-only until `allowNonMockProviders` is enabled.
8. Map provider payloads through `mapToBankLines` / shared fingerprint helper so import idempotency stays stable.
9. Wire optional `importBankTxn` in the Firestore gateway to `FinanceDocumentsService.importBankTransaction` when promoting lines into the documents bank register.
10. Continue to run bank-rules evaluate (or feed suggestions) as **suggestions only**.
11. Security gate: tenant isolation, deny-all collections, `verify:finance:bank-feeds` green.

## Verify

```bash
npm run verify:finance:bank-feeds
# expect: domain tests PASS; storage deny-all includes feed collections;
# workbench HTTP inventory includes bank-feeds routes; verify script ok + noEgress true
```

## Safety readback

- development/staging only  
- no production deploy  
- no external payment initiation  
- no SARS submission  
- no client-visible sends  
- no paid open-banking vendor from this slice  
