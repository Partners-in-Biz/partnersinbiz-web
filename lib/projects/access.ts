import type { DocumentData, DocumentSnapshot } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg, isSuperAdmin } from '@/lib/api/platformAdmin'
import { legacyProjectPolicyAllows, resolveProjectAccessForUser } from '@/lib/projects/collaboration'

export type ProjectAccessResult =
  | { ok: true; doc: DocumentSnapshot<DocumentData>; projectAccess: Awaited<ReturnType<typeof resolveProjectAccessForUser>> }
  | { ok: false; status: number; error: string }

function projectOrgIds(data: DocumentData): string[] {
  return [data.orgId, data.sourceOrgId, data.clientId, data.clientOrgId, data.recipientOrgId, data.targetOrgId].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )
}

export function canAccessProject(user: ApiUser, data: DocumentData): boolean {
  if (user.role === 'ai') return true
  if (isSuperAdmin(user)) return true

  const ids = projectOrgIds(data)
  if (!legacyProjectPolicyAllows(user, data)) return false
  return ids.some((id) => canAccessOrg(user, id))
}

export async function getProjectForUser(projectId: string, user: ApiUser): Promise<ProjectAccessResult> {
  const doc = await adminDb.collection('projects').doc(projectId).get()
  if (!doc.exists) return { ok: false, status: 404, error: 'Project not found' }
  const data = doc.data() ?? {}
  const projectAccess = await resolveProjectAccessForUser(projectId, user, data)
  if (!projectAccess && !canAccessProject(user, data)) return { ok: false, status: 403, error: 'Forbidden' }
  return { ok: true, doc, projectAccess: projectAccess ?? null }
}
