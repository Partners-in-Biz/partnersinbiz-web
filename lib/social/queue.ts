/**
 * Social Queue Processor — Processes scheduled posts from the social_queue collection.
 *
 * Uses account-resolver for platform credentials (Firestore OAuth accounts
 * with auto-default lookup, no accountIds needed on posts).
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  isTokenExpiredError,
  markAccountTokenExpired,
  refreshAccountToken,
  resolveProvider,
  toPlatformType,
} from '@/lib/social/account-resolver'
import type { SocialPlatformType } from '@/lib/social/providers'
import { hasFinalApproval } from '@/lib/social/scheduling'
import { validatePublishReadyText } from '@/lib/social/publish-text'
import { validateOutboundLinks } from '@/lib/social/outbound-link-validation'
import { notifySocialPublishFailure } from '@/lib/social/publish-failure-alerts'
import crypto from 'crypto'

/** Backoff schedule in seconds: 1min, 5min, 15min, 1hr */
const BACKOFF_SCHEDULE = [60, 300, 900, 3600]

/** Locks older than this are considered stale and can be reclaimed */
const STALE_LOCK_SECONDS = 5 * 60

function generateInstanceId(): string {
  return `cron-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
}

function getBackoffSeconds(attempt: number): number {
  return BACKOFF_SCHEDULE[Math.min(attempt, BACKOFF_SCHEDULE.length - 1)]
}

export interface QueueProcessResult {
  processed: number
  failed: number
  skipped: number
  errors: Array<{ postId: string; error: string }>
}

/** Publish via provider, auto-refresh on 401 */
async function publishWithRefresh(
  provider: ReturnType<typeof import('@/lib/social/providers').getProvider>,
  text: string,
  threadParts: string[] | undefined,
  mediaUrls: string[] | undefined,
  accountId: string | null,
  orgId: string,
  platformType: SocialPlatformType,
): Promise<string> {
  try {
    return await doPublish(provider, text, threadParts, mediaUrls)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (msg.includes('401') && accountId) {
      console.log(`[queue] 401 hit, refreshing token for ${accountId}`)
      const refreshed = await refreshAccountToken(accountId, orgId, platformType)
      if (refreshed) {
        console.log(`[queue] Token refreshed, retrying ${accountId}`)
        return await doPublish(refreshed, text, threadParts, mediaUrls)
      }
    }
    throw err
  }
}

async function doPublish(
  provider: ReturnType<typeof import('@/lib/social/providers').getProvider>,
  text: string,
  threadParts: string[] | undefined,
  mediaUrls: string[] | undefined,
): Promise<string> {
  if (Array.isArray(threadParts) && threadParts.length > 0) {
    const results = await provider.publishThread(threadParts, mediaUrls)
    return results[0].platformPostId
  }
  const result = await provider.publishPost({ text, mediaUrls })
  return result.platformPostId
}

/**
 * Process all due items in the social_queue.
 * Called every 5 minutes via Firebase Cloud Function.
 */
export async function processQueue(): Promise<QueueProcessResult> {
  const instanceId = generateInstanceId()
  const now = Timestamp.now()
  const result: QueueProcessResult = { processed: 0, failed: 0, skipped: 0, errors: [] }

  // Fetch pending + stale-processing entries
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingSnap = await (adminDb.collection('social_queue') as any)
    .where('status', '==', 'pending')
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processingSnap = await (adminDb.collection('social_queue') as any)
    .where('status', '==', 'processing')
    .get()

  const allDocs = [...pendingSnap.docs, ...processingSnap.docs]

  for (const queueDoc of allDocs) {
    const entry = queueDoc.data()

    if (entry.status === 'pending' && entry.scheduledAt > now) continue

    if (entry.status === 'processing' && entry.lockedAt) {
      const lockAge = now.seconds - entry.lockedAt.seconds
      if (lockAge < STALE_LOCK_SECONDS) { result.skipped++; continue }
    }

    const lockRef = adminDb.collection('social_queue').doc(queueDoc.id)

    let resolvedAccountId: string | null = null

    try {
      const locked = await adminDb.runTransaction(async (txn) => {
        const freshDoc = await txn.get(lockRef)
        if (!freshDoc.exists) return false
        const d = freshDoc.data()!
        if (d.status === 'pending' || (d.status === 'processing' && d.lockedAt && (now.seconds - d.lockedAt.seconds) >= STALE_LOCK_SECONDS)) {
          txn.update(lockRef, { status: 'processing', lockedBy: instanceId, lockedAt: now, startedAt: d.startedAt ?? now })
          return true
        }
        return false
      })
      if (!locked) { result.skipped++; continue }
    } catch { result.skipped++; continue }

    const postDoc = await adminDb.collection('social_posts').doc(entry.postId).get()
    if (!postDoc.exists) {
      await lockRef.update({ status: 'failed', error: 'Post not found', lockedBy: null, lockedAt: null, completedAt: FieldValue.serverTimestamp() })
      result.failed++; result.errors.push({ postId: entry.postId, error: 'Post not found' }); continue
    }

    const post = postDoc.data()!
    if (post.status === 'published' || post.status === 'cancelled') {
      await lockRef.update({ status: post.status === 'published' ? 'completed' : 'cancelled', lockedBy: null, lockedAt: null, completedAt: FieldValue.serverTimestamp() })
      result.skipped++; continue
    }

    if (post.status !== 'scheduled' && post.status !== 'publishing') {
      await lockRef.update({ status: 'blocked', error: `Post status is ${post.status}; only approved scheduled posts can publish`, lockedBy: null, lockedAt: null, completedAt: FieldValue.serverTimestamp() })
      result.skipped++
      continue
    }

    if (!hasFinalApproval(post)) {
      await lockRef.update({ status: 'blocked', error: 'Post has not been approved', lockedBy: null, lockedAt: null, completedAt: FieldValue.serverTimestamp() })
      result.skipped++
      continue
    }

    const platformType = toPlatformType(post.platform)
    if (!platformType) { await failQueueEntry(lockRef, entry, `Unsupported platform: ${post.platform}`); result.failed++; result.errors.push({ postId: entry.postId, error: `Unsupported: ${post.platform}` }); continue }

    const rawText = typeof post.content === 'string' ? post.content : post.content?.text
    if (!rawText) { await failQueueEntry(lockRef, entry, 'No content'); result.failed++; result.errors.push({ postId: entry.postId, error: 'No content' }); continue }

    const publishText = validatePublishReadyText(rawText, [platformType])
    if (!publishText.valid) {
      const message = publishText.errors.map(e => e.message).join('; ')
      await failQueueEntry(lockRef, entry, message)
      result.failed++
      result.errors.push({ postId: entry.postId, error: message })
      continue
    }

    const linkValidation = await validateOutboundLinks(publishText.text)
    if (!linkValidation.valid) {
      const message = linkValidation.errors.map(e => e.message).join('; ')
      await failQueueEntry(lockRef, entry, message)
      result.failed++
      result.errors.push({ postId: entry.postId, error: message })
      continue
    }

    const text = publishText.text

    try {
      const orgId = post.orgId ?? entry.orgId
      if (!orgId) {
        await failQueueEntry(lockRef, entry, 'Missing orgId on post/queue entry')
        result.failed++
        result.errors.push({ postId: entry.postId, error: 'Missing orgId' })
        continue
      }
      const { provider, accountId } = await resolveProvider(post, orgId, platformType)
      resolvedAccountId = accountId
      if (!resolvedAccountId) {
        await failQueueEntry(lockRef, entry, 'No active connected social account for this org/platform')
        result.failed++
        result.errors.push({ postId: entry.postId, error: 'No connected account' })
        continue
      }
      const mediaUrls: string[] | undefined = Array.isArray(post.media) && post.media.length > 0
        ? (post.media as Array<{ url?: string }>).map(m => m.url).filter((u): u is string => Boolean(u))
        : undefined
      const externalId = await publishWithRefresh(provider, text, post.threadParts, mediaUrls, resolvedAccountId, orgId, platformType)

      await adminDb.collection('social_posts').doc(entry.postId).update({
        status: 'published', publishedAt: FieldValue.serverTimestamp(), externalId, error: null, updatedAt: FieldValue.serverTimestamp(),
      })
      await lockRef.update({ status: 'completed', lockedBy: null, lockedAt: null, completedAt: FieldValue.serverTimestamp(), error: null })
      result.processed++
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      if (resolvedAccountId && isTokenExpiredError(message)) {
        await markAccountTokenExpired(resolvedAccountId, message).catch(() => {})
      }
      const attempts = (entry.attempts ?? 0) + 1
      const maxAttempts = entry.maxAttempts ?? 5

      if (attempts >= maxAttempts) {
        await adminDb.collection('social_posts').doc(entry.postId).update({ status: 'failed', error: message, updatedAt: FieldValue.serverTimestamp() })
        await lockRef.update({ status: 'failed', lockedBy: null, lockedAt: null, completedAt: FieldValue.serverTimestamp(), attempts, lastAttemptAt: FieldValue.serverTimestamp(), error: message })
        await notifySocialPublishFailure({
          orgId: post.orgId ?? entry.orgId,
          postId: entry.postId,
          platform: post.platform ?? entry.platform ?? 'unknown',
          campaignId: post.campaignId ?? entry.campaignId ?? null,
          error: message,
        })
      } else {
        const backoff = getBackoffSeconds(attempts - 1)
        const nextRetry = Timestamp.fromMillis(Date.now() + backoff * 1000)
        await lockRef.update({ status: 'pending', lockedBy: null, lockedAt: null, attempts, lastAttemptAt: FieldValue.serverTimestamp(), nextRetryAt: nextRetry, backoffSeconds: backoff, scheduledAt: nextRetry, error: message })
      }
      result.failed++; result.errors.push({ postId: entry.postId, error: message })
    }
  }

  return result
}

async function failQueueEntry(lockRef: FirebaseFirestore.DocumentReference, entry: FirebaseFirestore.DocumentData, error: string): Promise<void> {
  const attempts = (entry.attempts ?? 0) + 1
  const maxAttempts = entry.maxAttempts ?? 5
  if (attempts >= maxAttempts) {
    await adminDb.collection('social_posts').doc(entry.postId).update({ status: 'failed', error, updatedAt: FieldValue.serverTimestamp() })
    await lockRef.update({ status: 'failed', lockedBy: null, lockedAt: null, completedAt: FieldValue.serverTimestamp(), attempts, error })
    await notifySocialPublishFailure({
      orgId: entry.orgId,
      postId: entry.postId,
      platform: entry.platform ?? 'unknown',
      campaignId: entry.campaignId ?? null,
      error,
    })
  } else {
    const backoff = getBackoffSeconds(attempts - 1)
    const nextRetry = Timestamp.fromMillis(Date.now() + backoff * 1000)
    await lockRef.update({ status: 'pending', lockedBy: null, lockedAt: null, attempts, lastAttemptAt: FieldValue.serverTimestamp(), nextRetryAt: nextRetry, backoffSeconds: backoff, scheduledAt: nextRetry, error })
  }
}
