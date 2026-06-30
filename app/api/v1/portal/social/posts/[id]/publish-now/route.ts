import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { withTenant } from '@/lib/api/tenant'
import { logActivity } from '@/lib/activity/log'
import { adminDb } from '@/lib/firebase/admin'
import {
  isTokenExpiredError,
  markAccountTokenExpired,
  refreshAccountToken,
  resolveProvider,
  toPlatformType,
} from '@/lib/social/account-resolver'
import { logAudit } from '@/lib/social/audit'
import { hasFinalApproval } from '@/lib/social/scheduling'
import { validatePublishReadyText } from '@/lib/social/publish-text'
import { validateOutboundLinks } from '@/lib/social/outbound-link-validation'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const POST = withAuth('client', withTenant(async (_req: NextRequest, user, orgId, context) => {
  const { id } = await (context as Params).params
  const ref = adminDb.collection('social_posts').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Post not found', 404)

  const post = snap.data()!
  if (post.orgId && post.orgId !== orgId) return apiError('Post not found', 404)
  if (post.accountScope === 'personal' && post.ownerUid !== user.uid) return apiError('Post not found', 404)
  if (post.status === 'published') return apiError('Post already published', 409)
  if (post.status === 'cancelled') return apiError('Cannot publish a cancelled post', 400)
  if (!hasFinalApproval(post)) return apiError('Post must be approved before publishing', 400)

  const platformType = toPlatformType(post.platform)
  if (!platformType) return apiError(`Unsupported platform: ${post.platform}`, 400)

  const rawText = typeof post.content === 'string' ? post.content : post.content?.text
  if (!rawText) return apiError('Post has no content', 400)

  const publishText = validatePublishReadyText(rawText, [platformType])
  if (!publishText.valid) {
    return apiError(`Post is not publish-ready: ${publishText.errors.map(e => e.message).join('; ')}`, 400)
  }

  const linkValidation = await validateOutboundLinks(publishText.text)
  if (!linkValidation.valid) {
    return apiError(`Post is not publish-ready: ${linkValidation.errors.map(e => e.message).join('; ')}`, 400)
  }

  const text = publishText.text

  const mediaUrls: string[] | undefined = Array.isArray(post.media) && post.media.length > 0
    ? (post.media as Array<{ url?: string }>).map((m) => m.url).filter((u): u is string => Boolean(u))
    : undefined

  let externalId: string
  let resolvedAccountId: string | null = null

  try {
    const { provider, accountId } = await resolveProvider(post, orgId, platformType)
    resolvedAccountId = accountId
    if (!accountId) return apiError('Connect an active social account before publishing this post', 400)

    const threadParts: string[] | undefined = post.threadParts
    try {
      if (Array.isArray(threadParts) && threadParts.length > 0) {
        const results = await provider.publishThread(threadParts, mediaUrls)
        externalId = results[0].platformPostId
      } else {
        const result = await provider.publishPost({ text, mediaUrls })
        externalId = result.platformPostId
      }
    } catch (publishErr) {
      const msg = publishErr instanceof Error ? publishErr.message : 'Unknown error'
      if (msg.includes('401') && accountId) {
        const refreshed = await refreshAccountToken(accountId, orgId, platformType)
        if (!refreshed) throw publishErr
        if (Array.isArray(threadParts) && threadParts.length > 0) {
          const results = await refreshed.publishThread(threadParts, mediaUrls)
          externalId = results[0].platformPostId
        } else {
          const result = await refreshed.publishPost({ text, mediaUrls })
          externalId = result.platformPostId
        }
      } else {
        throw publishErr
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (resolvedAccountId && isTokenExpiredError(message)) {
      await markAccountTokenExpired(resolvedAccountId, message).catch(() => {})
    }
    await ref.update({
      status: 'failed',
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    })
    await adminDb.collection('social_queue').doc(id).set({
      status: 'failed',
      error: message,
      completedAt: FieldValue.serverTimestamp(),
      lockedBy: null,
      lockedAt: null,
    }, { merge: true })
    await logAudit({
      orgId,
      action: 'post.failed',
      entityType: 'post',
      entityId: id,
      performedBy: user.uid,
      performedByRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      details: { error: message, platform: post.platform, source: 'portal_publish_now' },
    })
    return apiError('Publish failed: ' + message, 500)
  }

  await ref.update({
    status: 'published',
    publishedAt: FieldValue.serverTimestamp(),
    externalId,
    error: null,
    updatedAt: FieldValue.serverTimestamp(),
  })
  await adminDb.collection('social_queue').doc(id).set({
    status: 'completed',
    completedAt: FieldValue.serverTimestamp(),
    error: null,
    lockedBy: null,
    lockedAt: null,
  }, { merge: true })

  const actorRole = user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client'
  await logAudit({
    orgId,
    action: 'post.published',
    entityType: 'post',
    entityId: id,
    performedBy: user.uid,
    performedByRole: actorRole,
    details: { externalId, platform: post.platform, source: 'portal_publish_now' },
  })

  logActivity({
    orgId,
    type: 'social_post_published',
    actorId: user.uid,
    actorName: user.uid,
    actorRole,
    description: `Published ${post.platform} post from portal`,
    entityId: id,
    entityType: 'social_post',
  }).catch(() => {})

  return apiSuccess({ id, status: 'published', externalId, error: null })
}))
