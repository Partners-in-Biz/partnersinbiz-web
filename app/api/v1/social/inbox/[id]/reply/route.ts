/**
 * POST /api/v1/social/inbox/:id/reply — post a reply to the originating platform
 *
 * Resolves the social provider for the inbox item's account/org/platform,
 * publishes the reply threaded to the original comment/mention/post via
 * `replyToId`, and only marks the inbox item as `replied` once the platform
 * post succeeds. Mirrors the publish route's 401 → refresh → retry pattern.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  isTokenExpiredError,
  markAccountTokenExpired,
  refreshAccountToken,
  resolveProvider,
  toPlatformType,
} from '@/lib/social/account-resolver'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const POST = withAuth('client', withTenant(async (req, _user, orgId, context) => {
  const { id } = await (context as Params).params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const text = typeof (body as { text?: unknown })?.text === 'string'
    ? ((body as { text: string }).text).trim()
    : ''
  if (!text) return apiError('Reply text is required', 400)

  const itemDoc = await adminDb.collection('social_inbox').doc(id).get()
  if (!itemDoc.exists || itemDoc.data()?.orgId !== orgId) {
    return apiError('Inbox item not found', 404)
  }
  const item = itemDoc.data()!

  const platformType = toPlatformType(item.platform)
  if (!platformType) return apiError(`Unsupported platform: ${item.platform}`, 400)

  const replyToId = typeof item.platformItemId === 'string' ? item.platformItemId : undefined

  // Build a synthetic post-like object so resolveProvider can pick the
  // right account for this inbox item.
  const accountId: string | undefined =
    typeof item.accountId === 'string' ? item.accountId : undefined
  const resolution = {
    accountIds: accountId
      ? [accountId]
      : (Array.isArray(item.accountIds) ? item.accountIds : undefined),
    accountScope: item.accountScope,
    ownerUid: item.ownerUid,
  }

  let platformPostId: string
  let platformPostUrl: string | null = null
  let resolvedAccountId: string | null = null

  try {
    const { provider, accountId: resolvedId } = await resolveProvider(resolution, orgId, platformType)
    resolvedAccountId = resolvedId

    try {
      const result = await provider.publishPost({ text, replyToId })
      platformPostId = result.platformPostId
      platformPostUrl = result.platformPostUrl ?? null
    } catch (publishErr) {
      const msg = publishErr instanceof Error ? publishErr.message : 'Unknown error'
      if (msg.includes('401') && resolvedId) {
        console.log(`[inbox-reply] 401, refreshing token for ${resolvedId}`)
        const refreshed = await refreshAccountToken(resolvedId, orgId, platformType)
        if (refreshed) {
          const result = await refreshed.publishPost({ text, replyToId })
          platformPostId = result.platformPostId
          platformPostUrl = result.platformPostUrl ?? null
          console.log(`[inbox-reply] Retry succeeded after refresh for ${resolvedId}`)
        } else {
          throw publishErr
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
    // Do NOT mark the item as replied if the platform post failed.
    return apiError('Reply failed: ' + message, 500)
  }

  await adminDb.collection('social_inbox').doc(id).update({
    status: 'replied',
    repliedAt: FieldValue.serverTimestamp(),
    replyText: text,
    replyPlatformId: platformPostId,
    replyPlatformUrl: platformPostUrl,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({
    id,
    status: 'replied',
    platformPostId,
    platformPostUrl,
  })
}))
