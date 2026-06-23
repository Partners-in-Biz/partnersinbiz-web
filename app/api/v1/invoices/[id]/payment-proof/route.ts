/**
 * POST /api/v1/invoices/[id]/payment-proof — record EFT proof-of-payment upload
 *
 * Body: { fileId: string, note?: string }
 *
 * Transitions invoice to `payment_pending_verification` and notifies admins.
 * The admin then calls `POST /confirm-payment` to finalise or reject.
 *
 * Auth: admin/client (ai satisfies). Portal clients use the same route after
 * the upload route stores the proof file in `uploads`.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom, lastActorFrom } from '@/lib/api/actor'
import { requireInvoiceAccess } from '@/lib/invoices/access'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('client', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({}))

  if (typeof body.fileId !== 'string' || !body.fileId) {
    return apiError('fileId is required', 400)
  }

  const access = await requireInvoiceAccess(user, id)
  if (!access.ok) return access.response
  const ref = access.ref
  const invoice = access.data
  const invoiceNumber: string = invoice.invoiceNumber ?? id
  const orgId: string | undefined = invoice.orgId

  await ref.update({
    status: 'payment_pending_verification',
    paymentProofFileId: body.fileId,
    paymentProofUploadedAt: FieldValue.serverTimestamp(),
    paymentProofNote: typeof body.note === 'string' ? body.note : '',
    ...lastActorFrom(user),
  })

  // Activity log
  await adminDb.collection('activities').add({
    orgId: orgId ?? null,
    type: 'invoice.proof_uploaded',
    resourceType: 'invoice',
    resourceId: id,
    summary: `Payment proof uploaded for invoice ${invoiceNumber}`,
    ...actorFrom(user),
    createdAt: FieldValue.serverTimestamp(),
  })

  // Notify platform admins (org-wide notification — no userId/agentId).
  // Admin inbox queries pick up org-wide notifications where recipients are null.
  const platformSnap = await adminDb
    .collection('organizations')
    .where('type', '==', 'platform_owner')
    .limit(1)
    .get()
  const platformOrgId = platformSnap.empty ? null : platformSnap.docs[0].id

  if (platformOrgId) {
    await adminDb.collection('notifications').add({
      orgId: platformOrgId,
      userId: null,
      agentId: null,
      type: 'invoice.proof_uploaded',
      title: 'Payment proof uploaded',
      body: `Invoice ${invoiceNumber} is awaiting confirmation`,
      link: `/portal/invoicing/${id}`,
      status: 'unread',
      priority: 'high',
      createdAt: FieldValue.serverTimestamp(),
    })
  }

  // No webhook event in our enum for proof upload — intentionally not dispatched.

  return apiSuccess({ id, status: 'payment_pending_verification' })
})
