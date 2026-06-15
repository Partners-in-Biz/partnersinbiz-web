import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { buildAiCoachWorkflow, type CoachWorkflowInput } from '@/lib/self-improvement/coach'

export const dynamic = 'force-dynamic'

type CoachRequestBody = Omit<CoachWorkflowInput, 'ownerId'> & {
  ownerId?: string
}

export const POST = withAuth('client', async (req, user) => {
  const body = (await req.json()) as CoachRequestBody
  const orgId = body.orgId?.trim()
  const ownerId = body.ownerId?.trim() || user.uid

  if (!orgId) return apiError('orgId is required')
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (ownerId !== user.uid && user.role !== 'admin') {
    return apiError('ownerId must match the authenticated user for personal Life OS coaching', 403)
  }
  if (body.plan && (body.plan.orgId !== orgId || body.plan.ownerId !== ownerId)) {
    return apiError('plan orgId and ownerId must match the coaching subject scope', 403)
  }

  try {
    const workflow = buildAiCoachWorkflow({
      ...body,
      orgId,
      ownerId,
      dailyCheckIns: (body.dailyCheckIns ?? []).filter((item) => item.orgId === orgId && item.ownerId === ownerId),
      weeklyReviews: (body.weeklyReviews ?? []).filter((item) => item.orgId === orgId && item.ownerId === ownerId),
    })

    const data = workflow.safetyBoundary.level === 'crisis'
      ? {
          orgId,
          ownerId,
          workflow: {
            ...workflow,
            planSuggestions: [],
            experimentRecommendations: [],
          },
        }
      : { orgId, ownerId, workflow }

    return apiSuccess(data)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Invalid AI coach workflow payload')
  }
})
