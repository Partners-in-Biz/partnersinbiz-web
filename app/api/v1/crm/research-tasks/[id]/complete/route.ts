/**
 * POST /api/v1/crm/research-tasks/[id]/complete
 * Mark a leased/open research task done or failed; optional budget spend.
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
  if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)

  const failed = (body as { failed?: unknown }).failed === true
  const resultSummary = (body as { resultSummary?: unknown }).resultSummary
  const error = (body as { error?: unknown }).error
  const budgetSpentDelta = (body as { budgetSpentDelta?: unknown }).budgetSpentDelta

  try {
    await completeResearchTask({
      orgId: ctx.orgId,
      taskId,
      failed,
      resultSummary: typeof resultSummary === 'string' ? resultSummary : undefined,
      error: typeof error === 'string' ? error : undefined,
      budgetSpentDelta:
        typeof budgetSpentDelta === 'number' && Number.isFinite(budgetSpentDelta)
          ? budgetSpentDelta
          : undefined,
    })
    return apiSuccess({ id: taskId, completed: true, failed })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'complete_failed'
    if (msg === 'not_found' || msg === 'scope_mismatch') {
      return apiError('Research task not found', 404)
    }
    return apiError(msg, 400)
  }
})
