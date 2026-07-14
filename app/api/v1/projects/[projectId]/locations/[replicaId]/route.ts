import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { getProjectForUser } from '@/lib/projects/access'
import { canProjectRole } from '@/lib/projects/collaboration'
import { projectLinkedToOrganization } from '@/lib/projects/organization-link'
import { publicProjectLocationReplica } from '@/lib/project-locations/public'
import { ProjectLocationStoreError, unlinkProjectLocation } from '@/lib/project-locations/store'

type Context = { params: Promise<{ projectId: string; replicaId: string }> }

export const DELETE = withAuth('client', async (req: NextRequest, user, ctx: Context) => {
  const { projectId, replicaId } = await ctx.params
  const orgId = req.nextUrl.searchParams.get('orgId')?.trim() ?? ''
  if (!orgId) return apiError('orgId is required', 400)
  const access = await getProjectForUser(projectId, user, orgId)
  if (!access.ok) return apiError(access.error, access.status)
  if (!canProjectRole(access.projectAccess?.role, 'manage_project')) {
    return apiError('Project manager access required', 403)
  }
  if (!await projectLinkedToOrganization({ projectId, project: access.doc.data() ?? {}, orgId })) {
    return apiError('Project is not linked to this organisation', 403)
  }
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  try {
    const replica = await unlinkProjectLocation({ projectId, replicaId, orgId, actorUserId: user.uid })
    return apiSuccess({ replica: publicProjectLocationReplica(replica) })
  } catch (error) {
    if (error instanceof ProjectLocationStoreError) return apiError(error.message, error.status)
    if (process.env.NODE_ENV !== 'test') console.error('[project-location-unlink]', error)
    return apiError('Project location request failed', 500)
  }
})
