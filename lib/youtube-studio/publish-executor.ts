import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  resolveProvider,
  refreshAccountToken,
  markAccountTokenExpired,
} from '@/lib/social/account-resolver'
import { loadScopedRecord, stripUndefinedDeep, YOUTUBE_COLLECTIONS } from './api'
import { serializeYouTubeRecord } from './sanitize'
import {
  buildYouTubeUploadOptions,
  classifyYouTubePublishError,
  evaluateYouTubePublishReadiness,
  YOUTUBE_UPLOAD_QUOTA_UNITS,
} from './publishing'
import type {
  ActorType,
  YouTubeChannelWorkspace,
  YouTubePublishingPacket,
  YouTubeReleasePlan,
  YouTubeSourceAsset,
} from './types'

/** Retry cap: after this many failed attempts a plan is terminally `publish_failed`. */
export const YOUTUBE_PUBLISH_MAX_ATTEMPTS = 3

export type PublishActor = { uid: string; type: ActorType }

const SYSTEM_ACTOR: PublishActor = { uid: 'system:youtube-publish-cron', type: 'system' }

type ProviderResolver = typeof resolveProvider

function actorPatch(actor: PublishActor) {
  return {
    updatedBy: actor.uid,
    updatedByType: actor.type,
    updatedAt: FieldValue.serverTimestamp(),
  }
}

export type PublishOutcome =
  | { kind: 'already_published'; externalYouTubeVideoId?: string }
  | { kind: 'blocked'; blockers: string[]; manualHandoffRequired: boolean }
  | { kind: 'no_account'; message: string }
  | { kind: 'published'; externalYouTubeVideoId: string; externalYouTubeUrl: string; status: string }
  | { kind: 'failed'; retryable: boolean; message: string; type: string }

type LoadedPublishContext = {
  releasePlan: YouTubeReleasePlan
  releaseRef: FirebaseFirestore.DocumentReference
  packet: YouTubePublishingPacket
  channel: YouTubeChannelWorkspace
  channelRef: FirebaseFirestore.DocumentReference
  videoAsset: YouTubeSourceAsset
}

async function publishWithOneRefresh(input: {
  provider: Awaited<ReturnType<ProviderResolver>>['provider']
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

/**
 * Shared publish core reused by both the human-triggered publish route and the scheduled
 * executor. Re-runs ALL readiness/approval gates, then executes the YouTube Data API upload,
 * writing the exact same success/failure records the route sets. Never bypasses a gate.
 *
 * A `blocked` outcome (readiness/approval) is deliberately NOT a publish failure — callers must
 * not count it against the retry cap.
 */
export async function publishLoadedReleasePlan(input: {
  context: LoadedPublishContext
  actor?: PublishActor
  resolveProviderImpl?: ProviderResolver
}): Promise<PublishOutcome> {
  const actor = input.actor ?? SYSTEM_ACTOR
  const resolve = input.resolveProviderImpl ?? resolveProvider
  const { releasePlan, releaseRef, packet, channel, channelRef, videoAsset } = input.context

  if (releasePlan.externalYouTubeVideoId) {
    return { kind: 'already_published', externalYouTubeVideoId: releasePlan.externalYouTubeVideoId }
  }

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
        actorId: actor.uid,
        actorType: actor.type,
      }),
      ...actorPatch(actor),
    }), { merge: true })
    return { kind: 'blocked', blockers: readiness.blockers, manualHandoffRequired: readiness.manualHandoffRequired }
  }

  const options = buildYouTubeUploadOptions({ packet, releasePlan, videoAsset })
  const accountId = channel.connectedAccountId!

  try {
    const { provider, accountId: resolvedAccountId } = await resolve({
      orgId: releasePlan.orgId,
      platform: 'youtube',
      accountIds: [accountId],
      content: { text: options.text },
    } as unknown as Record<string, unknown>, releasePlan.orgId, 'youtube')
    if (!resolvedAccountId) {
      return { kind: 'no_account', message: 'No active connected YouTube account for this organisation' }
    }

    await releaseRef.set(stripUndefinedDeep({
      status: 'scheduled',
      publishExecutionStatus: 'publishing',
      publishAttemptCount: FieldValue.increment(1),
      lastPublishAttemptAt: FieldValue.serverTimestamp(),
      publishAuditTrail: FieldValue.arrayUnion({
        event: 'upload_started',
        message: 'YouTube Data API upload started after all readiness gates passed.',
        quotaUnits: YOUTUBE_UPLOAD_QUOTA_UNITS,
        at: FieldValue.serverTimestamp(),
        actorId: actor.uid,
        actorType: actor.type,
      }),
      ...actorPatch(actor),
    }), { merge: true })

    const published = await publishWithOneRefresh({ provider, options, accountId: resolvedAccountId, orgId: releasePlan.orgId })
    const externalYouTubeVideoId = published.platformPostId
    const externalYouTubeUrl = published.platformPostUrl ?? `https://www.youtube.com/watch?v=${externalYouTubeVideoId}`
    const finalStatus = releasePlan.mode === 'scheduled_api_publish' ? 'scheduled' : 'published'

    const batch = adminDb.batch()
    batch.set(releaseRef, stripUndefinedDeep({
      status: finalStatus,
      publishExecutionStatus: 'published',
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
        actorId: actor.uid,
        actorType: actor.type,
      }),
      ...actorPatch(actor),
    }), { merge: true })
    batch.set(adminDb.collection(YOUTUBE_COLLECTIONS.videos).doc(releasePlan.videoProjectId), stripUndefinedDeep({
      status: releasePlan.mode === 'scheduled_api_publish' ? 'scheduled' : 'live',
      externalYouTubeVideoId,
      externalYouTubeUrl,
      publishedAt: releasePlan.mode === 'scheduled_api_publish' ? undefined : FieldValue.serverTimestamp(),
      scheduledAt: releasePlan.mode === 'scheduled_api_publish' ? releasePlan.scheduledPublishAt : undefined,
      ...actorPatch(actor),
    }), { merge: true })
    batch.set(adminDb.collection(YOUTUBE_COLLECTIONS.packets).doc(releasePlan.publishingPacketId), stripUndefinedDeep({
      status: 'published',
      externalYouTubeVideoId,
      ...actorPatch(actor),
    }), { merge: true })
    batch.set(channelRef, stripUndefinedDeep({
      'publishingReadiness.quotaUnitsRemaining': FieldValue.increment(-YOUTUBE_UPLOAD_QUOTA_UNITS),
      'publishingReadiness.lastCheckedAt': FieldValue.serverTimestamp(),
      ...actorPatch(actor),
    }), { merge: true })
    await batch.commit()

    return { kind: 'published', externalYouTubeVideoId, externalYouTubeUrl, status: finalStatus }
  } catch (error) {
    const classified = classifyYouTubePublishError(error)
    const message = classified.message
    if (classified.type === 'auth') await markAccountTokenExpired(accountId, message).catch(() => {})

    if (classified.type === 'quota') {
      await channelRef.set(stripUndefinedDeep({
        'publishingReadiness.apiProjectStatus': 'quota_limited',
        'publishingReadiness.quotaUnitsRemaining': 0,
        'publishingReadiness.lastCheckedAt': FieldValue.serverTimestamp(),
        ...actorPatch(actor),
      }), { merge: true }).catch(() => {})
    }

    return { kind: 'failed', retryable: classified.retryable, type: classified.type, message }
  }
}

export type DrainDueReleasePlansResult = {
  due: number
  published: number
  blocked: number
  retried: number
  exhausted: number
  skipped: number
}

async function loadContext(
  releasePlan: YouTubeReleasePlan,
  releaseRef: FirebaseFirestore.DocumentReference,
): Promise<LoadedPublishContext | { skipReason: string }> {
  const packetRecord = await loadScopedRecord(YOUTUBE_COLLECTIONS.packets, releasePlan.publishingPacketId)
  if (!packetRecord || packetRecord.data.deleted === true) return { skipReason: 'packet_missing' }
  const packet = serializeYouTubeRecord<YouTubePublishingPacket>(packetRecord.id, packetRecord.data)
  if (packet.orgId !== releasePlan.orgId) return { skipReason: 'packet_org_mismatch' }

  const channelRecord = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, releasePlan.channelWorkspaceId)
  if (!channelRecord || channelRecord.data.deleted === true) return { skipReason: 'channel_missing' }
  const channel = serializeYouTubeRecord<YouTubeChannelWorkspace>(channelRecord.id, channelRecord.data)
  if (channel.orgId !== releasePlan.orgId) return { skipReason: 'channel_org_mismatch' }

  const assetId = packet.videoAssetId
  if (!assetId) return { skipReason: 'asset_missing' }
  const assetRecord = await loadScopedRecord(YOUTUBE_COLLECTIONS.sourceAssets, assetId)
  if (!assetRecord || assetRecord.data.deleted === true) return { skipReason: 'asset_missing' }
  const videoAsset = serializeYouTubeRecord<YouTubeSourceAsset>(assetRecord.id, assetRecord.data)
  if (videoAsset.orgId !== releasePlan.orgId) return { skipReason: 'asset_org_mismatch' }

  return { releasePlan, releaseRef, packet, channel, channelRef: channelRecord.ref, videoAsset }
}

/**
 * Drains release plans whose scheduled publish window has arrived and pushes them through the
 * shared publish core with capped retry. Per-plan try/catch isolation: one bad plan never aborts
 * the batch. Approval/readiness blocks are recorded WITHOUT consuming a retry attempt.
 */
export async function drainDueYouTubeReleasePlans(input: {
  now: Date
  limit?: number
  actor?: PublishActor
}): Promise<DrainDueReleasePlansResult> {
  const now = input.now
  const limit = input.limit ?? 10
  const actor = input.actor ?? SYSTEM_ACTOR
  const nowIso = now.toISOString()

  const snapshot = await adminDb
    .collection(YOUTUBE_COLLECTIONS.releasePlans)
    .where('scheduledPublishAt', '<=', nowIso)
    .get()

  const result: DrainDueReleasePlansResult = { due: 0, published: 0, blocked: 0, retried: 0, exhausted: 0, skipped: 0 }

  const candidates = snapshot.docs
    .map((doc) => ({ ref: doc.ref, plan: serializeYouTubeRecord<YouTubeReleasePlan>(doc.id, doc.data()) }))
    .filter(({ plan }) => plan.deleted !== true)
    // API publish modes only — manual handoff is never auto-published.
    .filter(({ plan }) => plan.mode === 'scheduled_api_publish' || plan.mode === 'private_api_upload')
    .filter(({ plan }) => !plan.externalYouTubeVideoId)
    .filter(({ plan }) => plan.publishExecutionStatus !== 'published' && plan.publishExecutionStatus !== 'failed')
    .filter(({ plan }) => plan.status !== 'published' && plan.status !== 'cancelled')

  const batch = candidates.slice(0, limit)
  result.due = batch.length

  for (const { ref, plan } of batch) {
    try {
      const loaded = await loadContext(plan, ref)
      if ('skipReason' in loaded) {
        result.skipped += 1
        continue
      }

      const outcome = await publishLoadedReleasePlan({ context: loaded, actor })

      if (outcome.kind === 'published' || outcome.kind === 'already_published') {
        result.published += 1
        continue
      }
      if (outcome.kind === 'blocked') {
        // Readiness/approval gate — recorded by the core, no attempt burn.
        result.blocked += 1
        continue
      }

      // outcome.kind === 'failed' | 'no_account' — count the attempt and decide retry vs terminal.
      const retryable = outcome.kind === 'no_account' ? true : outcome.retryable
      const errorType = outcome.kind === 'no_account' ? 'no_account' : outcome.type
      const priorAttempts = typeof plan.publishAttemptCount === 'number' ? plan.publishAttemptCount : 0
      const attempts = priorAttempts + 1
      const terminal = !retryable || attempts >= YOUTUBE_PUBLISH_MAX_ATTEMPTS

      await ref.set(stripUndefinedDeep({
        status: terminal ? 'blocked' : plan.status,
        publishExecutionStatus: terminal ? 'failed' : 'pending',
        publishAttemptCount: FieldValue.increment(1),
        lastPublishAttemptAt: FieldValue.serverTimestamp(),
        lastPublishError: outcome.message,
        publishAuditTrail: FieldValue.arrayUnion({
          event: 'upload_failed',
          message: outcome.message,
          retryable: retryable && !terminal,
          errorType,
          at: FieldValue.serverTimestamp(),
          actorId: actor.uid,
          actorType: actor.type,
        }),
        ...actorPatch(actor),
      }), { merge: true })

      if (terminal) result.exhausted += 1
      else result.retried += 1
    } catch {
      // Isolation: an unexpected exception on one plan never aborts the batch.
      result.skipped += 1
    }
  }

  return result
}
