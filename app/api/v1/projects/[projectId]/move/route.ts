import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { getProjectForUser } from '@/lib/projects/access'
import { moveProjectToClientOrg } from '@/lib/projects/transfer'
import { logActivity } from '@/lib/activity/log'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }

function statusForMoveError(message: string): number {
  if (message.includes('not found') || message.includes('Not found')) return 404
  if (message.includes('already assigned') || message.includes('inactive') || message.includes('required') || message.includes('no source')) return 400
  return 500
}

export const POST = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const targetOrgId = typeof body.targetOrgId === 'string' ? body.targetOrgId.trim() : ''

  if (!targetOrgId) return apiError('targetOrgId is required', 400)
  if (!canAccessOrg(user, targetOrgId)) return apiError('Forbidden for target organization', 403)

  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)

  try {
    const result = await moveProjectToClientOrg({
      db: adminDb,
      projectId,
      targetOrgId,
      actorId: user.uid,
      actorRole: user.role,
    })

    const actorRole = user.role === 'ai' ? 'ai' : 'admin'
    const actorName = user.uid
    const description = `Moved project "${result.projectName}" from ${result.fromOrgId} to ${result.toOrgId}`

    await Promise.allSettled([
      logActivity({
        orgId: result.fromOrgId,
        type: 'project_moved',
        actorId: user.uid,
        actorName,
        actorRole,
        description,
        entityId: projectId,
        entityType: 'project',
        entityTitle: result.projectName,
      }),
      logActivity({
        orgId: result.toOrgId,
        type: 'project_moved',
        actorId: user.uid,
        actorName,
        actorRole,
        description,
        entityId: projectId,
        entityType: 'project',
        entityTitle: result.projectName,
      }),
    ])

    return apiSuccess(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to move project'
    return apiError(message, statusForMoveError(message))
  }
})
