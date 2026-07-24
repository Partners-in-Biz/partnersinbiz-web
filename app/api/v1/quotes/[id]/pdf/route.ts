import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { crmActorCanReadBillingRecord } from '@/lib/billing/crm-record-scope'
import { renderInvoicePdf } from '@/lib/invoices/pdf-generator'
import { invoiceLikeFromQuoteRecord } from '@/lib/invoices/commerce-html'
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

/**
 * GET /api/v1/quotes/[id]/pdf
 * Returns a PDF binary for Messages Context Dock download / email attach.
 */
export const GET = withCrmAuth<RouteCtx>('viewer', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const snap = await adminDb.collection('quotes').doc(id).get()
  if (!snap.exists) return apiError('Quote not found', 404)
  const data = snap.data() as Quote
  if (data.deleted === true) return apiError('Quote not found', 404)

  const access = accessForQuote(data, ctx)
  if (!access) return apiError('Quote not found', 404)
  if (access === 'sender' || access === 'legacy') {
    const allowed = await crmActorCanReadBillingRecord(ctx, { id, ...data })
    if (!allowed) return apiError('Quote not found', 404)
  }

  try {
    const pdfBuffer = await renderInvoicePdf(invoiceLikeFromQuoteRecord(data as unknown as Record<string, unknown>, id))
    const filename = `${data.quoteNumber || id}.pdf`
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    console.error('[quotes/pdf] Error:', error)
    return apiError('Failed to generate quote PDF', 500)
  }
})
