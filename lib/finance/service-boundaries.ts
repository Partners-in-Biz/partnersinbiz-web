/**
 * Explicit service-only vs HTTP boundary inventory for finance/payroll.
 * Domain services remain library-only; authenticated HTTP surfaces go through durable gateways.
 */

/** Relative paths from repo root — every finance HTTP entrypoint that must pass tenant/auth harness. */
export const FINANCE_HTTP_ENTRYPOINTS = [
  'app/api/v1/finance/foundation/commands/route.ts',
  'app/api/v1/finance/foundation/queries/route.ts',
  'app/api/v1/finance/reports/queries/route.ts',
  'app/api/v1/finance/tax/commands/route.ts',
  'app/api/v1/finance/tax/queries/route.ts',
  'app/api/v1/finance/documents/commands/route.ts',
  'app/api/v1/finance/documents/queries/route.ts',
  'app/api/v1/finance/intercompany/commands/route.ts',
  'app/api/v1/finance/intercompany/queries/route.ts',
  'app/api/v1/finance/payroll/commands/route.ts',
  'app/api/v1/finance/payroll/queries/route.ts',
  'app/api/v1/finance/personal/commands/route.ts',
  'app/api/v1/finance/personal/queries/route.ts',
  'app/api/v1/finance/cross-org/commands/route.ts',
  'app/api/v1/finance/cross-org/queries/route.ts',
  'app/api/v1/finance/statements/commands/route.ts',
  'app/api/v1/finance/statements/queries/route.ts',
  'app/api/v1/finance/cutover/commands/route.ts',
  'app/api/v1/finance/cutover/queries/route.ts',
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
] as const

/** UI claim — full finance workbench modules are shipped under /portal/finance. */
export const FINANCE_UI_SHIPPED = true as const

export const FINANCE_UI_BOUNDARY_NOTE =
  'Finance foundation workbench shipped under /portal/finance (overview, setup, ledger, reports, tax, documents, intercompany, payroll, personal, cross-org, statements, cutover). Interactive portal workbenches load live bundles and run authenticated commands for foundation, reports, tax, documents, intercompany, payroll, personal books, cross-org payment notify/confirm, statement import + human-gated recon suggestions, and opening trial balance / cutover activation. SARS submission and external payment initiation remain disabled. Personal books are owner-private. Cross-org notices require CRM linkedOrgId or active businessRelationships. Statement suggestions never auto-post. Cutover requires balanced TB + AR/AP open-item recon + approval before book.cutoverAt. Sensitive access is enforced at policy + service boundaries.'
