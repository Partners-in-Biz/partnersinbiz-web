import { apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { unlinkPartnership } from '@/lib/partner-links/store'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ relationshipId: string }> }

/**
 * Either side of a partner link may sever it unilaterally. Both relationship
 * rows go `revoked` and the cross-org pointers are cleared; the underlying CRM
 * companies and contacts survive.
 */
export const POST = withCrmAuth<RouteContext>('member', async (_req, ctx, routeCtx) => {
  try {
    const { relationshipId } = await routeCtx!.params
    const result = await unlinkPartnership({
      relationshipId,
      actingOrgId: ctx.orgId,
      actor: ctx.actor,
    })
    return apiSuccess(result)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
