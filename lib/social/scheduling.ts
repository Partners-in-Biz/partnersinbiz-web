import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { findDefaultAccount, toPlatformType } from '@/lib/social/account-resolver'
import type { PostStatus } from '@/lib/social/providers'

export function hasFinalApproval(post: FirebaseFirestore.DocumentData): boolean {
  return Boolean(
    post.approvedAt ||
    post.approvedBy ||
    post.approval?.clientApprovedAt ||
    post.approval?.clientApprovedBy ||
    post.approval?.qaApprovedAt ||
    post.approval?.qaApprovedBy,
  )
}

export async function hasActivePublishAccount(post: FirebaseFirestore.DocumentData, orgId: string): Promise<boolean> {
  const platform = typeof post.platform === 'string'
    ? post.platform
    : Array.isArray(post.platforms) && typeof post.platforms[0] === 'string'
      ? post.platforms[0]
      : null

  if (!platform) return false

  const platformType = toPlatformType(platform)
  if (!platformType) return false

  const accountIds = Array.isArray(post.accountIds) ? post.accountIds.filter((id: unknown): id is string => typeof id === 'string') : []
  if (accountIds.length > 0) {
    for (const accountId of accountIds) {
      const doc = await adminDb.collection('social_accounts').doc(accountId).get()
      const account = doc.data()
      const personalMatches = post.accountScope !== 'personal' ||
        (account?.accountScope === 'personal' && account.ownerUid === post.ownerUid)
      if (doc.exists && account?.orgId === orgId && account.status === 'active' && personalMatches) return true
    }
    return false
  }

  if (post.accountScope === 'personal') return false

  return Boolean(await findDefaultAccount(orgId, platformType))
}

export async function resolveQueueableStatus(
  post: FirebaseFirestore.DocumentData,
  orgId: string,
  desiredStatus: PostStatus,
): Promise<PostStatus> {
  if (desiredStatus !== 'scheduled') return desiredStatus
  if (!post.scheduledAt) return 'approved'
  if (!(await hasActivePublishAccount(post, orgId))) return 'approved'
  return 'scheduled'
}

export async function upsertSocialQueueEntry(opts: {
  postId: string
  orgId: string
  scheduledAt: Timestamp
  post: FirebaseFirestore.DocumentData
}) {
  if (!hasFinalApproval(opts.post)) {
    throw new Error('Post must be approved before it can be queued for publishing')
  }

  if (!(await hasActivePublishAccount(opts.post, opts.orgId))) {
    throw new Error('Connect an active social account before queueing this post')
  }

  await adminDb.collection('social_queue').doc(opts.postId).set({
    orgId: opts.orgId,
    postId: opts.postId,
    scheduledAt: opts.scheduledAt,
    status: 'pending',
    priority: 0,
    attempts: 0,
    maxAttempts: 5,
    lastAttemptAt: null,
    nextRetryAt: null,
    backoffSeconds: 60,
    lockedBy: null,
    lockedAt: null,
    startedAt: null,
    completedAt: null,
    error: null,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

export async function cancelSocialQueueEntry(postId: string, status: 'cancelled' | 'blocked' = 'cancelled') {
  const queueRef = adminDb.collection('social_queue').doc(postId)
  const queueDoc = await queueRef.get()
  if (!queueDoc.exists) return

  await queueRef.update({
    status,
    lockedBy: null,
    lockedAt: null,
    updatedAt: FieldValue.serverTimestamp(),
  })
}
