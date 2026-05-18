/**
 * GET /api/v1/crm/contacts/:id/enrollments — list enrollments for contact (member+)
 */
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listEnrollments } from '@/lib/sequences/enrollment'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

// ── GET ─────────────────────────────────────────────────────────────────────────

export const GET = withCrmAuth<RouteCtx>('member', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params

  try {
    const enrollments = await listEnrollments(ctx.orgId, { contactId: id })
    return apiSuccess({ enrollments })
  } catch (err) {
    console.error('[contact-enrollments-list-error]', err)
    return apiError('Internal Server Error', 500)
  }
})
