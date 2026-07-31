/**
 * Explicit service-only vs HTTP boundary inventory for finance/payroll.
 * Payroll, tax, documents, and intercompany remain library/service-only until
 * dedicated authenticated routes ship. Only foundation commands are HTTP today.
 */

/** Relative paths from repo root — every finance HTTP entrypoint that must pass tenant/auth harness. */
export const FINANCE_HTTP_ENTRYPOINTS = [
  'app/api/v1/finance/foundation/commands/route.ts',
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

/** UI claim for this harden slice — no finance/payroll portal or admin screens shipped. */
export const FINANCE_UI_SHIPPED = false as const

export const FINANCE_UI_BOUNDARY_NOTE =
  'No finance/payroll UI paths shipped in this slice. Sensitive access is enforced at policy + service boundaries; client-visible screens remain out of scope until a dedicated UI task.'
