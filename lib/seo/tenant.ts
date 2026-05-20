import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'

export async function sprintIdsForUser(user: ApiUser): Promise<string[]> {
  if (!user.orgId) return []
  const snap = await adminDb.collection('seo_sprints').where('orgId', '==', user.orgId).get()
  return snap.docs.map((d) => d.id)
}

export async function requireSprintAccess(sprintId: string, user: ApiUser) {
  const snap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  if (!snap.exists) throw new Error('Sprint not found')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = snap.data() as any
  if (data.deleted) throw new Error('Sprint not found')
  if (!canAccessOrg(user, data.orgId)) {
    throw new Error('Sprint access denied')
  }
  return { id: snap.id, ...data }
}
