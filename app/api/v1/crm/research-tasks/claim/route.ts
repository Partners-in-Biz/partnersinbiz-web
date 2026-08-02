/**
 * POST /api/v1/crm/research-tasks/claim
 * Lease next due pending research task (multi-worker safe transaction).
 * Auth: member+ (agents preferred for workers)
 */
import { NextRequest } from 'next/server'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { leaseNextResearchTask } from '@/lib/crm/facts'

export const dynamic = 'force-dynamic'

export const POST = withCrmAuth('member', async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => ({}))
  const workerIdRaw =
    body && typeof body === 'object' ? (body as { workerId?: unknown }).workerId : null
  const leaseSecondsRaw =
    body && typeof body === 'object' ? (body as { leaseSeconds?: unknown }).leaseSeconds : null

  const workerId =
    typeof workerIdRaw === 'string' && workerIdRaw.trim()
      ? workerIdRaw.trim()
      : ctx.isAgent || ctx.actor.kind === 'agent'
        ? ctx.actor.uid
        : ctx.uid || ctx.actor.uid

  if (!workerId) return apiError('workerId is required', 400)

  const task = await leaseNextResearchTask({
    orgId: ctx.orgId,
    workerId,
    leaseSeconds:
      typeof leaseSecondsRaw === 'number' && Number.isFinite(leaseSecondsRaw)
        ? leaseSecondsRaw
        : undefined,
  })

  return apiSuccess({
    task,
    leased: Boolean(task),
    workerId,
  })
})
