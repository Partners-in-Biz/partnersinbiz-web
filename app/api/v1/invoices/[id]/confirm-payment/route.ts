/**
 * POST /api/v1/invoices/[id]/confirm-payment
 *
 * Admin confirms or rejects a previously-uploaded payment proof.
 *
 * Body (confirm):
 *   { confirmed: true, paymentMethod: 'eft' | 'paypal' | 'cash' | 'card' | 'other',
 *     reference?: string, amount?: number }
 *
 * Body (reject):
 *   { confirmed: false, reason: string }
 *
 * Auth: admin (ai satisfies).
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom, lastActorFrom } from '@/lib/api/actor'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { tryAttributeInvoicePaid } from '@/lib/email-analytics/attribution-hooks'
import { requireInvoiceAccess } from '@/lib/invoices/access'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const VALID_METHODS = ['eft', 'paypal', 'cash', 'card', 'other'] as const
type PaymentMethod = (typeof VALID_METHODS)[number]

export const POST = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({}))

  const access = await requireInvoiceAccess(user, id)
  if (!access.ok) return access.response
  const ref = access.ref
  const invoice = access.data
  const invoiceNumber: string = invoice.invoiceNumber ?? id
  const orgId: string | undefined = invoice.orgId
  const createdBy: string | undefined = invoice.createdBy
  const uploadedBy: string | undefined = invoice.updatedBy

  if (body.confirmed === true) {
    const paymentMethod = body.paymentMethod as PaymentMethod | undefined
    if (!paymentMethod || !VALID_METHODS.includes(paymentMethod)) {
      return apiError(
        `paymentMethod is required and must be one of: ${VALID_METHODS.join(', ')}`,
        400,
      )
    }

    const updates: Record<string, unknown> = {
      status: 'paid',
      paidAt: FieldValue.serverTimestamp(),
      paymentMethod,
      paidAmount: typeof body.amount === 'number' ? body.amount : invoice.total,
      paymentProofConfirmedBy: user.uid,
      ...lastActorFrom(user),
    }
    if (typeof body.reference === 'string') updates.paymentReference = body.reference

    await ref.update(updates)

    await adminDb.collection('activities').add({
      orgId: orgId ?? null,
      type: 'invoice.paid',
      resourceType: 'invoice',
      resourceId: id,
      summary: `Invoice ${invoiceNumber} confirmed paid via ${paymentMethod}`,
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
        body: `Invoice ${invoiceNumber} was confirmed paid`,
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
        total: invoice.total,
        paymentMethod,
        paymentReference: typeof body.reference === 'string' ? body.reference : null,
        paidAmount: typeof body.amount === 'number' ? body.amount : invoice.total,
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
      amount: typeof body.amount === 'number' ? body.amount : invoice.total,
      currency: typeof invoice.currency === 'string' ? invoice.currency : 'ZAR',
    })

    return apiSuccess({ id, status: 'paid' })
  }

  // Rejection branch
  if (body.confirmed === false) {
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason : null
    if (!reason) return apiError('reason is required when rejecting', 400)

    await ref.update({
      status: 'sent',
      paymentProofRejectedReason: reason,
      paymentProofRejectedAt: FieldValue.serverTimestamp(),
      ...lastActorFrom(user),
    })

    await adminDb.collection('activities').add({
      orgId: orgId ?? null,
      type: 'invoice.proof_rejected',
      resourceType: 'invoice',
      resourceId: id,
      summary: `Payment proof rejected for invoice ${invoiceNumber}: ${reason}`,
      ...actorFrom(user),
      createdAt: FieldValue.serverTimestamp(),
    })

    // Notify the user who uploaded proof (falls back to creator if unknown).
    const notifyUserId = uploadedBy ?? createdBy
    if (notifyUserId && notifyUserId !== user.uid) {
      await adminDb.collection('notifications').add({
        orgId: orgId ?? null,
        userId: notifyUserId,
        agentId: null,
        type: 'invoice.proof_rejected',
        title: 'Payment proof rejected',
        body: `Invoice ${invoiceNumber}: ${reason}`,
        link: `/admin/invoices/${id}`,
        status: 'unread',
        priority: 'high',
        createdAt: FieldValue.serverTimestamp(),
      })
    }

    return apiSuccess({ id, status: 'sent' })
  }

  return apiError('confirmed (boolean) is required', 400)
})
