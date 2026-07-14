import { adminDb } from '@/lib/firebase/admin'
import { projectLinkedOrgIds } from '@/lib/project-locations/model'
import { projectOrganizationDocId } from '@/lib/projects/collaboration'

type OrganizationAccessRecord = Record<string, unknown> | null

type ProjectOrganizationLinkOptions = {
  loadOrganizationAccess?: (projectId: string, orgId: string) => Promise<OrganizationAccessRecord>
}

async function loadOrganizationAccess(projectId: string, orgId: string): Promise<OrganizationAccessRecord> {
  const snap = await adminDb.collection('projectOrganizations')
    .doc(projectOrganizationDocId(projectId, orgId))
    .get()
  return snap.exists ? (snap.data() ?? null) : null
}

/**
 * A canonical collaboration record is authoritative, including a pending or
 * revoked tombstone. Legacy project fields are consulted only when no
 * canonical record exists for this project and organisation.
 */
export async function projectLinkedToOrganization(input: {
  projectId: string
  project: Record<string, unknown>
  orgId: string
}, options: ProjectOrganizationLinkOptions = {}): Promise<boolean> {
  const projectId = input.projectId.trim()
  const orgId = input.orgId.trim()
  if (!projectId || !orgId) return false

  const access = await (options.loadOrganizationAccess ?? loadOrganizationAccess)(projectId, orgId)
  if (access) {
    if (access.projectId !== projectId || access.orgId !== orgId) return false
    return access.status === 'active'
  }
  return projectLinkedOrgIds(input.project).includes(orgId)
}
