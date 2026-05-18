// lib/api/platformAdmin.ts
//
// Helpers for the "platform admin" concept — internal PiB staff who can
// manage one or more client organisations.
//
// A user is a "super admin" when role === 'admin' AND allowedOrgIds is
// missing/empty. Super admins have unrestricted access (current behaviour
// of every existing admin in the system) and are the only ones who can
// create / edit / delete other platform admins.

import type { ApiUser } from './types'

export function restrictedAdminOrgIds(user: ApiUser | null | undefined): string[] {
  if (!user || user.role !== 'admin') return []
  if (!Array.isArray(user.allowedOrgIds) || user.allowedOrgIds.length === 0) return []
  const ids = new Set<string>()
  for (const orgId of user.allowedOrgIds) {
    if (orgId) ids.add(orgId)
  }
  if (user.orgId) ids.add(user.orgId)
  return Array.from(ids)
}

export function canAccessOrg(user: ApiUser | null | undefined, orgId: unknown): boolean {
  if (!user) return false
  if (user.role === 'ai') return true
  if (user.role === 'admin') {
    if (typeof orgId !== 'string' || !orgId) return false
    const allowed = restrictedAdminOrgIds(user)
    return allowed.length === 0 || allowed.includes(orgId)
  }
  if (typeof orgId !== 'string' || !orgId) return false
  const clientOrgIds = user.orgIds?.length ? user.orgIds : (user.orgId ? [user.orgId] : [])
  return clientOrgIds.includes(orgId)
}

export function isSuperAdmin(user: ApiUser | null | undefined): boolean {
  if (!user) return false
  if (user.role === 'ai') return true
  if (user.role !== 'admin') return false
  const allowed = user.allowedOrgIds
  return !Array.isArray(allowed) || allowed.length === 0
}

export function isRestrictedAdmin(user: ApiUser | null | undefined): boolean {
  if (!user) return false
  if (user.role !== 'admin') return false
  const allowed = user.allowedOrgIds
  return Array.isArray(allowed) && allowed.length > 0
}
