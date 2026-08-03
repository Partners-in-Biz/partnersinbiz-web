/**
 * Explicit service-only vs HTTP boundary inventory for finance/payroll.
 * Domain services remain library-only; authenticated HTTP surfaces go through durable gateways.
 */

/** Relative paths from repo root — every finance HTTP entrypoint that must pass tenant/auth harness. */
export const FINANCE_HTTP_ENTRYPOINTS = [
  'app/api/v1/finance/assets/commands/route.ts',
  'app/api/v1/finance/assets/queries/route.ts',
  'app/api/v1/finance/bank-feeds/commands/route.ts',
  'app/api/v1/finance/bank-feeds/queries/route.ts',
  'app/api/v1/finance/bank-rules/commands/route.ts',
  'app/api/v1/finance/bank-rules/queries/route.ts',
  'app/api/v1/finance/budgets/commands/route.ts',
  'app/api/v1/finance/budgets/queries/route.ts',
  'app/api/v1/finance/cross-org/commands/route.ts',
  'app/api/v1/finance/cross-org/queries/route.ts',
  'app/api/v1/finance/cutover/commands/route.ts',
  'app/api/v1/finance/cutover/queries/route.ts',
  'app/api/v1/finance/documents/commands/route.ts',
  'app/api/v1/finance/documents/queries/route.ts',
  'app/api/v1/finance/foundation/commands/route.ts',
  'app/api/v1/finance/foundation/queries/route.ts',
  'app/api/v1/finance/intercompany/commands/route.ts',
  'app/api/v1/finance/intercompany/queries/route.ts',
  'app/api/v1/finance/inventory/commands/route.ts',
  'app/api/v1/finance/inventory/queries/route.ts',
  'app/api/v1/finance/job-costing/commands/route.ts',
  'app/api/v1/finance/job-costing/queries/route.ts',
  'app/api/v1/finance/multi-currency/commands/route.ts',
  'app/api/v1/finance/multi-currency/queries/route.ts',
  'app/api/v1/finance/operator-depth/commands/route.ts',
  'app/api/v1/finance/operator-depth/queries/route.ts',
  'app/api/v1/finance/packaging/commands/route.ts',
  'app/api/v1/finance/packaging/queries/route.ts',
  'app/api/v1/finance/payroll/commands/route.ts',
  'app/api/v1/finance/payroll/queries/route.ts',
  'app/api/v1/finance/personal/commands/route.ts',
  'app/api/v1/finance/personal/queries/route.ts',
  'app/api/v1/finance/practice/commands/route.ts',
  'app/api/v1/finance/practice/queries/route.ts',
  'app/api/v1/finance/proving/commands/route.ts',
  'app/api/v1/finance/proving/queries/route.ts',
  'app/api/v1/finance/reports/queries/route.ts',
  'app/api/v1/finance/statements/commands/route.ts',
  'app/api/v1/finance/statements/queries/route.ts',
  'app/api/v1/finance/tax/commands/route.ts',
  'app/api/v1/finance/tax/queries/route.ts',
] as const

/**
 * Server-side service modules that must not be imported from unauthenticated app routes
 * and must not gain a public HTTP surface without an auth harness + security tests.
 */
export const SERVICE_ONLY_FINANCE_MODULES = [
  'lib/payroll/pay-run-service.ts',
  'lib/payroll/calculation-service.ts',
  'lib/payroll/statutory-service.ts',
  'lib/accounting/documents-service.ts',
  'lib/accounting/intercompany-service.ts',
  'lib/accounting/tax-service.ts',
  'lib/accounting/reporting-service.ts',
  'lib/accounting/foundation-service.ts',
  'lib/finance/personal/service.ts',
  'lib/finance/cross-org/service.ts',
  'lib/finance/statements/service.ts',
  'lib/finance/cutover/service.ts',
  'lib/finance/packaging/service.ts',
  'lib/finance/practice/service.ts',
  'lib/finance/multi-currency/service.ts',
  'lib/finance/bank-rules/service.ts',
  'lib/finance/bank-feeds/service.ts',
  'lib/finance/budgets/service.ts',
  'lib/finance/operator-depth/service.ts',
  'lib/finance/proving/service.ts',
  'lib/accounting/job-costing-service.ts',
  'lib/accounting/assets-service.ts',
  'lib/accounting/inventory-service.ts',
] as const

/** UI claim — full finance workbench modules are shipped under /portal/finance. */
export const FINANCE_UI_SHIPPED = true as const

export const FINANCE_UI_BOUNDARY_NOTE =
  'Finance foundation workbench shipped under /portal/finance (overview, setup, ledger, reports, tax, documents, intercompany, payroll, personal, cross-org, statements, bank-rules, bank-feeds, budgets, cutover, packaging, multi-currency, practice, assets, job-costing). Operator depth (filters/saved views/bulk plan audit/multi-allocate/period-close blockers) and interactive portal workbenches load live bundles and run authenticated commands for foundation, reports, tax, documents (including AR/AP depth: credit/debit notes, recurring schedules, statement export drafts, bulk issue/void/allocate, aging, attachments, portal filters), intercompany, payroll, personal books, cross-org payment notify/confirm, statement import + human-gated recon suggestions, bank rules that only emit human-gated recon suggestions (never auto-post, never initiate payment), mock-first bank feed connector (adapter + sync + human accept/dismiss only; noEgress in unit tests; no paid open-banking vendor), budgets/forecasts/cashflow planner (planning only), opening trial balance / cutover activation, Phase-3 download packaging (SARS-ready packs, payment instruction exports, accountant packs), multi-currency FX rate sets / revaluation / functional reports, practice workspace (role matrix, multi-client switcher, operator notifications, audit explorer), fixed assets, job costing, and Phase 5 proving kit (demo seed / close fixture / packaging dry-run / accountant checklist) (project dimensions, project P&L/WIP, optional time costing without double-billing). SARS submission and external payment initiation remain disabled. Personal books are owner-private. Cross-org notices require CRM linkedOrgId or active businessRelationships. Statement suggestions never auto-post. Counterparty statements are draft/export only with massEmailAllowed=false. Cutover requires balanced TB + AR/AP open-item recon + approval before book.cutoverAt. Packaging is download/manifest only with externalEgressAllowed=false. Multi-currency uses immutable approved accounting_rate_sets (not operational fx_rates), realized FX on settlement, and balanced period-end revaluation journals with optional reverse-next-period. Practice switcher only lists orgs the user already belongs to and keeps X-Org-Id tenant scope. Job costing applications propose journal/invoice lines only and refuse double-billing claims. Sensitive access is enforced at policy + service boundaries.'
