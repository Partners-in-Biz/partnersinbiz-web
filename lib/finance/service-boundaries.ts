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
] as const

/** UI claim — full finance workbench modules are shipped under /portal/finance. */
export const FINANCE_UI_SHIPPED = true as const

export const FINANCE_UI_BOUNDARY_NOTE =
  'Finance foundation workbench shipped under /portal/finance (overview, setup, ledger, reports, tax, documents, intercompany, payroll). Interactive portal workbenches load live bundles and run authenticated commands for foundation, reports, tax, documents, intercompany, and payroll. SARS submission and external payment initiation remain disabled. Sensitive access is enforced at policy + service boundaries.'
