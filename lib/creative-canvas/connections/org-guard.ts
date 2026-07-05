import type { ApiUser } from '@/lib/api/types'

/**
 * True when the caller may act within orgId.
 *
 * Admin/AI callers are governed by withAuth's own org scoping
 * (canAccessOrg / allowedOrgIds), so this guard only constrains `client`
 * callers: a client must be a member of the org (orgId, activeOrgId, or
 * orgIds). withAuth now enforces the same rule centrally for query-param /
 * x-org-id scopes; this guard remains as defense-in-depth and covers orgIds
 * resolved from sources withAuth cannot see (e.g. request bodies).
 */
export function clientCanAccessOrg(user: ApiUser, orgId: string): boolean {
  if (user.role !== 'client') return true
  return (
    user.orgId === orgId ||
    user.activeOrgId === orgId ||
    (user.orgIds ?? []).includes(orgId)
  )
}
