import { adminDb } from '@/lib/firebase/admin'
import { isActiveOrgMembershipRow } from '@/lib/linked-computers/policy'
import {
  resolveMemberAccessPolicy,
  type MemberAccessPolicy,
} from '@/lib/orgMembers/access-policy'
import type { OrgRole } from '@/lib/organizations/types'

/**
 * Load the member access policy for a specific organisation membership.
 * Prefer this over `user.memberAccessPolicy` when enforcing grants, because
 * auth hydrates the policy for the profile activeOrgId only.
 */
export async function loadOrgMemberAccessPolicy(
  orgId: string,
  uid: string,
): Promise<MemberAccessPolicy | null> {
  const memberDoc = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
  if (!memberDoc.exists) return null
  const data = memberDoc.data() ?? {}
  if (!isActiveOrgMembershipRow(data)) return null
  return resolveMemberAccessPolicy({
    role: (data.role as OrgRole | undefined) ?? 'viewer',
    accessScope: data.accessScope,
    accessPolicy: data.accessPolicy,
  })
}
