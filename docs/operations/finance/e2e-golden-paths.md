# Finance Playwright / e2e golden paths

Task: `ByV0Q2WwB3XbpQavF82W` (Phase 5 world-class). Development/staging only.

## What this covers

| # | Path | Hermetic coverage |
| --- | --- | --- |
| 1 | Finance hub + scope bar + deep links | Source/UI shell + `financeRoutes` |
| 2 | Invoice → allocate → credit note | AR/AP domain services |
| 3 | Statement/import + bank rule suggest → Accept | Bank rules service + UI Accept control |
| 4 | Payroll approve/lock (no external pay) | Pay-run service |
| 5 | Packaging download packs return files | Packaging service + proving kit dry-run |
| 6 | Tenant isolation (wrong org denied) | HTTP org guard + service deny |

Hard gates asserted on every path:

- `sarsSubmissionInitiated === false`
- `externalPaymentInitiated === false`
- bank-rule accept never `autoPosted`

Proving kit seed key: `pib-demo-proving-v1`.

## Local run

### Prerequisites

```bash
npm install
npx playwright install chromium
```

System deps (Linux CI/VPS once):

```bash
npx playwright install-deps chromium
```

### Domain-only (no browser; fastest)

```bash
npm run test:finance:e2e:domain
# or
npx tsx scripts/finance/e2e-golden-paths.ts
```

Writes `artifacts/finance-e2e-last-run.json`.

### Jest e2e harness (existing pattern under `__tests__/e2e`)

```bash
npm run test:finance:e2e:jest
```

### Full Playwright (hermetic UI shell + domain globalSetup)

```bash
npm run test:finance:e2e
# alias
npm run verify:finance:e2e
```

### Optional live portal smoke

Requires a reachable development/staging base URL. Does **not** mint SARS/pay side effects.

```bash
FINANCE_E2E_BASE_URL=https://your-preview.example npm run test:finance:e2e:live
```

Authenticated deep UI clicks need a Playwright `storageState` (session cookie). Until that is provided, live mode only checks that `/portal/finance` responds / redirects.

## CI notes

- Default gate for agents/CI: `npm run verify:finance:e2e` (Playwright hermetic) **or** at minimum `npm run test:finance:e2e:domain` + `npm run test:finance:e2e:jest` when browsers cannot install.
- Do not run against production.
- Do not set env vars that enable SARS submit or payment initiation (none exist for happy-path here; hard gates must stay false).
- Artifact paths (gitignored if your tree ignores `artifacts/`):
  - `artifacts/finance-e2e-last-run.json`
  - `artifacts/finance-e2e-playwright-report.json`
  - `artifacts/finance-e2e-test-results/`

## Layout

```
lib/finance/e2e/golden-paths.ts          # shared runner
scripts/finance/e2e-golden-paths.ts      # CLI
__tests__/e2e/finance-golden-paths.test.ts
e2e/finance/golden-paths.spec.ts         # Playwright
e2e/finance/global-setup.ts
e2e/finance/fixtures/finance-ui-shell.html
playwright.config.ts
```

## Safety readback

- No production deploy / `main` promote.
- No SARS e-filing submit.
- No external payment initiate.
- No mass client-visible payslip/statement email.
- Hermetic mode uses in-memory stores only.
