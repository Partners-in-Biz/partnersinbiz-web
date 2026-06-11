/**
 * PATCH /api/v1/invoices/[id]/mark-paid — mark an invoice paid + record payment details
 *
 * Body: {
 *   paidAt?: ISO string,
 *   paymentMethod: 'eft' | 'paypal' | 'cash' | 'card' | 'other',
 *   reference?: string,
 *   amount?: number,
 *   proofFileId?: string,
 * }
 *
 * Side effects:
 *  - Updates invoice status to `paid` with payment details
 *  - Writes an entry to `activities` collection
 *  - Notifies the invoice creator (unless they triggered the update themselves)
 *
 * Auth: admin (ai satisfies)
 */
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom, lastActorFrom } from '@/lib/api/actor'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { tryAttributeInvoicePaid } from '@/lib/email-analytics/attribution-hooks'
import { logActivity } from '@/lib/activity/log'
import { requireInvoiceAccess } from '@/lib/invoices/access'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const VALID_METHODS = ['eft', 'paypal', 'cash', 'card', 'other'] as const
type PaymentMethod = (typeof VALID_METHODS)[number]

export const PATCH = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({}))

  const paymentMethod = body.paymentMethod as PaymentMethod | undefined
  if (!paymentMethod || !VALID_METHODS.includes(paymentMethod)) {
    return apiError(
      `paymentMethod is required and must be one of: ${VALID_METHODS.join(', ')}`,
      400,
    )
  }

  const access = await requireInvoiceAccess(user, id)
  if (!access.ok) return access.response
  const ref = access.ref
  const invoice = access.data
  const orgId: string | undefined = invoice.orgId
  const invoiceNumber: string = invoice.invoiceNumber ?? id
  const createdBy: string | undefined = invoice.createdBy

  // Parse paidAt (accept ISO string) or fall back to server timestamp
  let paidAt: FieldValue | Timestamp = FieldValue.serverTimestamp()
  if (typeof body.paidAt === 'string' && body.paidAt.trim()) {
    const parsed = new Date(body.paidAt)
    if (!Number.isNaN(parsed.getTime())) {
      paidAt = Timestamp.fromDate(parsed)
    }
  }

  const updates: Record<string, unknown> = {
    status: 'paid',
    paidAt,
    paymentMethod,
    ...lastActorFrom(user),
  }
  if (typeof body.reference === 'string') updates.paymentReference = body.reference
  if (typeof body.amount === 'number') updates.paidAmount = body.amount
  if (typeof body.proofFileId === 'string') updates.paymentProofFileId = body.proofFileId

  await ref.update(updates)

  logActivity({
    orgId: orgId ?? '',
    type: 'invoice_marked_paid',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: 'Marked invoice as paid',
    entityId: id,
    entityType: 'invoice',
    entityTitle: invoiceNumber,
  }).catch(() => {})

  // Activity log entry
  await adminDb.collection('activities').add({
    orgId: orgId ?? null,
    type: 'invoice.paid',
    resourceType: 'invoice',
    resourceId: id,
    summary: `Invoice ${invoiceNumber} marked paid via ${paymentMethod}`,
    ...actorFrom(user),
    createdAt: FieldValue.serverTimestamp(),
  })

  // Notify invoice creator (unless they're the one marking it paid)
  if (createdBy && createdBy !== user.uid) {
    await adminDb.collection('notifications').add({
      orgId: orgId ?? null,
      userId: createdBy,
      type: 'invoice.paid',
      title: 'Invoice paid',
      body: `Invoice ${invoiceNumber} was marked paid`,
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
})
