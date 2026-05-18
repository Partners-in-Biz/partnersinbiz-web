/**
 * DELETE /api/v1/crm/sequences/:id/enrollments/:enrollmentId — unenroll contact (member+)
 */
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { unenrollContact } from '@/lib/sequences/enrollment'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string; enrollmentId: string }> }

// ── DELETE ──────────────────────────────────────────────────────────────────────

export const DELETE = withCrmAuth<RouteCtx>('member', async (_req, ctx, routeCtx) => {
  const { enrollmentId } = await routeCtx!.params

  try {
    await unenrollContact(ctx.orgId, enrollmentId, ctx.actor)
    return apiSuccess({ unenrolled: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/not found/i.test(message)) {
      return apiError('Not found', 404)
    }
    console.error('[sequence-enrollments-delete-error]', err)
    return apiError('Internal Server Error', 500)
  }
})
