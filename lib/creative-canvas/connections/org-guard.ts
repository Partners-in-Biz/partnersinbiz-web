import type { ApiUser } from '@/lib/api/types'

/**
 * True when the caller may act within orgId.
 *
 * Admin/AI callers are governed by withAuth's own org scoping
 * (canAccessOrg / allowedOrgIds), so this guard only constrains `client`
 * callers: a client must be a member of the org (orgId, activeOrgId, or
 * orgIds). This mirrors the client branch of `canAccessOrg` in
 * lib/api/platformAdmin.ts, but limited to the client role because withAuth
 * does NOT re-check org membership for client callers (it only invokes
 * canAccessOrg when role === 'admin').
 */
export function clientCanAccessOrg(user: ApiUser, orgId: string): boolean {
  if (user.role !== 'client') return true
  return (
    user.orgId === orgId ||
    user.activeOrgId === orgId ||
    (user.orgIds ?? []).includes(orgId)
  )
}
