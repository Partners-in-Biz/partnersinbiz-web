/**
 * POST /api/v1/crm/research-tasks/lease
 * Multi-worker safe lease of the next due pending research task.
 *
 * Body: { workerId?: string, leaseSeconds?: number }
 * Auth: member+ (agents / system workers)
 */
import { NextRequest } from 'next/server'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { leaseNextResearchTask } from '@/lib/crm/facts'

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
    const task = await leaseNextResearchTask({
      orgId: ctx.orgId,
      workerId,
      leaseSeconds,
    })
    if (!task) return apiSuccess({ leased: false, task: null })
    return apiSuccess({ leased: true, task })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Lease failed'
    return apiError(msg, 500)
  }
})
