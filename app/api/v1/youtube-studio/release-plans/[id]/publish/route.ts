import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { markAccountTokenExpired } from '@/lib/social/account-resolver'
import {
  ensureOrgAccess,
  loadScopedRecord,
  stripUndefinedDeep,
  updateActorFields,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import { publishLoadedReleasePlan } from '@/lib/youtube-studio/publish-executor'
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

  const accountId = channel.connectedAccountId!

  // Delegate to the shared publish core (reused by the scheduled-publish cron executor).
  // The core re-runs ALL readiness/approval gates, records the readiness-block audit, runs the
  // upload, and writes the success batch — identical to the previous inline behaviour.
  const outcome = await publishLoadedReleasePlan({
    context: { releasePlan, releaseRef, packet, channel, channelRef, videoAsset },
    actor: { uid: user.uid, type: user.role === 'ai' ? 'agent' : 'user' },
  })

  if (outcome.kind === 'already_published') {
    return apiSuccess({
      status: releasePlan.status,
      externalYouTubeVideoId: outcome.externalYouTubeVideoId,
      externalYouTubeUrl: releasePlan.externalYouTubeUrl,
    })
  }

  if (outcome.kind === 'blocked') {
    return apiError('YouTube publish readiness checks did not pass', 409, {
      readiness: {
        ready: false,
        mode: releasePlan.mode,
        blockers: outcome.blockers,
        manualHandoffRequired: outcome.manualHandoffRequired,
      },
    })
  }

  if (outcome.kind === 'no_account') {
    return apiError(outcome.message, 409)
  }

  if (outcome.kind === 'published') {
    return apiSuccess({
      status: outcome.status,
      externalYouTubeVideoId: outcome.externalYouTubeVideoId,
      externalYouTubeUrl: outcome.externalYouTubeUrl,
    })
  }

  // outcome.kind === 'failed' — write the route's failure record (no attempt increment on the
  // synchronous route; retry accounting lives in the cron executor) and surface an HTTP status.
  if (outcome.type === 'auth') await markAccountTokenExpired(accountId, outcome.message).catch(() => {})

  await releaseRef.set(stripUndefinedDeep({
    status: outcome.retryable ? releasePlan.status : 'blocked',
    lastPublishError: outcome.message,
    publishAuditTrail: FieldValue.arrayUnion({
      event: 'upload_failed',
      message: outcome.message,
      retryable: outcome.retryable,
      errorType: outcome.type,
      at: FieldValue.serverTimestamp(),
      actorId: user.uid,
      actorType: user.role === 'ai' ? 'agent' : 'user',
    }),
    ...updateActorFields(user),
  }), { merge: true })

  const statusCode = outcome.type === 'quota' ? 429 : outcome.retryable ? 503 : 409
  return apiError('YouTube publish failed', statusCode, {
    classification: { type: outcome.type, retryable: outcome.retryable, message: outcome.message },
  })
})
