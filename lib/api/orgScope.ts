// lib/api/orgScope.ts
//
// Per-role orgId resolution. Used by routes that are open to both `admin`
// and `client` roles to ensure clients can only access their own org's data.
//
// Behaviour:
//   - admin / ai roles can pass any `?orgId=` (or `body.orgId`) and we
//     trust it. They're operating the platform.
//   - client roles MUST use the orgId stored on their user record (set
//     when an OrgMember entry is created). If a `?orgId=` is supplied
//     and it doesn't match, return 403.
//   - If neither side supplies an orgId, return 400 with a helpful message.

import type { ApiUser } from './types'
import { canAccessOrg } from './platformAdmin'
import { resolveSelectedOrgContext } from './selectedOrgContext'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export interface OrgScopeOk {
  ok: true
  orgId: string
}

export interface OrgScopeErr {
  ok: false
  status: 400 | 403
  error: string
}

export type OrgScopeResult = OrgScopeOk | OrgScopeErr

/**
 * Resolve the orgId for a request given the authenticated user and an
 * optional orgId from the URL/query/body.
 *
 * Pass `null` for `requestedOrgId` if the route doesn't accept one (rare —
 * most list endpoints take `?orgId=`).
 */
export function resolveOrgScope(user: ApiUser, requestedOrgId: string | null): OrgScopeResult {
  // Admin / ai: trust whatever was requested. Required if we're scoping by it.
  if (user.role === 'admin' || user.role === 'ai') {
    if (!requestedOrgId) {
      return { ok: false, status: 400, error: 'orgId is required (admin role must scope explicitly)' }
    }
    if (user.role === 'admin' && requestedOrgId === PIB_PLATFORM_ORG_ID) {
      return { ok: true, orgId: requestedOrgId }
    }
    // Restricted platform admins can only access orgs in their allowedOrgIds
    // list (or their home orgId). Super admins (no allowedOrgIds) are
    // unrestricted. AI agents are always unrestricted.
    if (!canAccessOrg(user, requestedOrgId)) {
      return { ok: false, status: 403, error: 'You do not have access to this organisation' }
    }
    return { ok: true, orgId: requestedOrgId }
  }

  const selectedContext = resolveSelectedOrgContext(user, requestedOrgId)
  if (!selectedContext.ok) return selectedContext
  return { ok: true, orgId: selectedContext.orgId }
}
