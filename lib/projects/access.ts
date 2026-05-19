import type { DocumentData, DocumentSnapshot } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg, isSuperAdmin } from '@/lib/api/platformAdmin'

export type ProjectAccessResult =
  | { ok: true; doc: DocumentSnapshot<DocumentData> }
  | { ok: false; status: number; error: string }

function projectOrgIds(data: DocumentData): string[] {
  return [data.orgId, data.clientId, data.clientOrgId].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )
}

export function canAccessProject(user: ApiUser, data: DocumentData): boolean {
  if (user.role === 'ai') return true
  if (isSuperAdmin(user)) return true

  const ids = projectOrgIds(data)
  return ids.some((id) => canAccessOrg(user, id))
}

export async function getProjectForUser(projectId: string, user: ApiUser): Promise<ProjectAccessResult> {
  const doc = await adminDb.collection('projects').doc(projectId).get()
  if (!doc.exists) return { ok: false, status: 404, error: 'Project not found' }
  if (!canAccessProject(user, doc.data() ?? {})) return { ok: false, status: 403, error: 'Forbidden' }
  return { ok: true, doc }
}
