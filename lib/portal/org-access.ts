// lib/portal/org-access.ts
//
// Portal org-scope resolution for browser-session users.
//
// Access model (canonical, shared with CRM middleware):
//   - Explicit ACTIVE membership always grants access: the orgMembers row or a
//     legacy organizations.members array entry (see
//     lib/orgMembers/active-membership.ts). Disabled, revoked, deleted and
//     inactive rows never grant access.
//   - Platform admins may additionally enter orgs in their ASSIGNED scope:
//     allowedOrgIds plus their home orgId. There is NO implicit "any existing
//     org" entry and NO implicit owner role. Super admins (no allowedOrgIds)
//     keep their home org; orgs they must operate require either membership or
//     an explicit allowedOrgIds entry.
//   - Convenience pointers on the user record (activeOrgId / orgId / orgIds)
//     are resolution hints only; they never grant access by themselves.

import { adminDb } from '@/lib/firebase/admin'
import {
  activeOrgMembershipOrgIds,
  cleanString,
  cleanStringArray,
  hasActiveOrgMembership,
} from '@/lib/orgMembers/active-membership'

export type PortalUserData = {
  activeOrgId?: unknown
  orgId?: unknown
  orgIds?: unknown
  role?: unknown
  allowedOrgIds?: unknown
}

function isAdminUser(data: PortalUserData): boolean {
  return cleanString(data.role) === 'admin'
}

/** Convenience pointers from the user record — resolution hints only. */
function userLinkedOrgIds(data: PortalUserData): string[] {
  const ids = new Set<string>()

  if (Array.isArray(data.orgIds)) {
    for (const value of data.orgIds) {
      const orgId = cleanString(value)
      if (orgId) ids.add(orgId)
    }
  }

  const activeOrgId = cleanString(data.activeOrgId)
  if (activeOrgId) ids.add(activeOrgId)

  const primaryOrgId = cleanString(data.orgId)
  if (primaryOrgId) {
    ids.add(primaryOrgId)
  }

  return Array.from(ids)
}

/** Assigned admin scope: allowedOrgIds ∪ home orgId. Empty for non-admins. */
export function adminAssignedOrgIds(data: PortalUserData): string[] {
  if (!isAdminUser(data)) return []
  const ids = new Set<string>()
  for (const orgId of cleanStringArray(data.allowedOrgIds)) ids.add(orgId)
  const homeOrgId = cleanString(data.orgId)
  if (homeOrgId) ids.add(homeOrgId)
  return Array.from(ids)
}

/** True when the org record itself is operable (not deleted/archived/suspended/churned). */
export async function orgIsOperable(orgId: string): Promise<boolean> {
  const cleanOrgId = cleanString(orgId)
  if (!cleanOrgId) return false
  const snap = await adminDb.collection('organizations').doc(cleanOrgId).get()
  if (!snap.exists) return false
  const data = snap.data() ?? {}
  if (data.deleted === true || data.archived === true) return false
  const status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : ''
  if (status === 'suspended' || status === 'churned') return false
  return true
}

export function choosePortalActiveOrgId(data: PortalUserData, orgIds: string[]): string | null {
  const accessible = new Set(orgIds)
  const activeOrgId = cleanString(data.activeOrgId)
  if (activeOrgId && accessible.has(activeOrgId)) return activeOrgId

  const primaryOrgId = cleanString(data.orgId)
  if (primaryOrgId && accessible.has(primaryOrgId)) return primaryOrgId

  return orgIds[0] ?? null
}

export async function getPortalOrgIdsForUser(uid: string, data: PortalUserData): Promise<string[]> {
  const ids = new Set<string>()

  // 1. Canonical active orgMembers rows (uid and userId field queries).
  for (const orgId of await activeOrgMembershipOrgIds(uid)) ids.add(orgId)

  // 2. User-record pointers (orgIds / activeOrgId / orgId) never grant access
  //    alone, but they are candidates for document-id + legacy members-array
  //    lookups. This recovers memberships that the collection query missed
  //    (missing uid field, query failure) when the pointer is still present.
  for (const orgId of userLinkedOrgIds(data)) {
    if (ids.has(orgId)) continue
    if (await hasActiveOrgMembership(orgId, uid)) ids.add(orgId)
  }

  // 3. Admin assigned scope (allowedOrgIds + home orgId), org must be operable.
  if (isAdminUser(data)) {
    for (const orgId of adminAssignedOrgIds(data)) {
      if (ids.has(orgId)) continue
      if (await orgIsOperable(orgId)) ids.add(orgId)
    }
  }

  return Array.from(ids)
}

export async function resolvePortalActiveOrgId(uid: string, data: PortalUserData): Promise<string | null> {
  const orgIds = await getPortalOrgIdsForUser(uid, data)
  return choosePortalActiveOrgId(data, orgIds)
}

export async function canUsePortalOrg(uid: string, data: PortalUserData, orgId: string): Promise<boolean> {
  const requestedOrgId = cleanString(orgId)
  if (!requestedOrgId) return false

  // Explicit ACTIVE membership (orgMembers row or legacy org.members entry).
  if (await hasActiveOrgMembership(requestedOrgId, uid)) return true

  // Admin assigned scope only. No implicit any-org entry for admins.
  if (isAdminUser(data) && adminAssignedOrgIds(data).includes(requestedOrgId)) {
    return orgIsOperable(requestedOrgId)
  }

  return false
}
