/**
 * POST /api/v1/social/posts/:id/submit — submit a draft post into the approval pipeline.
 *
 * Resolves the next status (qa_review, client_review, or approved) from the org's
 * approval settings and the per-post requiresApproval flag.
 *
 * If the resolved status is "approved", we immediately apply finalisation
 * (scheduled or vaulted depending on deliveryMode and scheduledAt).
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'
import { logAudit } from '@/lib/social/audit'
import { logActivity } from '@/lib/activity/log'
import {
  emptyApprovalState,
  getOrgApprovalSettings,
  resolveAfterFinalApproval,
  resolveSubmitStatus,
} from '@/lib/social/approval'
import type { DeliveryMode, PostStatus } from '@/lib/social/providers'
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

  const currentStatus = post.status as PostStatus | undefined
  if (currentStatus !== 'draft') {
    return apiError(`Cannot submit from status "${currentStatus}" — must be draft`, 400)
  }

  const orgSettings = await getOrgApprovalSettings(orgId)

  // Per-post requiresApproval defaults to true if not set
  const requiresApproval =
    typeof post.requiresApproval === 'boolean' ? post.requiresApproval : true

  let newStatus: PostStatus = resolveSubmitStatus({
    requiresApproval,
    requiresQa: orgSettings.requiresQaApproval,
    requiresClient: orgSettings.requiresClientApproval,
  })

  // If submission goes straight to "approved", apply finalisation rules.
  if (newStatus === 'approved') {
    const deliveryMode = (post.deliveryMode as DeliveryMode | undefined) ?? orgSettings.defaultDeliveryMode
    const desiredStatus = resolveAfterFinalApproval({
      deliveryMode,
      hasScheduledAt: !!post.scheduledAt,
    })
    newStatus = await resolveQueueableStatus(
      { ...post, approvedBy: user.uid, approvedAt: FieldValue.serverTimestamp() },
      orgId,
      desiredStatus,
    )
  }

  if (['approved', 'scheduled', 'publishing', 'published'].includes(newStatus)) {
    const capabilityError = enforceAgentCapability(user, 'publish', req)
    if (capabilityError) return capabilityError
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: Record<string, any> = {
    status: newStatus,
    updatedAt: FieldValue.serverTimestamp(),
  }

  // Initialise approval state if it doesn't exist on the post yet.
  if (!post.approval) {
    updateData.approval = emptyApprovalState()
  }

  await ref.update(updateData)

  if (newStatus === 'scheduled' && post.scheduledAt) {
    await upsertSocialQueueEntry({
      postId: id,
      orgId,
      scheduledAt: post.scheduledAt,
      post: { ...post, ...updateData, approvedBy: user.uid, approvedAt: FieldValue.serverTimestamp() },
    })
  }

  await logAudit({
    orgId,
    action: 'post.submitted',
    entityType: 'post',
    entityId: id,
    performedBy: user.uid,
    performedByRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    details: {
      from: 'draft',
      to: newStatus,
      requiresApproval,
      requiresQa: orgSettings.requiresQaApproval,
      requiresClient: orgSettings.requiresClientApproval,
    },
    ip: req.headers.get('x-forwarded-for'),
  })

  logActivity({
    orgId,
    type: 'social_post_submitted',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: 'Submitted social post for review',
    entityId: id,
    entityType: 'social_post',
  }).catch(() => {})

  return apiSuccess({ id, status: newStatus })
}))
