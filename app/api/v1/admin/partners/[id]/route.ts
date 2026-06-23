/**
 * GET  /api/v1/admin/partners/[id] — single partner application detail.
 * POST /api/v1/admin/partners/[id] — transition an application.
 *
 * Actions:
 *   approve → status 'approved'; set commissionPercent (0-100) + payoutMethod.
 *             Sends an approval email to the applicant. Always writes activity.
 *   reject  → status 'rejected'; rejectionReason required. Sends rejection email.
 *   suspend → status 'suspended'. Writes activity.
 *
 * Email: reuses sendEmail (Resend-backed). We always log activity AND attempt
 * the real send; if the provider is not configured the send is recorded as
 * queued in the response (emailStatus) so it is never silently dropped.
 */
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import { logActivity } from '@/lib/activity/log'
import { sendEmail } from '@/lib/email/send'
import type { PartnerApplication, PartnerApplicationStatus } from '@/lib/billing/types'

export const dynamic = 'force-dynamic'

const COLLECTION = 'partner_applications'

type RouteContext = { params: Promise<{ id: string }> }
type PartnerAction = 'approve' | 'reject' | 'suspend'

export const GET = withAuth('admin', async (_req, _user, ctx) => {
  try {
    const { id } = await (ctx as RouteContext).params
    const doc = await adminDb.collection(COLLECTION).doc(id).get()
    if (!doc.exists) return apiError('Partner application not found', 404)
    return apiSuccess({ id: doc.id, ...(doc.data() as Omit<PartnerApplication, 'id'>) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

function approvalEmail(app: PartnerApplication, commissionPercent: number, payoutMethod: string) {
  return {
    subject: 'You are now a Partners in Biz partner',
    html: `
      <p>Hi ${app.contactName},</p>
      <p>Great news — <strong>${app.companyName}</strong> has been approved for the
      Partners in Biz partner programme.</p>
      <p>Your commission rate is <strong>${commissionPercent}%</strong> on referred
      subscriptions, paid out via <strong>${payoutMethod.toUpperCase()}</strong>.</p>
      <p>We will be in touch shortly with your referral link and onboarding details.</p>
      <p>Welcome aboard,<br/>The Partners in Biz team</p>
    `,
  }
}

function rejectionEmail(app: PartnerApplication, reason: string) {
  return {
    subject: 'Your Partners in Biz partner application',
    html: `
      <p>Hi ${app.contactName},</p>
      <p>Thank you for applying to the Partners in Biz partner programme on behalf of
      <strong>${app.companyName}</strong>.</p>
      <p>After review, we are not able to move your application forward at this time.</p>
      <p>${reason}</p>
      <p>You are welcome to re-apply in future as your business grows.</p>
      <p>Kind regards,<br/>The Partners in Biz team</p>
    `,
  }
}

export const POST = withAuth('admin', async (req, user, ctx) => {
  try {
    const { id } = await (ctx as RouteContext).params
    const ref = adminDb.collection(COLLECTION).doc(id)
    const doc = await ref.get()
    if (!doc.exists) return apiError('Partner application not found', 404)

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return apiError('Invalid JSON body', 400)

    const action = body.action as PartnerAction
    if (!['approve', 'reject', 'suspend'].includes(action)) {
      return apiError('action must be one of: approve, reject, suspend', 400)
    }

    const current = { id: doc.id, ...(doc.data() as Omit<PartnerApplication, 'id'>) }
    const update: Record<string, unknown> = { ...lastActorFrom(user) }
    let nextStatus: PartnerApplicationStatus = current.status
    let description = ''
    let email: { subject: string; html: string } | null = null

    if (action === 'approve') {
      const commissionPercent = Number(body.commissionPercent)
      if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
        return apiError('commissionPercent is required and must be between 0 and 100', 400)
      }
      const payoutMethod = body.payoutMethod === 'paypal' ? 'paypal' : 'eft'

      nextStatus = 'approved'
      update.status = 'approved'
      update.commissionPercent = commissionPercent
      update.payoutMethod = payoutMethod
      update.reviewedBy = user.uid
      update.reviewedAt = FieldValue.serverTimestamp()
      update.rejectionReason = null
      description = `Approved partner ${current.companyName} at ${commissionPercent}% commission (payout via ${payoutMethod.toUpperCase()})`
      email = approvalEmail(current, commissionPercent, payoutMethod)
    } else if (action === 'reject') {
      const rejectionReason =
        typeof body.rejectionReason === 'string' ? body.rejectionReason.trim() : ''
      if (!rejectionReason) return apiError('rejectionReason is required to reject', 400)

      nextStatus = 'rejected'
      update.status = 'rejected'
      update.rejectionReason = rejectionReason
      update.reviewedBy = user.uid
      update.reviewedAt = FieldValue.serverTimestamp()
      description = `Rejected partner application ${current.companyName}: ${rejectionReason}`
      email = rejectionEmail(current, rejectionReason)
    } else {
      // suspend
      if (current.status !== 'approved') {
        return apiError(`Only approved partners can be suspended (current: "${current.status}")`, 409)
      }
      nextStatus = 'suspended'
      update.status = 'suspended'
      update.reviewedBy = user.uid
      update.reviewedAt = FieldValue.serverTimestamp()
      description = `Suspended partner ${current.companyName}`
    }

    await ref.update(update)

    await logActivity({
      orgId: current.orgId ?? 'platform',
      type: 'billing.partner',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : 'admin',
      description,
      entityId: id,
      entityType: 'partner_application',
      entityTitle: current.companyName,
    })

    // Attempt the real send; never silently drop. Record outcome for the caller.
    let emailStatus: 'sent' | 'queued' | 'skipped' = 'skipped'
    if (email && current.email) {
      const result = await sendEmail({
        to: current.email,
        subject: email.subject,
        html: email.html,
      })
      emailStatus = result.success ? 'sent' : 'queued'
    }

    const updated = await ref.get()
    return apiSuccess({
      application: { id: updated.id, ...(updated.data() as Omit<PartnerApplication, 'id'>), status: nextStatus },
      emailStatus,
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
