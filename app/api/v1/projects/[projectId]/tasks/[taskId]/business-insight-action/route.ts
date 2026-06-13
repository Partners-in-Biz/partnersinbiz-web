import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getProjectForUser } from '@/lib/projects/access'
import { convertApprovedBusinessInsightReviewTask } from '@/lib/loop-engine/business-insight-conversion'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string; taskId: string }> }

export const POST = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { projectId, taskId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)

  const result = await convertApprovedBusinessInsightReviewTask({
    projectId,
    reviewTaskId: taskId,
    actorId: user.uid,
    actorType: user.role === 'ai' ? 'agent' : 'user',
  })

  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess(result, result.created ? 201 : 200)
})
