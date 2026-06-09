import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { resolveProvider, refreshAccountToken, markAccountTokenExpired } from '@/lib/social/account-resolver'
import {
  ensureOrgAccess,
  loadScopedRecord,
  stripUndefinedDeep,
  updateActorFields,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import {
  buildYouTubeUploadOptions,
  classifyYouTubePublishError,
  evaluateYouTubePublishReadiness,
  YOUTUBE_UPLOAD_QUOTA_UNITS,
} from '@/lib/youtube-studio/publishing'
import type {
  YouTubeChannelWorkspace,
  YouTubePublishingPacket,
  YouTubeReleasePlan,
  YouTubeSourceAsset,
} from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

type PlainRecord = Record<string, unknown>

function cleanObject(value: unknown): PlainRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as PlainRecord : {}
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function loadRequired<T extends object>(collection: string, id: string, notFoundMessage: string) {
  const record = await loadScopedRecord(collection, id)
  if (!record || record.data.deleted === true) return { error: apiError(notFoundMessage, 404) }
  return { record, data: serializeYouTubeRecord<T>(record.id, record.data) }
}

async function publishWithOneRefresh(input: {
  provider: Awaited<ReturnType<typeof resolveProvider>>['provider']
  options: ReturnType<typeof buildYouTubeUploadOptions>
  accountId: string
  orgId: string
}) {
  try {
    return await input.provider.publishPost(input.options)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('401') && !message.toLowerCase().includes('unauthorized')) throw error
    const refreshed = await refreshAccountToken(input.accountId, input.orgId, 'youtube')
    if (!refreshed) throw error
    return await refreshed.publishPost(input.options)
  }
}

export const POST = withAuth('admin', async (req: NextRequest, user, ctx: Params) => {
  const { id } = await ctx.params
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? req.nextUrl.searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const releaseLoaded = await loadRequired<YouTubeReleasePlan>(YOUTUBE_COLLECTIONS.releasePlans, id, 'Release plan not found')
  if (releaseLoaded.error) return releaseLoaded.error
  const releasePlan = releaseLoaded.data!
  const releaseRef = releaseLoaded.record!.ref
  if (releasePlan.orgId !== orgId) return apiError('Release plan does not belong to organisation', 400)
  if (releasePlan.externalYouTubeVideoId) {
    return apiSuccess({
      status: releasePlan.status,
      externalYouTubeVideoId: releasePlan.externalYouTubeVideoId,
      externalYouTubeUrl: releasePlan.externalYouTubeUrl,
    })
  }

  const packetLoaded = await loadRequired<YouTubePublishingPacket>(YOUTUBE_COLLECTIONS.packets, releasePlan.publishingPacketId, 'Publishing packet not found')
  if (packetLoaded.error) return packetLoaded.error
  const packet = packetLoaded.data!
  if (packet.orgId !== orgId) return apiError('Publishing packet does not belong to organisation', 400)

  const channelLoaded = await loadRequired<YouTubeChannelWorkspace>(YOUTUBE_COLLECTIONS.channels, releasePlan.channelWorkspaceId, 'YouTube channel workspace not found')
  if (channelLoaded.error) return channelLoaded.error
  const channel = channelLoaded.data!
  const channelRef = channelLoaded.record!.ref
  if (channel.orgId !== orgId) return apiError('YouTube channel workspace does not belong to organisation', 400)

  const assetId = packet.videoAssetId
  if (!assetId) return apiError('Publishing packet videoAssetId is required before YouTube upload', 409)
  const assetLoaded = await loadRequired<YouTubeSourceAsset>(YOUTUBE_COLLECTIONS.sourceAssets, assetId, 'Video source asset not found')
  if (assetLoaded.error) return assetLoaded.error
  const videoAsset = assetLoaded.data!
  if (videoAsset.orgId !== orgId) return apiError('Video source asset does not belong to organisation', 400)

  const readiness = evaluateYouTubePublishReadiness({ channel, packet, releasePlan, videoAsset })
  if (!readiness.ready) {
    const eventName = readiness.manualHandoffRequired ? 'manual_handoff_required' : 'readiness_blocked'
    await releaseRef.set(stripUndefinedDeep({
      status: readiness.manualHandoffRequired ? releasePlan.status : 'blocked',
      lastPublishError: readiness.blockers.join('; '),
      publishAuditTrail: FieldValue.arrayUnion({
        event: eventName,
        message: readiness.blockers.join('; '),
        at: FieldValue.serverTimestamp(),
        actorId: user.uid,
        actorType: user.role === 'ai' ? 'agent' : 'user',
      }),
      ...updateActorFields(user),
    }), { merge: true })
    return apiError('YouTube publish readiness checks did not pass', 409, { readiness })
  }

  const options = buildYouTubeUploadOptions({ packet, releasePlan, videoAsset })
  const accountId = channel.connectedAccountId!

  try {
    const { provider, accountId: resolvedAccountId } = await resolveProvider({
      orgId,
      platform: 'youtube',
      accountIds: [accountId],
      content: { text: options.text },
    }, orgId, 'youtube')
    if (!resolvedAccountId) return apiError('No active connected YouTube account for this organisation', 409)

    await releaseRef.set(stripUndefinedDeep({
      status: 'scheduled',
      publishAttemptCount: FieldValue.increment(1),
      lastPublishAttemptAt: FieldValue.serverTimestamp(),
      publishAuditTrail: FieldValue.arrayUnion({
        event: 'upload_started',
        message: 'YouTube Data API upload started after all readiness gates passed.',
        quotaUnits: YOUTUBE_UPLOAD_QUOTA_UNITS,
        at: FieldValue.serverTimestamp(),
        actorId: user.uid,
        actorType: user.role === 'ai' ? 'agent' : 'user',
      }),
      ...updateActorFields(user),
    }), { merge: true })

    const published = await publishWithOneRefresh({ provider, options, accountId: resolvedAccountId, orgId })
    const externalYouTubeVideoId = published.platformPostId
    const externalYouTubeUrl = published.platformPostUrl ?? `https://www.youtube.com/watch?v=${externalYouTubeVideoId}`
    const finalStatus = releasePlan.mode === 'scheduled_api_publish' ? 'scheduled' : 'published'

    const batch = adminDb.batch()
    batch.set(releaseRef, stripUndefinedDeep({
      status: finalStatus,
      externalYouTubeVideoId,
      externalYouTubeUrl,
      lastPublishError: null,
      publishAuditTrail: FieldValue.arrayUnion({
        event: 'upload_succeeded',
        message: releasePlan.mode === 'scheduled_api_publish'
          ? 'YouTube Data API upload succeeded and scheduled publish metadata was accepted.'
          : 'YouTube Data API private upload succeeded.',
        externalYouTubeVideoId,
        quotaUnits: YOUTUBE_UPLOAD_QUOTA_UNITS,
        at: FieldValue.serverTimestamp(),
        actorId: user.uid,
        actorType: user.role === 'ai' ? 'agent' : 'user',
      }),
      ...updateActorFields(user),
    }), { merge: true })
    batch.set(adminDb.collection(YOUTUBE_COLLECTIONS.videos).doc(releasePlan.videoProjectId), stripUndefinedDeep({
      status: releasePlan.mode === 'scheduled_api_publish' ? 'scheduled' : 'live',
      externalYouTubeVideoId,
      externalYouTubeUrl,
      publishedAt: releasePlan.mode === 'scheduled_api_publish' ? undefined : FieldValue.serverTimestamp(),
      scheduledAt: releasePlan.mode === 'scheduled_api_publish' ? releasePlan.scheduledPublishAt : undefined,
      ...updateActorFields(user),
    }), { merge: true })
    batch.set(adminDb.collection(YOUTUBE_COLLECTIONS.packets).doc(releasePlan.publishingPacketId), stripUndefinedDeep({
      status: 'published',
      externalYouTubeVideoId,
      ...updateActorFields(user),
    }), { merge: true })
    batch.set(channelRef, stripUndefinedDeep({
      'publishingReadiness.quotaUnitsRemaining': FieldValue.increment(-YOUTUBE_UPLOAD_QUOTA_UNITS),
      'publishingReadiness.lastCheckedAt': FieldValue.serverTimestamp(),
      ...updateActorFields(user),
    }), { merge: true })
    await batch.commit()

    return apiSuccess({ status: finalStatus, externalYouTubeVideoId, externalYouTubeUrl })
  } catch (error) {
    const classified = classifyYouTubePublishError(error)
    const message = classified.message
    if (classified.type === 'auth') await markAccountTokenExpired(accountId, message).catch(() => {})

    const batch = adminDb.batch()
    batch.set(releaseRef, stripUndefinedDeep({
      status: classified.retryable ? releasePlan.status : 'blocked',
      lastPublishError: message,
      publishAuditTrail: FieldValue.arrayUnion({
        event: 'upload_failed',
        message,
        retryable: classified.retryable,
        errorType: classified.type,
        at: FieldValue.serverTimestamp(),
        actorId: user.uid,
        actorType: user.role === 'ai' ? 'agent' : 'user',
      }),
      ...updateActorFields(user),
    }), { merge: true })
    if (classified.type === 'quota') {
      batch.set(channelRef, stripUndefinedDeep({
        'publishingReadiness.apiProjectStatus': 'quota_limited',
        'publishingReadiness.quotaUnitsRemaining': 0,
        'publishingReadiness.lastCheckedAt': FieldValue.serverTimestamp(),
        ...updateActorFields(user),
      }), { merge: true })
    }
    await batch.commit()

    const statusCode = classified.type === 'quota' ? 429 : classified.retryable ? 503 : 409
    return apiError('YouTube publish failed', statusCode, { classification: classified })
  }
})
