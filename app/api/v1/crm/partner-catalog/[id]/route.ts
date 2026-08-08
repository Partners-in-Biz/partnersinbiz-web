import { apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { unpublishCatalogItem } from '@/lib/partner-links/trade'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Stop offering a product to that partner. Supplier only. */
export const DELETE = withCrmAuth<RouteContext>('member', async (_req, ctx, routeCtx) => {
  try {
    const { id } = await routeCtx!.params
    await unpublishCatalogItem({ supplierOrgId: ctx.orgId, itemId: id, actor: ctx.actor })
    return apiSuccess({ id, unpublished: true })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
