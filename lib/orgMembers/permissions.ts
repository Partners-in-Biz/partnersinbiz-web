import { adminDb } from '@/lib/firebase/admin'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import type { OrgRole } from '@/lib/organizations/types'
import { ROLE_RANK } from './types'

function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && value in ROLE_RANK
}

export async function canManageOrgAs(
  user: ApiUser,
  orgId: string,
  minRole: OrgRole = 'admin',
): Promise<boolean> {
  if (!canAccessOrg(user, orgId)) return false
  if (user.role === 'ai' || user.role === 'admin') return true

  const memberDoc = await adminDb.collection('orgMembers').doc(`${orgId}_${user.uid}`).get()
  if (memberDoc.exists) {
    const role = memberDoc.data()?.role
    return isOrgRole(role) && ROLE_RANK[role] >= ROLE_RANK[minRole]
  }

  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return false
  const members = orgDoc.data()?.members
  if (!Array.isArray(members)) return false
  const member = members.find((item: unknown): item is { userId: string; role?: unknown } => (
    Boolean(item) &&
    typeof item === 'object' &&
    (item as { userId?: unknown }).userId === user.uid
  ))
  const role = member?.role
  return isOrgRole(role) && ROLE_RANK[role] >= ROLE_RANK[minRole]
}
