import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { cleanString } from '@/lib/partner-links/identity'
import { loadSharedRecord, revokePartnerShare, setSharePermission } from '@/lib/partner-links/shares'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET — read the shared record itself. Only the receiving org may call this;
 * it is the sanctioned cross-org read described in lib/partner-links/shares.ts.
 */
export const GET = withCrmAuth<RouteContext>('viewer', async (_req, ctx, routeCtx) => {
  try {
    const { id } = await routeCtx!.params
    const view = await loadSharedRecord({ shareId: id, viewerOrgId: ctx.orgId })
    return apiSuccess(view)
  } catch (err) {
    return apiErrorFromException(err)
  }
})

/** PATCH — switch a share between view-only and comment. Owning org only. */
export const PATCH = withCrmAuth<RouteContext>('member', async (req: NextRequest, ctx: CrmAuthContext, routeCtx) => {
  try {
    const { id } = await routeCtx!.params
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const permission = cleanString(body.permission)
    if (permission !== 'view' && permission !== 'comment') {
      return apiError('permission must be "view" or "comment"', 400)
    }
    const share = await setSharePermission({
      shareId: id,
      ownerOrgId: ctx.orgId,
      permission,
      actor: ctx.actor,
    })
    return apiSuccess({ share })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

/** DELETE — stop sharing. Only the org that owns the record may revoke. */
export const DELETE = withCrmAuth<RouteContext>('member', async (_req, ctx, routeCtx) => {
  try {
    const { id } = await routeCtx!.params
    const share = await revokePartnerShare({
      shareId: id,
      actingOrgId: ctx.orgId,
      actor: ctx.actor,
    })
    return apiSuccess({ share })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
