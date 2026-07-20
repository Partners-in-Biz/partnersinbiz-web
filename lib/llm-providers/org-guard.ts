import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { isActiveOrgMembershipRow } from '@/lib/linked-computers/policy'

export function clientCanAccessOrg(user: ApiUser, orgId: string): boolean {
  if (user.role !== 'client') return true
  return (
    user.orgId === orgId ||
    user.activeOrgId === orgId ||
    (user.orgIds ?? []).includes(orgId)
  )
}

/**
 * Org-scoped LLM connections (shared VPS keys) require org admin/owner,
 * or platform admin/ai. User-scoped connections are allowed for any org member.
 */
export async function canWriteOrgLlmConnection(user: ApiUser, orgId: string): Promise<boolean> {
  if (user.role === 'admin' || user.role === 'ai') return true
  if (user.role !== 'client') return false

  try {
    const snap = await adminDb.collection('orgMembers').doc(`${orgId}_${user.uid}`).get()
    if (!snap.exists) return false
    const data = snap.data() ?? {}
    if (!isActiveOrgMembershipRow(data)) return false
    const role = String(data.role || '').toLowerCase()
    return role === 'owner' || role === 'admin'
  } catch {
    return false
  }
}
