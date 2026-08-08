import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { cleanString } from '@/lib/partner-links/identity'
import {
  cancelPartnerOrder,
  decidePartnerOrder,
  fulfilPartnerOrder,
  type FulfilAction,
} from '@/lib/partner-links/trade'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const FULFIL_ACTIONS = ['pack', 'ship', 'deliver']

/**
 * PATCH — one of:
 *   { decision: 'confirm' | 'reject' }                  supplier decides
 *   { action: 'pack' | 'ship' | 'deliver', carrier?, trackingNumber?, trackingUrl? }
 *   { action: 'cancel' }                                either side, per the rules
 *
 * Confirming reserves stock and drafts an invoice; shipping consumes the
 * reservation; cancelling a confirmed order releases it.
 */
export const PATCH = withCrmAuth<RouteContext>('member', async (req: NextRequest, ctx: CrmAuthContext, routeCtx) => {
  try {
    const { id } = await routeCtx!.params
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const decision = cleanString(body.decision)
    const action = cleanString(body.action)

    if (decision) {
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
    }

    if (action === 'cancel') {
      const result = await cancelPartnerOrder({ orgId: ctx.orgId, orderId: id, actor: ctx.actor })
      return apiSuccess(result)
    }

    if (FULFIL_ACTIONS.includes(action)) {
      const result = await fulfilPartnerOrder({
        supplierOrgId: ctx.orgId,
        orderId: id,
        action: action as FulfilAction,
        carrier: cleanString(body.carrier) || undefined,
        trackingNumber: cleanString(body.trackingNumber) || undefined,
        trackingUrl: cleanString(body.trackingUrl) || undefined,
        actor: ctx.actor,
      })
      return apiSuccess(result)
    }

    return apiError('Provide a decision (confirm|reject) or an action (pack|ship|deliver|cancel)', 400)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
