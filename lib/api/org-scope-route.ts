/**
 * Route-level orgId resolution with tenant validation.
 *
 * Resolves the orgId for a request from the authenticated user context or a
 * caller-supplied value (query/body), then validates it with `canAccessOrg`:
 *   - ai callers are platform-level and always allowed (matches withAuth)
 *   - admin callers are checked against allowedOrgIds (super admins = all)
 *   - client callers are checked against their own org memberships
 *
 * Without this, a client could inject another tenant's orgId into a route
 * that trusts a body-supplied orgId (cross-tenant write). Mirrors the
 * properties/route.ts `canAccessOrg` gate for tenant-safe routes.
 */

import type { ApiUser } from './types'
import { canAccessOrg } from './platformAdmin'

export type RouteOrgScopeOk = { ok: true; orgId: string }
export type RouteOrgScopeErr = { ok: false; status: 400 | 403; error: string }
export type RouteOrgScopeResult = RouteOrgScopeOk | RouteOrgScopeErr

export function resolveRouteOrgId(user: ApiUser, requestedOrgId: string | null | undefined): RouteOrgScopeResult {
  const orgId = typeof requestedOrgId === 'string' ? requestedOrgId.trim() : ''
  if (!orgId) {
    return { ok: false, status: 400, error: 'orgId is required (X-Org-Id header or user context)' }
  }
  if (!canAccessOrg(user, orgId)) {
    return { ok: false, status: 403, error: 'You do not have access to this organisation' }
  }
  return { ok: true, orgId }
}
