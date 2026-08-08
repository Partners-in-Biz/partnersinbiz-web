import { apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { loadPartnerOverview } from '@/lib/partner-links/collaboration'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ relationshipId: string }> }

/** Everything about one relationship, scoped entirely to the caller's tenant. */
export const GET = withCrmAuth<RouteContext>('viewer', async (_req, ctx, routeCtx) => {
  try {
    const { relationshipId } = await routeCtx!.params
    return apiSuccess(await loadPartnerOverview({ orgId: ctx.orgId, relationshipId }))
  } catch (err) {
    return apiErrorFromException(err)
  }
})
