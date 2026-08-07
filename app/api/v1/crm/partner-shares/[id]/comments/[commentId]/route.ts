import { apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { deleteShareComment } from '@/lib/partner-links/shares'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; commentId: string }> }

/** Soft-delete your own comment. Only the org that wrote it may remove it. */
export const DELETE = withCrmAuth<RouteContext>('member', async (_req, ctx, routeCtx) => {
  try {
    const { commentId } = await routeCtx!.params
    await deleteShareComment({ commentId, viewerOrgId: ctx.orgId })
    return apiSuccess({ id: commentId, deleted: true })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
