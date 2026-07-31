/**
 * Shared HTTP org/tenant guards for finance entrypoints.
 * Keep route handlers thin; unit-test these checks without spinning Next.js.
 */

export type FinanceOrgScopeCheck =
  | { ok: true; orgId: string }
  | { ok: false; status: 403 | 422; error: string }

/**
 * Require command.orgId and reject X-Org-Id mismatch when the header is present.
 */
export function checkFinanceCommandOrgScope(
  commandOrgId: unknown,
  headerOrgId: string | null | undefined,
): FinanceOrgScopeCheck {
  const orgId = typeof commandOrgId === 'string' && commandOrgId.trim() ? commandOrgId.trim() : undefined
  if (!orgId) {
    return { ok: false, status: 422, error: 'command.orgId is required' }
  }
  const header = typeof headerOrgId === 'string' ? headerOrgId.trim() : ''
  if (header && header !== orgId) {
    return { ok: false, status: 403, error: 'Organization scope mismatch' }
  }
  return { ok: true, orgId }
}
