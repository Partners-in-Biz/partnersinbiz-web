/**
 * POST /api/v1/invoices/[id]/mark-viewed — PUBLIC (no auth)
 *
 * Called by the public invoice view page when a client opens the link.
 * Query: `?token=<publicToken>` (required — must match invoice.publicToken).
 *
 * Side effects:
 *  - Sets `firstViewedAt` only if null (idempotent on first view).
 *  - Updates `lastViewedAt=serverTimestamp()`.
 *  - Increments `viewCount`.
 *  - If current status is 'sent', transitions to 'viewed'.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isCanonicalPartnerTradeInvoice } from '@/lib/partner-links/invoice-guard'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params
  const token = new URL(req.url).searchParams.get('token')
  if (!token) return apiError('token query param is required', 400)

  const ref = adminDb.collection('invoices').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Invoice not found', 404)

  const invoice = snap.data() ?? {}
  if (!invoice.publicToken || invoice.publicToken !== token) {
    return apiError('Invoice not found', 404)
  }

  const updates: Record<string, unknown> = {
    lastViewedAt: FieldValue.serverTimestamp(),
    viewCount: FieldValue.increment(1),
  }
  if (!invoice.firstViewedAt) {
    updates.firstViewedAt = FieldValue.serverTimestamp()
  }
  // Only auto-transition sent → viewed; leave paid/overdue/etc alone.
  // Canonical partner-trade invoices settle through the partner settlement
  // flow, never a public view-tracking route. View analytics are still
  // recorded, but the lifecycle status is immutable here.
  if (invoice.status === 'sent' && !isCanonicalPartnerTradeInvoice(invoice)) {
    updates.status = 'viewed'
  }

  await ref.update(updates)
  return apiSuccess({ viewed: true })
}
