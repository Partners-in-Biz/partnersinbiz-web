import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { cleanString } from '@/lib/partner-links/identity'
import { decidePartnerOrder } from '@/lib/partner-links/trade'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * PATCH { decision: 'confirm' | 'reject' }
 * Supplier-side only. Confirming reserves stock and drafts an invoice.
 */
export const PATCH = withCrmAuth<RouteContext>('member', async (req: NextRequest, ctx: CrmAuthContext, routeCtx) => {
  try {
    const { id } = await routeCtx!.params
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const decision = cleanString(body.decision)
    if (decision !== 'confirm' && decision !== 'reject') {
      return apiError('decision must be "confirm" or "reject"', 400)
    }

    const result = await decidePartnerOrder({
      supplierOrgId: ctx.orgId,
      orderId: id,
      decision,
      actor: ctx.actor,
    })
    return apiSuccess(result)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
