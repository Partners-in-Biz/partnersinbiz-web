/**
 * POST /api/v1/admin/billing/invoices/[id]/verify-eft — confirm or reject an
 * EFT payment proof for an invoice in `payment_pending_verification`.
 *
 * Body: {
 *   action: 'confirm' | 'reject',
 *   reference?: string,   // confirm: bank reference recorded as paymentReference
 *   amount?: number,      // confirm: paid amount (defaults to invoice total)
 *   reason?: string,      // reject: reason recorded as eftRejectionReason
 * }
 *
 * confirm → invoice becomes `paid` (mirrors mark-paid: paidAt, paymentMethod 'eft',
 *           paymentReference, paidAmount; activity `invoice.paid`; notifies creator;
 *           dispatches `invoice.paid` + `payment.received` webhooks).
 * reject  → invoice returns to `sent`; records eftRejectionReason + eftRejectedAt;
 *           activity `invoice.eft_rejected`; notifies creator.
 *
 * Auth: admin (ai satisfies)
 */
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom, lastActorFrom } from '@/lib/api/actor'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { requireInvoiceAccess } from '@/lib/invoices/access'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({}))

  const action = body.action
  if (action !== 'confirm' && action !== 'reject') {
    return apiError("action is required and must be 'confirm' or 'reject'", 400)
  }

  const access = await requireInvoiceAccess(user, id)
  if (!access.ok) return access.response
  const ref = access.ref
  const invoice = access.data
  const orgId: string | undefined =
    typeof invoice.orgId === 'string' ? invoice.orgId : undefined
  const invoiceNumber: string =
    typeof invoice.invoiceNumber === 'string' ? invoice.invoiceNumber : id
  const createdBy: string | undefined =
    typeof invoice.createdBy === 'string' ? invoice.createdBy : undefined
  const invoiceTotal: number = typeof invoice.total === 'number' ? invoice.total : 0

  if (action === 'confirm') {
    const paidAmount = typeof body.amount === 'number' ? body.amount : invoiceTotal

    const updates: Record<string, unknown> = {
      status: 'paid',
      paidAt: FieldValue.serverTimestamp(),
      paymentMethod: 'eft',
      paidAmount,
      eftVerifiedAt: FieldValue.serverTimestamp(),
      ...lastActorFrom(user),
    }
    if (typeof body.reference === 'string' && body.reference.trim()) {
      updates.paymentReference = body.reference.trim()
    }

    await ref.update(updates)

    // Activity log entry (mirrors mark-paid)
    await adminDb.collection('activities').add({
      orgId: orgId ?? null,
      type: 'invoice.paid',
      resourceType: 'invoice',
      resourceId: id,
      summary: `Invoice ${invoiceNumber} EFT payment verified and marked paid`,
      ...actorFrom(user),
      createdAt: FieldValue.serverTimestamp(),
    })

    // Notify invoice creator (unless they verified it themselves)
    if (createdBy && createdBy !== user.uid) {
      await adminDb.collection('notifications').add({
        orgId: orgId ?? null,
        userId: createdBy,
        type: 'invoice.paid',
        title: 'Invoice paid',
        body: `Invoice ${invoiceNumber} EFT payment was verified and marked paid`,
        link: `/portal/invoicing/${id}`,
        status: 'unread',
        priority: 'normal',
        createdAt: FieldValue.serverTimestamp(),
      })
    }

    if (orgId) {
      const webhookPayload = {
        id,
        invoiceNumber,
        total: invoiceTotal,
        paymentMethod: 'eft',
        paymentReference:
          typeof body.reference === 'string' && body.reference.trim()
            ? body.reference.trim()
            : null,
        paidAmount,
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

    return apiSuccess({ id, status: 'paid' })
  }

  // action === 'reject'
  const reason =
    typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : ''

  await ref.update({
    status: 'sent',
    eftRejectionReason: reason,
    eftRejectedAt: FieldValue.serverTimestamp(),
    ...lastActorFrom(user),
  })

  await adminDb.collection('activities').add({
    orgId: orgId ?? null,
    type: 'invoice.eft_rejected',
    resourceType: 'invoice',
    resourceId: id,
    summary: reason
      ? `EFT proof rejected for invoice ${invoiceNumber}: ${reason}`
      : `EFT proof rejected for invoice ${invoiceNumber}`,
    ...actorFrom(user),
    createdAt: FieldValue.serverTimestamp(),
  })

  if (createdBy && createdBy !== user.uid) {
    await adminDb.collection('notifications').add({
      orgId: orgId ?? null,
      userId: createdBy,
      type: 'invoice.eft_rejected',
      title: 'EFT proof rejected',
      body: reason
        ? `Payment proof for invoice ${invoiceNumber} was rejected: ${reason}`
        : `Payment proof for invoice ${invoiceNumber} was rejected`,
      link: `/portal/invoicing/${id}`,
      status: 'unread',
      priority: 'high',
      createdAt: FieldValue.serverTimestamp(),
    })
  }

  return apiSuccess({ id, status: 'sent' })
})
