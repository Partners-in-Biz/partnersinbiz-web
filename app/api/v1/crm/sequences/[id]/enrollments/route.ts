/**
 * GET  /api/v1/crm/sequences/:id/enrollments — list enrollments for sequence (member+)
 * POST /api/v1/crm/sequences/:id/enrollments — enroll a contact (member+)
 */
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listEnrollments, enrollContact } from '@/lib/sequences/enrollment'
import { getSequence } from '@/lib/sequences/store'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

// ── GET ─────────────────────────────────────────────────────────────────────────

export const GET = withCrmAuth<RouteCtx>('member', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params

  try {
    const enrollments = await listEnrollments(ctx.orgId, { sequenceId: id })
    return apiSuccess({ enrollments })
  } catch (err) {
    console.error('[sequence-enrollments-list-error]', err)
    return apiError('Internal Server Error', 500)
  }
})

// ── POST ────────────────────────────────────────────────────────────────────────

export const POST = withCrmAuth<RouteCtx>('member', async (req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  if (!body.contactId || typeof body.contactId !== 'string' || !body.contactId.trim()) {
    return apiError('contactId is required', 400)
  }

  try {
    const sequence = await getSequence(ctx.orgId, id)
    if (!sequence) return apiError('Not found', 404)

    const firstStepDelayDays = sequence.steps[0]?.delayDays ?? 0

    const enrollment = await enrollContact(
      ctx.orgId,
      id,
      (body.contactId as string).trim(),
      ctx.actor,
      firstStepDelayDays,
    )
    return apiSuccess({ enrollment }, 201)
  } catch (err) {
    console.error('[sequence-enrollments-create-error]', err)
    return apiError('Internal Server Error', 500)
  }
})
