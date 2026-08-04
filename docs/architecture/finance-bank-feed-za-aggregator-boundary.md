# Finance bank-feed ZA aggregator adapter boundary

**Status:** Phase 6 production-shaped boundary (development only)  
**Task:** `vaNKABngcZf4TqYPpVcV` — Bank feed real-provider adapter stub (no paid vendor bind)  
**Related:** `docs/architecture/finance-bank-feed-connector.md` (Phase 5 mock-first framework)

## What this is

A **fail-closed adapter boundary** for a future South African bank-data / open-banking aggregator.

It prepares:

1. Provider registry entry `za_aggregator_stub`
2. Credential vault **stub** (`secretRefId` metadata only — no live keys in repo)
3. Org feature flag / provider selection settings (**mock default**)
4. Explicit Peet approval checklist before any paid contract or live credential

It does **not**:

- Bind Stitch, Yodlee, or any paid vendor SDK/hostname
- Store or commit API keys / client secrets
- Open network sockets to banks or aggregators
- Enable live open banking
- Auto-post journals or initiate payments
- Submit to SARS
- Spend money

## Module map

| Path | Role |
| --- | --- |
| `lib/finance/bank-feeds/credential-vault-stub.ts` | Opaque `secretRefId` metadata vault; rejects inline secrets; never returns secret bytes |
| `lib/finance/bank-feeds/provider-settings.ts` | Org settings + `BANK_FEED_LIVE_EGRESS_MASTER_SWITCH=false`; mock default |
| `lib/finance/bank-feeds/providers/za-aggregator-stub.ts` | Non-mock adapter skeleton; fail closed without vault credentials; refuse egress |
| `lib/finance/bank-feeds/adapter.ts` | Registry includes `za_aggregator_stub` (lazy) + legacy `live_stub` |
| `lib/finance/bank-feeds/service.ts` | Enforces settings, secretRef shape, ZA vault preflight on connection create |
| `lib/finance/bank-feeds/types.ts` | `BankFeedProviderId = 'mock' \| 'live_stub' \| 'za_aggregator_stub'` |

## Defaults (production-shaped)

| Setting | Default |
| --- | --- |
| `defaultProviderId` | `mock` |
| `enabledProviderIds` | `['mock']` |
| `allowNonMockProviders` | `false` |
| `allowLiveEgress` | `false` |
| `BANK_FEED_LIVE_EGRESS_MASTER_SWITCH` | `false` (compile-time) |
| Connection `noEgress` | always `true` on records/runs in this slice |

Non-mock providers (including `za_aggregator_stub`) require:

1. Org settings: `allowNonMockProviders=true` and provider listed in `enabledProviderIds`
2. Opaque `secretRefId` (not inline key material)
3. For `za_aggregator_stub`: vault metadata registered for that org+provider (still **no** secret bytes in process tests)
4. Sync still fails closed under `noEgress=true` (default)

`allowLiveEgress=true` is **rejected** while the master switch is false.

## Peet must approve before any paid contract or live credential

Treat each item as a separate gate. This task does **not** grant any of them.

### A. Commercial / vendor gate

- [ ] Named ZA aggregator vendor shortlist reviewed (no silent single-vendor lock-in from code)
- [ ] Written commercial approval: contract, pricing tier, expected monthly volume/cost cap
- [ ] Data processing / POPIA / bank-data sharing terms reviewed
- [ ] Exit plan if vendor is dropped (export, re-link, mock fallback remains)

### B. Security / credentials gate

- [ ] Secret storage path approved (platform secret manager / vault — not git, not Firestore client-readable fields, not chat)
- [ ] `secretRefId` issuance + rotation + revoke runbook
- [ ] No agent/runtime may log secret material; redaction verified
- [ ] Tenant isolation: secret refs scoped by `orgId`; cross-org resolve fails closed

### C. Product / runtime gate

- [ ] Flip path for `allowNonMockProviders` on specific orgs only (not global by default)
- [ ] Separate approval to set `BANK_FEED_LIVE_EGRESS_MASTER_SWITCH` (code change + review) **and** org `allowLiveEgress`
- [ ] Real adapter implementation behind registry (vendor-specific module), not uncommenting secrets in stub
- [ ] Staging-only soak with synthetic/sandbox credentials first
- [ ] Human-gated bank apply remains; never auto-post journals from feed accept
- [ ] No payment initiation / SARS submit coupled to feed enablement

### D. Release gate

- [ ] `npm run verify:finance:bank-feeds` green on the enabling commit
- [ ] Quinn/qa-release review for security + finance hard gates
- [ ] Separate Peet production promote / `main` merge approval (not this card)

## How a future live adapter plugs in (after gates)

1. Implement `BankFeedConnectorAdapter` in a **new** file (e.g. `providers/<vendor>.ts`) — do not turn the stub into a silent live client without review.
2. Resolve secrets **only** via approved vault using `secretRefId`; never accept inline keys on connection create.
3. Call network **only** when `ctx.noEgress === false` **and** effective live egress is allowed (master switch + org flag).
4. Register factory in `createBankFeedAdapterRegistry`.
5. Extend `BankFeedProviderId` with the real provider id (keep `za_aggregator_stub` as fail-closed scaffold or retire behind flag).
6. Keep unit tests on mock + stubs with `noEgress=true` (assert no network).
7. Document vendor runbook under `docs/operations/finance/`.

## Safety readback

- development/staging only  
- no production deploy from this task  
- no external payment initiation  
- no SARS submission  
- no client-visible sends  
- no paid open-banking vendor bind or spend  
- bank apply remains human-gated  

## Verify

```bash
npm run verify:finance:bank-feeds
# expect: domain tests PASS including za_aggregator_stub fail-closed + settings mock default
# verify script: ok true, liveStubBlocked true, zaAggregatorBlocked true, defaultProvider mock
```
