/**
 * POST /api/v1/invoices/[id]/paypal-capture
 *
 * Captures a previously-created PayPal order. On success, marks the
 * invoice `paid` with `paymentMethod='paypal'` and
 * `paymentReference=<captureId>`.
 *
 * Body: { orderId: string } — must match invoice.paypalOrderId.
 *
 * Auth: admin (ai satisfies).
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom, lastActorFrom } from '@/lib/api/actor'
import { capturePayPalOrder } from '@/lib/payments/paypal'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { tryAttributeInvoicePaid } from '@/lib/email-analytics/attribution-hooks'
import { requireInvoiceAccess } from '@/lib/invoices/access'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req, user, ctx) => {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    return apiError('PayPal is not configured', 503)
  }

  const { id } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({}))
  const orderId = typeof body.orderId === 'string' ? body.orderId : null
  if (!orderId) return apiError('orderId is required', 400)

  const access = await requireInvoiceAccess(user, id)
  if (!access.ok) return access.response
  const ref = access.ref
  const invoice = access.data

  if (invoice.paypalOrderId && invoice.paypalOrderId !== orderId) {
    return apiError('orderId does not match invoice.paypalOrderId', 400)
  }

  try {
    const capture = await capturePayPalOrder(orderId)
    if (capture.status !== 'COMPLETED') {
      return apiError(`PayPal capture status: ${capture.status}`, 502)
    }

    const invoiceNumber: string = invoice.invoiceNumber ?? id
    const orgId: string | undefined = invoice.orgId
    const createdBy: string | undefined = invoice.createdBy

    await ref.update({
      status: 'paid',
      paidAt: FieldValue.serverTimestamp(),
      paymentMethod: 'paypal',
      paymentReference: capture.captureId ?? capture.id,
      paidAmount: Number(invoice.total ?? 0),
      paymentProofConfirmedBy: user.uid,
      ...lastActorFrom(user),
    })

    await adminDb.collection('activities').add({
      orgId: orgId ?? null,
      type: 'invoice.paid',
      resourceType: 'invoice',
      resourceId: id,
      summary: `Invoice ${invoiceNumber} paid via PayPal (${capture.captureId ?? capture.id})`,
      ...actorFrom(user),
      createdAt: FieldValue.serverTimestamp(),
    })

    if (createdBy && createdBy !== user.uid) {
      await adminDb.collection('notifications').add({
        orgId: orgId ?? null,
        userId: createdBy,
        agentId: null,
        type: 'invoice.paid',
        title: 'Invoice paid',
        body: `Invoice ${invoiceNumber} was paid via PayPal`,
        link: `/admin/invoices/${id}`,
        status: 'unread',
        priority: 'normal',
        createdAt: FieldValue.serverTimestamp(),
      })
    }

    if (orgId) {
      const webhookPayload = {
        id,
        invoiceNumber,
        total: Number(invoice.total ?? 0),
        paymentMethod: 'paypal',
        paymentReference: capture.captureId ?? capture.id,
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

    // Best-effort: attribute the paid invoice to the most recent email click.
    await tryAttributeInvoicePaid({
      orgId,
      contactId: typeof invoice.contactId === 'string' ? invoice.contactId : null,
      invoiceId: id,
      amount: Number(invoice.total ?? 0),
      currency: typeof invoice.currency === 'string' ? invoice.currency : 'ZAR',
    })

    return apiSuccess({ id, status: 'paid', captureId: capture.captureId })
  } catch (err) {
    console.error('[paypal-capture] failed:', err)
    return apiError('Failed to capture PayPal order', 502)
  }
})
