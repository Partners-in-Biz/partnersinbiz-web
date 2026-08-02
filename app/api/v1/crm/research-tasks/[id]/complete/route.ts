/**
 * POST /api/v1/crm/research-tasks/[id]/complete
 * Mark a leased research task done or failed and optionally spend budget.
 *
 * Body: {
 *   resultSummary?: string
 *   budgetSpentDelta?: number
 *   failed?: boolean
 *   error?: string
 * }
 *
 * Auth: member+
 */
import { NextRequest } from 'next/server'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { completeResearchTask } from '@/lib/crm/facts'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export const POST = withCrmAuth<RouteCtx>('member', async (req: NextRequest, ctx, routeCtx) => {
  const { id: taskId } = await routeCtx!.params
  if (!taskId) return apiError('Task ID is required', 400)

  const body = await req.json().catch(() => ({}))
  const bodyObj = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}

  try {
    await completeResearchTask({
      orgId: ctx.orgId,
      taskId,
      resultSummary:
        typeof bodyObj.resultSummary === 'string' ? bodyObj.resultSummary : undefined,
      budgetSpentDelta:
        typeof bodyObj.budgetSpentDelta === 'number' ? bodyObj.budgetSpentDelta : undefined,
      failed: bodyObj.failed === true,
      error: typeof bodyObj.error === 'string' ? bodyObj.error : undefined,
    })
    return apiSuccess({ id: taskId, completed: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Complete failed'
    if (msg === 'not_found') return apiError('Research task not found', 404)
    if (msg === 'scope_mismatch') return apiError('Research task not found', 404)
    return apiError(msg, 400)
  }
})
