import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { cleanString } from '@/lib/partner-links/identity'
import { decidePartnerPayment, recordPartnerPayment } from '@/lib/partner-links/settlement'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ invoiceId: string }> }

/**
 * POST — one of:
 *   { action: 'pay',    reference?, amount?, fileId?, note? }   buyer records payment
 *   { action: 'confirm' | 'reject', note? }                     issuer verifies
 *
 * Verification belongs to the org that issued the invoice, unlike the
 * platform-admin-only /invoices/{id}/confirm-payment route.
 */
export const POST = withCrmAuth<RouteContext>('member', async (req: NextRequest, ctx: CrmAuthContext, routeCtx) => {
  try {
    const { invoiceId } = await routeCtx!.params
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = cleanString(body.action)

    if (action === 'pay') {
      const rawAmount = body.amount
      const amount = rawAmount === undefined || rawAmount === null || rawAmount === ''
        ? undefined
        : Number(rawAmount)
      if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
        return apiError('amount must be a positive number', 400)
      }
      const result = await recordPartnerPayment({
        payerOrgId: ctx.orgId,
        invoiceId,
        reference: cleanString(body.reference) || undefined,
        amount,
        fileId: cleanString(body.fileId) || undefined,
        note: cleanString(body.note) || undefined,
        actor: ctx.actor,
      })
      return apiSuccess(result)
    }

    if (action === 'confirm' || action === 'reject') {
      const result = await decidePartnerPayment({
        issuerOrgId: ctx.orgId,
        invoiceId,
        decision: action,
        note: cleanString(body.note) || undefined,
        actor: ctx.actor,
      })
      return apiSuccess(result)
    }

    return apiError('action must be "pay", "confirm" or "reject"', 400)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
