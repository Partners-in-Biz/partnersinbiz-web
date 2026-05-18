/**
 * GET /api/v1/invoices/[id]/payment-instructions
 *
 * Returns the `PaymentInstructions` payload for an invoice — EFT bank
 * details, PayPal availability/URL, and the public view URL.
 *
 * Dual auth:
 *   - Admin / AI via Authorization header (full access)
 *   - Public via `?token=<publicToken>` matching the invoice's stored token
 *
 * The token path is what the public invoice view page uses, so it doesn't
 * need to proxy through an admin-authenticated server route.
 */
import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { resolveUser } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { buildPaymentInstructions } from '@/lib/payments/eft'
import { canAccessOrg } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: unknown): Promise<NextResponse> {
  const { id } = await (ctx as RouteContext).params
  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')

  const ref = adminDb.collection('invoices').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Invoice not found', 404)
  const invoice = snap.data() ?? {}

  const tokenMatches = Boolean(
    token && invoice.publicToken && token === invoice.publicToken,
  )

  if (!tokenMatches) {
    const user = await resolveUser(req)
    const hasAdmin = user && (user.role === 'admin' || user.role === 'ai')
    if (!hasAdmin) return apiError('Unauthorized — pass Bearer token or ?token=<publicToken>', 401)
    if (!canAccessOrg(user, invoice.orgId)) return apiError('Forbidden', 403)
  }

  let publicToken = invoice.publicToken as string | undefined
  if (!publicToken) {
    publicToken = crypto.randomBytes(16).toString('hex')
    await ref.update({ publicToken, updatedAt: FieldValue.serverTimestamp() })
  }

  const platformSnap = await adminDb
    .collection('organizations')
    .where('type', '==', 'platform_owner')
    .limit(1)
    .get()
  const platformOrg = platformSnap.empty ? null : platformSnap.docs[0].data()

  const payload = buildPaymentInstructions(
    {
      id,
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total,
      currency: invoice.currency,
      dueDate: invoice.dueDate,
      publicToken,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    platformOrg as any,
  )

  return apiSuccess(payload)
}
