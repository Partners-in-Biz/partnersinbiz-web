import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getProjectForUser } from '@/lib/projects/access'
import { filterProjectItemsForAccess } from '@/lib/projects/collaboration'
import { adminDb } from '@/lib/firebase/admin'
import { convertApprovedBusinessInsightReviewTask } from '@/lib/loop-engine/business-insight-conversion'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string; taskId: string }> }

export const POST = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { projectId, taskId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user, undefined, { action: 'project.write', item: taskId })
  if (!access.ok) return apiError(access.error, access.status)
  const taskDoc = await adminDb.collection('projects').doc(projectId).collection('tasks').doc(taskId).get()
  if (!taskDoc.exists || filterProjectItemsForAccess([{ id: taskId, ...(taskDoc.data() ?? {}) }], {
    projectAccess: access.projectAccess,
    user,
  }).length !== 1) return apiError('Task not found', 404)

  const result = await convertApprovedBusinessInsightReviewTask({
    projectId,
    reviewTaskId: taskId,
    actorId: user.uid,
    actorType: user.role === 'ai' ? 'agent' : 'user',
  })

  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess(result, result.created ? 201 : 200)
})
