import type { DocumentData, DocumentSnapshot } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg, isSuperAdmin } from '@/lib/api/platformAdmin'
import { legacyProjectPolicyAllows, resolveProjectAccessForUser, type ProjectCrossOrgRequirement } from '@/lib/projects/collaboration'
import { projectLinkedOrgIds } from '@/lib/project-locations/model'

export type ProjectAccessResult =
  | { ok: true; doc: DocumentSnapshot<DocumentData>; projectAccess: Awaited<ReturnType<typeof resolveProjectAccessForUser>> }
  | { ok: false; status: number; error: string }

function projectOrgIds(data: DocumentData): string[] {
  return projectLinkedOrgIds(data as Record<string, unknown>)
}

export function canAccessProject(user: ApiUser, data: DocumentData, requestedOrgId?: string): boolean {
  if (user.role === 'ai') return true
  if (isSuperAdmin(user)) return true

  const ids = projectOrgIds(data)
  if (!legacyProjectPolicyAllows(user, data)) return false
  const scopedOrgId = requestedOrgId?.trim()
  if (scopedOrgId) return ids.includes(scopedOrgId) && canAccessOrg(user, scopedOrgId)
  return ids.some((id) => canAccessOrg(user, id))
}

export async function getProjectForUser(
  projectId: string,
  user: ApiUser,
  requestedOrgId?: string,
  crossOrgRequirement?: ProjectCrossOrgRequirement,
): Promise<ProjectAccessResult> {
  const doc = await adminDb.collection('projects').doc(projectId).get()
  if (!doc.exists) return { ok: false, status: 404, error: 'Project not found' }
  const data = doc.data() ?? {}
  const projectAccess = await resolveProjectAccessForUser(projectId, user, data, requestedOrgId, crossOrgRequirement)
  // resolveProjectAccessForUser owns the legacy fallback decision. In
  // particular, a canonical pending/revoked projectOrganizations row is an
  // authoritative tombstone and must not be bypassed by legacy project fields.
  if (!projectAccess) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }
  return { ok: true, doc, projectAccess }
}
