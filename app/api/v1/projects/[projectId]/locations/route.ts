import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { getProjectForUser } from '@/lib/projects/access'
import { canProjectRole } from '@/lib/projects/collaboration'
import { projectLinkedToOrganization } from '@/lib/projects/organization-link'
import {
  linkProjectLocation,
  listExecutionLocationsForWorkspace,
  listProjectLocations,
  ProjectLocationStoreError,
} from '@/lib/project-locations/store'
import { canonicalProjectRelativePath } from '@/lib/project-locations/model'
import { publicProjectLocationReplica } from '@/lib/project-locations/public'

type Context = { params: Promise<{ projectId: string }> }

async function authorisedProjectScope(
  projectId: string,
  orgId: string,
  user: Parameters<typeof canAccessOrg>[0],
  requireManagement = false,
) {
  if (!orgId) return { ok: false as const, response: apiError('orgId is required', 400) }
  const access = await getProjectForUser(projectId, user!, orgId)
  if (!access.ok) return { ok: false as const, response: apiError(access.error, access.status) }
  if (!await projectLinkedToOrganization({ projectId, project: access.doc.data() ?? {}, orgId })) {
    return { ok: false as const, response: apiError('Project is not linked to this organisation', 403) }
  }
  if (!canAccessOrg(user, orgId)) return { ok: false as const, response: apiError('Forbidden', 403) }
  if (requireManagement && !canProjectRole(access.projectAccess?.role, 'manage_project')) {
    return { ok: false as const, response: apiError('Project manager access required', 403) }
  }
  return { ok: true as const, access }
}

function storeError(error: unknown) {
  if (error instanceof ProjectLocationStoreError) return apiError(error.message, error.status)
  if (process.env.NODE_ENV !== 'test') console.error('[project-location-link]', error)
  return apiError('Project location request failed', 500)
}

export const GET = withAuth('client', async (req: NextRequest, user, ctx: Context) => {
  try {
    const { projectId } = await ctx.params
    const orgId = req.nextUrl.searchParams.get('orgId')?.trim() ?? ''
    const scope = await authorisedProjectScope(projectId, orgId, user)
    if (!scope.ok) return scope.response
    const locations = await listProjectLocations(projectId, orgId, user.uid)
    return apiSuccess({ locations: locations.map(publicProjectLocationReplica) })
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') console.error('[project-locations-list]', error)
    return apiError('Project locations unavailable', 500)
  }
})

export const POST = withAuth('client', async (req: NextRequest, user, ctx: Context) => {
  const { projectId } = await ctx.params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const scope = await authorisedProjectScope(projectId, orgId, user, true)
  if (!scope.ok) return scope.response
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : ''
  const locationId = typeof body.locationId === 'string' ? body.locationId.trim() : ''
  if (!workspaceId || !locationId) return apiError('workspaceId and locationId are required', 400)
  try {
    const location = (await listExecutionLocationsForWorkspace(orgId, workspaceId, user.uid)).find((candidate) => (
      candidate.locationId === locationId
      || candidate.runtimeTargetId === locationId
      || candidate.legacyCompatibilityTargetId === locationId
    ))
    if (!location) return apiError('Project location is not available to this organisation', 403)
    const mapping = location.mappings.find((candidate) => (
      candidate.orgId === orgId && candidate.workspaceId === workspaceId && candidate.status === 'active'
    ))
    if (!mapping) return apiError('Project location mapping is not active', 403)
    const project = scope.access.doc.data() ?? {}
    const relativePath = canonicalProjectRelativePath(
      projectId,
      typeof project.projectFolderRelativePath === 'string'
        ? project.projectFolderRelativePath
        : undefined,
    )
    const replica = await linkProjectLocation({
      projectId, orgId, workspaceId, locationId: location.locationId, mappingId: mapping.mappingId, actorUserId: user.uid,
      relativePath,
    })
    return apiSuccess({ replica: publicProjectLocationReplica(replica) }, 201)
  } catch (error) { return storeError(error) }
})
