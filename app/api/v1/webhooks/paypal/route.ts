/**
 * POST /api/v1/webhooks/paypal — PUBLIC
 *
 * Receives inbound PayPal webhook events. Signature is verified via
 * PayPal's `/v1/notifications/verify-webhook-signature` endpoint
 * (requires PAYPAL_WEBHOOK_ID env var).
 *
 * On `CHECKOUT.ORDER.APPROVED` or `PAYMENT.CAPTURE.COMPLETED` we look up
 * the invoice by `paypalOrderId` and mark it paid.
 *
 * IMPORTANT: always return 200 quickly — PayPal retries non-2xx
 * aggressively. All handling errors are logged and swallowed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { verifyPayPalWebhook } from '@/lib/payments/paypal'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { rejectGenericPartnerTradeMutation } from '@/lib/partner-links/invoice-guard'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let event: Record<string, unknown> | null = null
  try {
    // Read body as text first (we need it verbatim for PayPal's verification),
    // then JSON-parse for the verify call + handler.
    const raw = await req.text()
    event = raw ? JSON.parse(raw) : null

    const verified = await verifyPayPalWebhook(req.headers, event)
    if (!verified) {
      console.warn('[paypal webhook] signature verification failed')
      return NextResponse.json({ received: true, verified: false }, { status: 200 })
    }

    if (!event) return NextResponse.json({ received: true }, { status: 200 })
    await handleEvent(event)
  } catch (err) {
    console.error('[paypal webhook] handler error:', err)
  }

  // Always 200 — PayPal retries on non-2xx.
  return NextResponse.json({ received: true }, { status: 200 })
}

async function handleEvent(event: Record<string, unknown>) {
  const eventType = event.event_type as string | undefined
  const resource = event.resource as Record<string, unknown> | undefined
  if (!eventType || !resource) return

  // Resolve the PayPal order id. Shapes differ by event type:
  //  - CHECKOUT.ORDER.APPROVED: resource.id = order id
  //  - PAYMENT.CAPTURE.COMPLETED: resource.supplementary_data.related_ids.order_id
  let orderId: string | undefined
  if (eventType === 'CHECKOUT.ORDER.APPROVED') {
    orderId = resource.id as string | undefined
  } else if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
    const related = (
      resource.supplementary_data as
        | { related_ids?: { order_id?: string } }
        | undefined
    )?.related_ids
    orderId = related?.order_id
  } else {
    // Other event types — ignore for now.
    return
  }

  if (!orderId) return

  const snap = await adminDb
    .collection('invoices')
    .where('paypalOrderId', '==', orderId)
    .limit(1)
    .get()
  if (snap.empty) return

  const doc = snap.docs[0]
  const invoice = doc.data() ?? {}
  const genericMutationError = rejectGenericPartnerTradeMutation(invoice)
  if (genericMutationError) {
    console.warn(`[paypal webhook] canonical partner invoice ${doc.id} ignored; canonical settlement is required`)
    return
  }
  if (invoice.status === 'paid') return // idempotent

  const captureId =
    eventType === 'PAYMENT.CAPTURE.COMPLETED'
      ? (resource.id as string | undefined)
      : undefined

  await doc.ref.update({
    status: 'paid',
    paidAt: FieldValue.serverTimestamp(),
    paymentMethod: 'paypal',
    paymentReference: captureId ?? orderId,
    paidAmount: Number(invoice.total ?? 0),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: 'paypal-webhook',
    updatedByType: 'system',
  })

  await adminDb.collection('activities').add({
    orgId: invoice.orgId ?? null,
    type: 'invoice.paid',
    resourceType: 'invoice',
    resourceId: doc.id,
    summary: `Invoice ${invoice.invoiceNumber ?? doc.id} paid via PayPal webhook (${captureId ?? orderId})`,
    createdBy: 'paypal-webhook',
    createdByType: 'system',
    createdAt: FieldValue.serverTimestamp(),
  })

  const orgId: string | undefined = invoice.orgId
  if (orgId) {
    const webhookPayload = {
      id: doc.id,
      invoiceNumber: invoice.invoiceNumber ?? doc.id,
      total: Number(invoice.total ?? 0),
      paymentMethod: 'paypal',
      paymentReference: captureId ?? orderId,
      paidAmount: Number(invoice.total ?? 0),
    }
    try {
      await dispatchWebhook(orgId, 'invoice.paid', webhookPayload)
    } catch (err) {
      console.error('[webhook-dispatch-error] invoice.paid', err)
    }
    try {
      await dispatchWebhook(orgId, 'payment.received', webhookPayload)
    } catch (err) {
      console.error('[webhook-dispatch-error] payment.received', err)
    }
  }
}
