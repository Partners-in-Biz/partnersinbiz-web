import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { memberCanIssueInvoices, canAccessModule } from '@/lib/orgMembers/access-policy'
import { cleanString } from '@/lib/partner-links/identity'
import { decidePartnerPayment, recordPartnerPayment } from '@/lib/partner-links/settlement'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ invoiceId: string }> }

/**
 * POST — one of:
 *   Idempotency-Key header is required for every transition.
 *   { action: 'pay',    reference, amount, fileId?, note? }   buyer records payment
 *   { action: 'confirm' | 'reject', note? }                    issuer verifies
 *
 * Verification belongs to the org that issued the invoice, unlike the
 * platform-admin-only /invoices/{id}/confirm-payment route.
 */
export const POST = withCrmAuth<RouteContext>('member', async (req: NextRequest, ctx: CrmAuthContext, routeCtx) => {
  try {
    const { invoiceId } = await routeCtx!.params
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = cleanString(body.action)
    const idempotencyKey = cleanString(req.headers.get('idempotency-key'))
    if (!idempotencyKey) return apiError('Idempotency-Key header is required', 400)

    if (action === 'pay') {
      if (!ctx.isAgent && !canAccessModule(ctx.accessPolicy, 'billing')) {
        return apiError('Billing access is required to record a partner payment', 403)
      }
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
        idempotencyKey,
        actor: ctx.actor,
      })
      return apiSuccess(result)
    }

    if (action === 'confirm' || action === 'reject') {
      if (ctx.isAgent) {
        return apiError('A human finance approver must verify or dispute a partner payment', 403)
      }
      if (!canAccessModule(ctx.accessPolicy, 'billing') || !memberCanIssueInvoices(ctx.accessPolicy)) {
        return apiError('Billing and invoice issuer access are required to verify a partner payment', 403)
      }
      const result = await decidePartnerPayment({
        issuerOrgId: ctx.orgId,
        invoiceId,
        decision: action,
        note: cleanString(body.note) || undefined,
        idempotencyKey,
        actor: ctx.actor,
      })
      return apiSuccess(result)
    }

    return apiError('action must be "pay", "confirm" or "reject"', 400)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
