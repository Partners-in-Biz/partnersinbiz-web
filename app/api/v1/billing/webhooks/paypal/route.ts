/**
 * POST /api/v1/billing/webhooks/paypal
 *
 * PUBLIC webhook receiver for PayPal events. NOT `withAuth` — PayPal calls this
 * unauthenticated, so we verify authenticity ourselves via PayPal's
 * webhook-signature verification API (`verifyPayPalWebhook`, which uses
 * `PAYPAL_WEBHOOK_ID` + the inbound `paypal-transmission-*` headers).
 *
 * Handled events:
 *   - CHECKOUT.ORDER.APPROVED       → ack (capture drives payment)
 *   - PAYMENT.CAPTURE.COMPLETED     → settle the linked invoice as paid
 *
 * Invoice resolution order:
 *   1. PayPal order `custom_id` (we may set this to the invoiceId in future)
 *   2. matching `paypalOrderId` stored on the invoice (set by paypal-order route)
 *   3. order/capture `reference_id` matched against `invoiceNumber`
 *
 * Idempotency:
 *   - every event is recorded in `webhook_events` keyed by `paypal:<eventId>`;
 *     a duplicate event id → ack 200 without re-processing
 *   - already-paid invoices → ack 200 without re-processing (settleInvoicePaid
 *     is itself idempotent)
 *
 * Responses:
 *   - 401 only for signature verification failures
 *   - 400 only for unparseable bodies
 *   - 200 for everything handled, ignored, or duplicate
 *
 * Env: PAYPAL_WEBHOOK_ID (required in production). A documented bypass is
 * allowed ONLY when `PAYPAL_WEBHOOK_ID` is unset AND a trusted internal secret
 * header `x-pib-webhook-secret` matches `EFT_WEBHOOK_SECRET` (constant-time).
 */
import { NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { verifyPayPalWebhook } from '@/lib/payments/paypal'
import { settleInvoicePaid } from '@/lib/billing/settle-invoice'

export const dynamic = 'force-dynamic'

/** Constant-time secret comparison via SHA-256 digests (equal length). */
function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

interface PayPalEvent {
  id?: string
  event_type?: string
  resource?: {
    id?: string
    custom_id?: string
    invoice_id?: string
    supplementary_data?: {
      related_ids?: { order_id?: string }
    }
    purchase_units?: Array<{
      reference_id?: string
      custom_id?: string
      invoice_id?: string
    }>
  }
}

/** Resolve the platform invoice doc id from a PayPal event resource. */
async function resolveInvoiceId(event: PayPalEvent): Promise<string | null> {
  const resource = event.resource ?? {}
  const pu = resource.purchase_units?.[0]

  // 1. custom_id (preferred future-proof link = invoiceId)
  const customId = resource.custom_id ?? pu?.custom_id
  if (customId) {
    const doc = await adminDb.collection('invoices').doc(customId).get()
    if (doc.exists) return doc.id
  }

  // 2. Stored paypalOrderId on the invoice. For PAYMENT.CAPTURE.COMPLETED the
  // order id lives under supplementary_data.related_ids.order_id; for
  // CHECKOUT.ORDER.* the order id is resource.id.
  const orderId =
    resource.supplementary_data?.related_ids?.order_id ??
    (event.event_type?.startsWith('CHECKOUT.ORDER') ? resource.id : undefined)
  if (orderId) {
    const snap = await adminDb
      .collection('invoices')
      .where('paypalOrderId', '==', orderId)
      .limit(1)
      .get()
    if (!snap.empty) return snap.docs[0].id
  }

  // 3. reference_id / invoice_id matched against invoiceNumber.
  const reference = pu?.reference_id ?? pu?.invoice_id ?? resource.invoice_id
  if (reference) {
    // Direct doc id hit first.
    const direct = await adminDb.collection('invoices').doc(reference).get()
    if (direct.exists) return direct.id
    const snap = await adminDb
      .collection('invoices')
      .where('invoiceNumber', '==', reference)
      .limit(1)
      .get()
    if (!snap.empty) return snap.docs[0].id
  }

  return null
}

export async function POST(req: Request) {
  const rawBody = await req.text()

  let event: PayPalEvent
  try {
    event = JSON.parse(rawBody) as PayPalEvent
  } catch {
    return NextResponse.json({ error: 'Unparseable body' }, { status: 400 })
  }

  // --- Verify authenticity ---------------------------------------------
  const webhookId = process.env.PAYPAL_WEBHOOK_ID
  if (webhookId) {
    const ok = await verifyPayPalWebhook(req.headers, event)
    if (!ok) {
      return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 })
    }
  } else {
    // Documented bypass: ONLY when PAYPAL_WEBHOOK_ID is unset and a trusted
    // internal secret header matches. Never silently accept in production.
    const bypassOk = secretMatches(
      req.headers.get('x-pib-webhook-secret'),
      process.env.EFT_WEBHOOK_SECRET,
    )
    if (!bypassOk) {
      console.error(
        '[paypal-webhook] PAYPAL_WEBHOOK_ID unset and no valid internal secret — rejecting',
      )
      return NextResponse.json(
        { error: 'Webhook verification unavailable' },
        { status: 401 },
      )
    }
    console.warn('[paypal-webhook] accepted via internal-secret bypass (PAYPAL_WEBHOOK_ID unset)')
  }

  const eventId = event.id
  const eventType = event.event_type ?? 'unknown'

  // --- Dedupe by event id ----------------------------------------------
  const eventKey = eventId ? `paypal:${eventId}` : null
  if (eventKey) {
    const existing = await adminDb.collection('webhook_events').doc(eventKey).get()
    if (existing.exists) {
      return NextResponse.json({ received: true, duplicate: true })
    }
  }

  // --- Only act on capture-completed; ack the rest ----------------------
  let invoiceId: string | null = null
  let settled = false

  if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
    invoiceId = await resolveInvoiceId(event)
    if (invoiceId) {
      const captureId = event.resource?.id ?? null
      const result = await settleInvoicePaid({
        invoiceId,
        paymentMethod: 'paypal',
        paymentReference: captureId,
        actorId: 'paypal-webhook',
        actorName: 'PayPal Webhook',
        actorRole: 'system',
      })
      settled = result.ok && !result.alreadyPaid
    } else {
      console.warn(
        `[paypal-webhook] could not resolve invoice for capture event ${eventId ?? '?'}`,
      )
    }
  }
  // CHECKOUT.ORDER.APPROVED and others: acknowledged, no action needed.

  // --- Record the event (idempotency ledger) ----------------------------
  if (eventKey) {
    await adminDb
      .collection('webhook_events')
      .doc(eventKey)
      .set({
        provider: 'paypal',
        eventId: eventId ?? null,
        eventType,
        invoiceId: invoiceId ?? null,
        settled,
        processedAt: FieldValue.serverTimestamp(),
      })
  }

  return NextResponse.json({ received: true, eventType, invoiceId, settled })
}
