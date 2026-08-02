/**
 * POST /api/v1/crm/research-tasks/work
 * Org-scoped Hermes / multi-machine worker: lease next due task + process it.
 *
 * Body: { workerId?: string, leaseSeconds?: number }
 * Auth: member+ (agents / system workers)
 */
import { NextRequest } from 'next/server'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { workNextResearchTaskForOrg } from '@/lib/crm/facts/research-worker'

export const dynamic = 'force-dynamic'

export const POST = withCrmAuth('member', async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => ({}))
  const bodyObj = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}

  const workerFromBody =
    typeof bodyObj.workerId === 'string' && bodyObj.workerId.trim()
      ? bodyObj.workerId.trim().slice(0, 120)
      : null
  const workerId =
    workerFromBody ||
    (ctx.isAgent || ctx.actor.kind === 'agent'
      ? ctx.actor.uid.replace(/^agent:/, '')
      : ctx.actor.uid)

  if (!workerId) return apiError('workerId is required', 400)

  const leaseSeconds =
    typeof bodyObj.leaseSeconds === 'number' && Number.isFinite(bodyObj.leaseSeconds)
      ? bodyObj.leaseSeconds
      : undefined

  try {
    const outcome = await workNextResearchTaskForOrg({
      orgId: ctx.orgId,
      workerId,
      leaseSeconds,
    })
    if (!outcome.leased) {
      return apiSuccess({ leased: false, task: null, result: null })
    }
    return apiSuccess({
      leased: true,
      task: outcome.task,
      result: outcome.result,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Work failed'
    return apiError(msg, 500)
  }
})
