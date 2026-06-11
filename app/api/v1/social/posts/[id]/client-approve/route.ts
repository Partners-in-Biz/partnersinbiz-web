/**
 * POST /api/v1/social/posts/:id/client-approve — client approves the post.
 *
 * Transitions: client_review (or legacy pending_approval) -> approved/scheduled/vaulted
 * depending on deliveryMode and whether scheduledAt is set.
 *
 * Creates a queue entry when the post becomes "scheduled".
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'
import { logAudit } from '@/lib/social/audit'
import {
  getOrgApprovalSettings,
  resolveAfterFinalApproval,
  validateTransition,
} from '@/lib/social/approval'
import type { DeliveryMode, PostStatus } from '@/lib/social/providers'
import { sendEmail } from '@/lib/email/send'
import { getOrgManagerEmails } from '@/lib/organizations/manager-emails'
import { getHermesProfileLink, createHermesRun } from '@/lib/hermes/server'
import { logActivity } from '@/lib/activity/log'
import { resolveQueueableStatus, upsertSocialQueueEntry } from '@/lib/social/scheduling'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const POST = withAuth('client', withTenant(async (req, user, orgId, context) => {
  const { id } = await (context as Params).params

  const ref = adminDb.collection('social_posts').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Post not found', 404)

  const post = snap.data()!
  if (post.orgId && post.orgId !== orgId) return apiError('Post not found', 404)

  const currentStatus = post.status as PostStatus
  const transitionError = validateTransition(currentStatus, 'client_approve')
  if (transitionError) return apiError(transitionError, 400)

  const [orgSettings, userDoc] = await Promise.all([
    getOrgApprovalSettings(orgId),
    adminDb.collection('users').doc(user.uid).get(),
  ])
  const displayName: string = userDoc.exists
    ? (userDoc.data()?.displayName || user.uid)
    : user.uid
  const deliveryMode = (post.deliveryMode as DeliveryMode | undefined) ?? orgSettings.defaultDeliveryMode

  const desiredStatus = resolveAfterFinalApproval({
    deliveryMode,
    hasScheduledAt: !!post.scheduledAt,
  })
  const newStatus = await resolveQueueableStatus(
    { ...post, approvedBy: user.uid, approvedAt: FieldValue.serverTimestamp() },
    orgId,
    desiredStatus,
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: Record<string, any> = {
    status: newStatus,
    'approval.clientApprovedBy': user.uid,
    'approval.clientApprovedByName': displayName,
    'approval.clientApprovedAt': FieldValue.serverTimestamp(),
    // Keep legacy approval fields populated for back-compat.
    approvedBy: user.uid,
    approvedByName: displayName,
    approvedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  await ref.update(updateData)

  // Create a queue entry if we just landed on "scheduled".
  if (newStatus === 'scheduled' && post.scheduledAt) {
    await upsertSocialQueueEntry({
      postId: id,
      orgId,
      scheduledAt: post.scheduledAt,
      post: { ...post, ...updateData, status: newStatus },
    })
  }

  const role = user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client'

  // Primary audit entry.
  await logAudit({
    orgId,
    action: 'post.client_approved',
    entityType: 'post',
    entityId: id,
    performedBy: user.uid,
    performedByRole: role,
    details: { from: currentStatus, to: newStatus },
    ip: req.headers.get('x-forwarded-for'),
  })

  // Legacy back-compat audit entry — older consumers expect post.approved.
  await logAudit({
    orgId,
    action: 'post.approved',
    entityType: 'post',
    entityId: id,
    performedBy: user.uid,
    performedByRole: role,
    details: { stage: 'client', to: newStatus },
    ip: req.headers.get('x-forwarded-for'),
  })

  // Activity log (fire-and-forget)
  logActivity({
    orgId,
    type: 'social_post_client_approved',
    actorId: user.uid,
    actorName: displayName,
    actorRole: role,
    description: `Approved social post — status now ${newStatus}`,
    entityId: id,
    entityType: 'social_post',
  }).catch(() => {})

  // Fire-and-forget side-effects — none of these block the response.

  // 1. Firestore notification
  adminDb.collection('notifications').add({
    orgId,
    userId: null,
    agentId: null,
    type: 'social_post_client_approved',
    title: `Social post approved by ${displayName}`,
    body: newStatus === 'scheduled'
      ? `${displayName} approved and scheduled the post for publishing.`
      : `${displayName} approved the post — ready to publish.`,
    link: `/portal/social`,
    data: { postId: id, orgId, newStatus },
    priority: 'high',
    status: 'unread',
    snoozedUntil: null,
    readAt: null,
    createdAt: FieldValue.serverTimestamp(),
  }).catch(() => {})

  // 2. Email to org managers
  getOrgManagerEmails(orgId).then(emails =>
    Promise.all(emails.map(email => sendEmail({
      to: email,
      subject: `✅ Social post approved by ${displayName} (${orgId})`,
      html: `<p><strong>${displayName}</strong> has approved a social post for org <strong>${orgId}</strong>.</p><p>New status: <strong>${newStatus}</strong></p><p><a href="https://partnersinbiz.online/portal/social">View in admin</a></p>`,
    })))
  ).catch(() => {})

  // 3. Hermes agent dispatch
  getHermesProfileLink(orgId)
    .then((link) => {
      if (!link) return
      return createHermesRun(link, user.uid, {
        prompt: `${displayName} has approved social post ${id} for org ${orgId}. New status: ${newStatus}. ${newStatus === 'scheduled' ? 'It is now queued for scheduled publishing — no action needed.' : 'Please confirm the post is ready and publish it when appropriate.'}`,
      })
    })
    .catch(() => {})

  return apiSuccess({ id, status: newStatus })
}))
