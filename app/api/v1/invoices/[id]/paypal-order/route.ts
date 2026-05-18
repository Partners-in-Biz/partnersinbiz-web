/**
 * POST /api/v1/invoices/[id]/paypal-order
 *
 * Creates a PayPal CAPTURE order for the invoice amount, stores the
 * `paypalOrderId` on the invoice, and returns the approve URL that the
 * public view page should redirect the payer to.
 *
 * Returns 503 if PayPal env vars are missing.
 *
 * Auth: admin (ai satisfies). The public view page proxies through
 * server-side with the admin key.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import { createPayPalOrder } from '@/lib/payments/paypal'
import { requireInvoiceAccess } from '@/lib/invoices/access'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  'https://partnersinbiz.online'

export const POST = withAuth('admin', async (req, user, ctx) => {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    return apiError('PayPal is not configured', 503)
  }

  const { id } = await (ctx as RouteContext).params
  const access = await requireInvoiceAccess(user, id)
  if (!access.ok) return access.response
  const ref = access.ref
  const invoice = access.data

  const publicToken: string | undefined = invoice.publicToken
  if (!publicToken) {
    return apiError(
      'Invoice has no publicToken — call /send or /payment-instructions first',
      400,
    )
  }

  const returnUrl = `${PUBLIC_BASE_URL}/invoice/${publicToken}?paypal=return`
  const cancelUrl = `${PUBLIC_BASE_URL}/invoice/${publicToken}?paypal=cancel`

  try {
    const order = await createPayPalOrder(
      Number(invoice.total ?? 0),
      invoice.currency ?? 'USD',
      invoice.invoiceNumber ?? id,
      returnUrl,
      cancelUrl,
    )

    await ref.update({
      paypalOrderId: order.id,
      ...lastActorFrom(user),
    })

    return apiSuccess({
      orderId: order.id,
      approveUrl: order.approveUrl,
      provider: 'paypal',
    })
  } catch (err) {
    console.error('[paypal-order] create failed:', err)
    return apiError('Failed to create PayPal order', 502)
  }
})
