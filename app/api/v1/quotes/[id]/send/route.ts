/**
 * POST /api/v1/quotes/[id]/send — draft → sent, email recipient with PDF attachment.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { crmActorCanReadBillingRecord } from '@/lib/billing/crm-record-scope'
import { getResendClient, FROM_ADDRESS } from '@/lib/email/resend'
import { quoteSentEmail } from '@/lib/email/templates'
import { renderInvoicePdf } from '@/lib/invoices/pdf-generator'
import { invoiceLikeFromQuoteRecord } from '@/lib/invoices/commerce-html'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import type { Quote } from '@/lib/quotes/types'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }
type QuoteAccess = 'sender' | 'recipient' | 'legacy'

function ctxCanAccessOrg(ctx: CrmAuthContext, orgId: string): boolean {
  if (ctx.isAgent) return true
  if (!ctx.user) return orgId === ctx.orgId
  return canAccessOrg({
    uid: ctx.user.uid,
    role: ctx.user.role === 'admin' ? 'admin' : 'client',
    orgId: ctx.user.orgId,
    allowedOrgIds: ctx.user.allowedOrgIds,
  }, orgId)
}

function accessForQuote(data: Quote, ctx: CrmAuthContext): QuoteAccess | null {
  const sourceOrgId = data.sourceOrgId || data.orgId
  const recipientOrgId = data.recipientOrgId || data.targetOrgId
  if (sourceOrgId && ctxCanAccessOrg(ctx, sourceOrgId)) return 'sender'
  if (recipientOrgId && ctxCanAccessOrg(ctx, recipientOrgId)) return 'recipient'
  if (!data.sourceOrgId && !data.recipientOrgId && data.orgId && ctxCanAccessOrg(ctx, data.orgId)) return 'legacy'
  return null
}

export const POST = withCrmAuth<RouteCtx>('member', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const ref = adminDb.collection('quotes').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Quote not found', 404)
  const data = snap.data() as Quote
  if (data.deleted === true) return apiError('Quote not found', 404)

  const access = accessForQuote(data, ctx)
  if (!access) return apiError('Quote not found', 404)
  if (access === 'recipient') return apiError('Only the sender can send this quote', 403)
  const allowed = await crmActorCanReadBillingRecord(ctx, { id, ...data })
  if (!allowed) return apiError('Quote not found', 404)

  if (data.status !== 'draft') {
    return apiError(`Quote cannot be sent from status '${data.status}'`, 400)
  }

  const clientEmail = data.clientDetails?.email ?? data.recipientEmail
  if (!clientEmail) {
    return apiError('Quote has no client email to send to', 400)
  }

  await ref.update({
    status: 'sent',
    sentAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: ctx.uid,
    updatedByRef: ctx.actor,
  })

  let emailed = false
  try {
    const quoteNumber = data.quoteNumber || id
    const total = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: data.currency ?? 'USD',
    }).format(data.total ?? 0)
    const validUntilMs = (() => {
      const value = data.validUntil
      if (!value || typeof value !== 'object') return 0
      const timestamp = value as {
        toMillis?: () => number
        seconds?: number
        _seconds?: number
      }
      if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
      const seconds = timestamp.seconds ?? timestamp._seconds
      return typeof seconds === 'number' ? seconds * 1000 : 0
    })()
    const validUntil = validUntilMs
      ? new Date(validUntilMs).toLocaleDateString('en-ZA', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : 'N/A'
    const html = quoteSentEmail(
      quoteNumber,
      total,
      validUntil,
      data.clientDetails?.name ?? data.recipientName ?? data.recipientCompanyName ?? 'there',
    )
    const pdfBuffer = await renderInvoicePdf(invoiceLikeFromQuoteRecord(data as unknown as Record<string, unknown>, id))
    await getResendClient().emails.send({
      from: FROM_ADDRESS,
      to: clientEmail,
      subject: `Quote ${quoteNumber}`,
      html,
      attachments: [{
        filename: `${quoteNumber}.pdf`,
        content: pdfBuffer,
      }],
    })
    emailed = true
  } catch (err) {
    console.error('[quotes/send] email failed:', err)
  }

  const orgId = data.sourceOrgId || data.orgId
  if (orgId) {
    try {
      await dispatchWebhook(orgId, 'quote.sent', {
        id,
        quoteNumber: data.quoteNumber ?? id,
        total: data.total,
        currency: data.currency ?? 'USD',
        clientEmail,
      })
    } catch (err) {
      console.error('[webhook-dispatch-error] quote.sent', err)
    }
  }

  return apiSuccess({
    id,
    status: 'sent',
    sentAt: new Date().toISOString(),
    emailed,
    recipientEmail: clientEmail,
  })
})
