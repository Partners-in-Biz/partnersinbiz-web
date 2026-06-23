/**
 * GET  /api/v1/admin/billing/referrals/[id]  — fetch one referral.
 * POST /api/v1/admin/billing/referrals/[id]  — transition a referral.
 *
 * Actions: approve | dispute | mark_paid. Payout is settled offline via
 * EFT/PayPal — mark_paid only records the intent/settlement. NO Stripe.
 */
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import { logActivity } from '@/lib/activity/log'
import type { Referral, ReferralStatus } from '@/lib/billing/types'

export const dynamic = 'force-dynamic'

const COLLECTION = 'referrals'

type RouteContext = { params: Promise<{ id: string }> }
type ReferralAction = 'approve' | 'dispute' | 'mark_paid'

export const GET = withAuth('admin', async (_req, _user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const doc = await adminDb.collection(COLLECTION).doc(id).get()
  if (!doc.exists) return apiError('Referral not found', 404)
  return apiSuccess({ id: doc.id, ...(doc.data() as Omit<Referral, 'id'>) })
})

export const POST = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const ref = adminDb.collection(COLLECTION).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Referral not found', 404)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return apiError('Invalid JSON body', 400)

  const action = body.action as ReferralAction
  if (!['approve', 'dispute', 'mark_paid'].includes(action)) {
    return apiError("action must be one of: approve, dispute, mark_paid", 400)
  }

  const current = doc.data() as Referral
  const status = current.status as ReferralStatus
  const update: Record<string, unknown> = { ...lastActorFrom(user) }
  let description = ''
  let nextStatus: ReferralStatus = status

  if (action === 'approve') {
    if (status !== 'pending' && status !== 'disputed') {
      return apiError(`Cannot approve a referral that is "${status}"`, 409)
    }
    nextStatus = 'approved'
    update.status = 'approved'
    update.approvedBy = user.uid
    update.approvedAt = FieldValue.serverTimestamp()
    update.disputeReason = null
    description = `Approved referral credit of R${current.creditZar} for ${current.referrerName ?? current.referrerOrgId}`
  } else if (action === 'dispute') {
    const disputeReason =
      typeof body.disputeReason === 'string' ? body.disputeReason.trim() : ''
    if (!disputeReason) return apiError('disputeReason is required to dispute', 400)
    if (status === 'paid') {
      return apiError('Cannot dispute a referral that is already paid', 409)
    }
    nextStatus = 'disputed'
    update.status = 'disputed'
    update.disputeReason = disputeReason
    description = `Disputed referral for ${current.referrerName ?? current.referrerOrgId}: ${disputeReason}`
  } else {
    // mark_paid
    if (status !== 'approved') {
      return apiError(`Only approved referrals can be marked paid (current: "${status}")`, 409)
    }
    nextStatus = 'paid'
    update.status = 'paid'
    update.paidAt = FieldValue.serverTimestamp()
    description = `Marked referral credit of R${current.creditZar} as paid (EFT/PayPal) for ${current.referrerName ?? current.referrerOrgId}`
  }

  await ref.update(update)

  await logActivity({
    orgId: current.referrerOrgId,
    type: 'billing.referral',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : 'admin',
    description,
    entityId: id,
    entityType: 'referral',
    entityTitle: `${current.referrerName ?? current.referrerOrgId} → ${current.referredName ?? current.referredOrgId}`,
  })

  const updated = await ref.get()
  return apiSuccess({ id: updated.id, ...(updated.data() as Omit<Referral, 'id'>), status: nextStatus })
})
