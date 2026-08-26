import { adminDb } from '@/lib/firebase/admin'
import { cleanString, isActiveOrgMembershipRow, type OrgMemberRow } from '@/lib/orgMembers/active-membership'

function memberEntryMatchesUid(member: unknown, uid: string): boolean {
  if (!member || typeof member !== 'object') return false
  const entry = member as OrgMemberRow
  const entryUid = cleanString(entry.userId) || cleanString(entry.uid)
  return entryUid === uid && isActiveOrgMembershipRow(entry)
}

/**
 * Every org whose embedded organizations.members array lists this uid as an
 * active member. Used by the portal switcher so Org.members-only owners
 * (missing orgMembers / users.orgIds / accessScope) still appear.
 * Does not special-case slugs and does not invent memberships.
 */
export async function organizationEmbeddedMemberOrgIds(uid: string): Promise<string[]> {
  const cleanUid = cleanString(uid)
  if (!cleanUid) return []
  try {
    const collection = adminDb.collection('organizations') as {
      get?: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }>
    }
    if (typeof collection.get !== 'function') return []
    const snap = await collection.get()
    const ids: string[] = []
    for (const doc of snap.docs) {
      const orgData = doc.data() ?? {}
      if (orgData.deleted === true || orgData.archived === true) continue
      const status = typeof orgData.status === 'string' ? orgData.status.trim().toLowerCase() : ''
      if (status === 'suspended' || status === 'churned') continue
      const members = Array.isArray(orgData.members) ? orgData.members : []
      if (members.some((member) => memberEntryMatchesUid(member, cleanUid))) {
        ids.push(doc.id)
      }
    }
    return ids
  } catch (err) {
    console.error('[organizations] embedded members scan failed', err)
    return []
  }
}
