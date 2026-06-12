/**
 * GET /api/v1/crm/contacts/:id/enrollments — list enrollments for contact (member+)
 */
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listEnrollments } from '@/lib/sequences/enrollment'
import { getSequence } from '@/lib/sequences/store'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

// ── GET ─────────────────────────────────────────────────────────────────────────

export const GET = withCrmAuth<RouteCtx>('member', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params

  try {
    const enrollments = await listEnrollments(ctx.orgId, { contactId: id })

    // Enrich with sequence names — enrollment docs only store sequenceId, but
    // the contact panel needs a human-readable label per row.
    const sequenceIds = [...new Set(enrollments.map((e) => e.sequenceId).filter(Boolean))]
    const names = new Map<string, string>()
    await Promise.all(sequenceIds.map(async (sequenceId) => {
      const sequence = await getSequence(ctx.orgId, sequenceId)
      if (sequence?.name) names.set(sequenceId, sequence.name)
    }))

    return apiSuccess({
      enrollments: enrollments.map((e) => ({
        ...e,
        sequenceName: names.get(e.sequenceId) ?? '',
      })),
    })
  } catch (err) {
    console.error('[contact-enrollments-list-error]', err)
    return apiError('Internal Server Error', 500)
  }
})
