import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/response'
import { requireInvoiceAccess } from '@/lib/invoices/access'
import { generateInvoiceHtml } from '@/lib/invoices/html-generator'
import { invoiceLikeFromInvoiceRecord } from '@/lib/invoices/commerce-html'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/v1/invoices/[id]/html
 *
 * Returns print-friendly invoice HTML for Messages Context Dock preview.
 * Auth: any caller who can read the invoice (client / admin / agent).
 */
export const GET = withAuth('client', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const requestedOrgId = new URL(req.url).searchParams.get('orgId')
  const access = await requireInvoiceAccess(user, id, requestedOrgId)
  if (!access.ok) return access.response

  try {
    const html = generateInvoiceHtml(invoiceLikeFromInvoiceRecord(access.data as Record<string, unknown>, id))
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    console.error('[invoices/html] Error:', error)
    return apiError('Failed to generate invoice HTML', 500)
  }
})
