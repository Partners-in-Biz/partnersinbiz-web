import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { resolveUser } from '@/lib/api/auth'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { apiError } from '@/lib/api/response'
import { renderInvoicePdf } from '@/lib/invoices/pdf-generator'
import { checkAndIncrementRateLimit } from '@/lib/rateLimit'
import {
  INVOICE_PDF_RATE_LIMIT,
  INVOICE_PDF_RATE_LIMIT_WINDOW_MS,
  invoicePdfRateLimitKey,
  invoicePdfShareTokenMatches,
} from '@/lib/invoices/share-token'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }
type InvoiceRecord = Record<string, unknown>

function requestIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || req.headers.get('x-real-ip') || 'unknown'
}

async function isAuthenticatedInvoiceViewer(req: NextRequest, invoiceData: InvoiceRecord): Promise<boolean> {
  const user = await resolveUser(req)
  if (!user) return false

  const orgIds = [
    invoiceData.orgId,
    invoiceData.sourceOrgId,
    invoiceData.recipientOrgId,
    invoiceData.targetOrgId,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
  const requestedOrgId = new URL(req.url).searchParams.get('orgId')?.trim()

  if (requestedOrgId) {
    return orgIds.includes(requestedOrgId) && canAccessOrg(user, requestedOrgId)
  }

  return orgIds.some((orgId) => canAccessOrg(user, orgId))
}

async function enforcePublicRateLimit(req: NextRequest, invoiceId: string) {
  const limit = await checkAndIncrementRateLimit({
    key: invoicePdfRateLimitKey(invoiceId, requestIp(req)),
    limit: INVOICE_PDF_RATE_LIMIT,
    windowMs: INVOICE_PDF_RATE_LIMIT_WINDOW_MS,
  })

  if (!limit.allowed) {
    return apiError('Too many invoice PDF requests. Try again later.', 429)
  }

  return null
}

// Public endpoint — anonymous access requires the dedicated PDF share token.
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params

  try {
    // Fetch invoice document
    const invoiceDoc = await adminDb.collection('invoices').doc(id).get()
    if (!invoiceDoc.exists) {
      return apiError('Invoice not found', 404)
    }

    const invoiceData = invoiceDoc.data() as InvoiceRecord
    const invoice = { id: invoiceDoc.id, ...invoiceData }
    const requestedToken = new URL(req.url).searchParams.get('t')
    const tokenMatches = invoicePdfShareTokenMatches(invoiceData.pdfShareToken, requestedToken)
    const authenticated = tokenMatches ? false : await isAuthenticatedInvoiceViewer(req, invoiceData)

    if (!authenticated) {
      const rateLimited = await enforcePublicRateLimit(req, id)
      if (rateLimited) return rateLimited
    }

    if (!tokenMatches && !authenticated) {
      return apiError('Forbidden', 403)
    }

    // Generate and return a real PDF. The browser may open it inline or download it,
    // but the payload must be application/pdf rather than printable HTML.
    const pdfBuffer = await renderInvoicePdf(invoice)
    const filename = `${invoiceData.invoiceNumber || id}.pdf`

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    console.error('[invoices/pdf] Error:', error)
    return apiError('Failed to generate invoice PDF', 500)
  }
}
