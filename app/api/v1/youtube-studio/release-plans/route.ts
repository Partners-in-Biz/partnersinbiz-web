import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  actorFields,
  ensureOrgAccess,
  listByOrg,
  loadScopedRecord,
  stripUndefinedDeep,
  updateActorFields,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type {
  YouTubeChannelWorkspace,
  YouTubeGateCheck,
  YouTubePublishingPacket,
  YouTubePublishingPolicy,
  YouTubePublishingReadiness,
  YouTubeReleaseMode,
  YouTubeReleasePlan,
  YouTubeVideoProject,
  YouTubeVideoStatus,
} from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

type PlainRecord = Record<string, unknown>
type ReleasePlanChecks = YouTubeReleasePlan['checks']
type Visibility = YouTubePublishingPolicy['defaultVisibility']

const RELEASE_MODES: YouTubeReleaseMode[] = ['manual_handoff', 'private_api_upload', 'scheduled_api_publish']
const RELEASE_VISIBILITIES: Visibility[] = ['private', 'unlisted', 'public']

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanObject(value: unknown): PlainRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as PlainRecord : {}
}

function cleanBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function pick<T extends string>(values: readonly T[], input: unknown, fallback: T): T {
  return values.includes(input as T) ? input as T : fallback
}

function cleanScheduledAt(value: unknown): string | undefined {
  const text = cleanString(value)
  if (!text) return undefined
  return Number.isNaN(Date.parse(text)) ? undefined : text
}

function gate(status: YouTubeGateCheck['status'], message: string): YouTubeGateCheck {
  return { status, message }
}

function cleanGateStatus(value: unknown): YouTubeGateCheck['status'] {
  if (value === 'pass' || value === 'warning' || value === 'block' || value === 'not_applicable') return value
  return 'not_applicable'
}

function packetHasBlockingChecks(packet: YouTubePublishingPacket): boolean {
  return Object.values(cleanObject(packet.checks)).some((check) => cleanObject(check).status === 'block')
}

function packetCheckStatus(packet: YouTubePublishingPacket, key: keyof YouTubePublishingPacket['checks']) {
  return cleanGateStatus(cleanObject(cleanObject(packet.checks)[key]).status)
}

function releasePlanStatusForMode(mode: YouTubeReleaseMode): YouTubeReleasePlan['status'] {
  return mode === 'scheduled_api_publish' ? 'scheduled' : 'ready'
}

function videoStatusForMode(mode: YouTubeReleaseMode): YouTubeVideoStatus {
  return mode === 'scheduled_api_publish' ? 'scheduled' : 'publish_ready'
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(cleanString).filter((item): item is string => Boolean(item))
}

function channelAllowedModes(channel: YouTubeChannelWorkspace): YouTubeReleaseMode[] {
  const policy = cleanObject(channel.defaultPublishingPolicy)
  const readiness = cleanObject(channel.publishingReadiness)
  const policyModes = stringArray(policy.allowedModes).filter((mode): mode is YouTubeReleaseMode =>
    RELEASE_MODES.includes(mode as YouTubeReleaseMode)
  )
  const readinessModes = stringArray(readiness.allowedModes).filter((mode): mode is YouTubeReleaseMode =>
    RELEASE_MODES.includes(mode as YouTubeReleaseMode)
  )

  if (policyModes.length && readinessModes.length) {
    return policyModes.filter((mode) => readinessModes.includes(mode))
  }
  if (policyModes.length) return policyModes
  if (readinessModes.length) return readinessModes
  return ['manual_handoff']
}

function releaseChecks(
  mode: YouTubeReleaseMode,
  packet: YouTubePublishingPacket,
  channel: YouTubeChannelWorkspace,
  targetVisibility: Visibility,
  scheduledPublishAt?: string,
): ReleasePlanChecks {
  const readiness = cleanObject(channel.publishingReadiness) as Partial<YouTubePublishingReadiness>
  const policy = cleanObject(channel.defaultPublishingPolicy)
  const connectedAccountStatus = packetCheckStatus(packet, 'connectedAccount')
  const requiresClientConfirmation = cleanBoolean(policy.publicPublishRequiresClientConfirmation) === true

  const approvedPacket = packet.status === 'approved'
    ? gate('pass', 'Publishing packet is approved for release planning.')
    : gate('block', 'Publishing packet must be approved before release planning.')

  const connectedAccount = (() => {
    if (mode === 'manual_handoff') return gate('not_applicable', 'Manual handoff does not require API upload readiness.')
    if (connectedAccountStatus === 'pass') return gate('pass', 'Connected account is ready for this release mode.')
    return gate('block', 'Connected account must pass before API upload or scheduled publishing.')
  })()

  const privateFirst = mode === 'manual_handoff'
    ? gate('not_applicable', 'Manual handoff remains outside API upload automation.')
    : gate('pass', 'API release plan keeps the upload privacy private before target visibility changes.')

  const clientConfirmation = requiresClientConfirmation && targetVisibility === 'public'
    ? packet.approvedBy
      ? gate('pass', 'Client confirmation is captured on the approved publishing packet.')
      : gate('block', 'Client confirmation is required before public release planning.')
    : gate('not_applicable', 'Client confirmation is not required by the channel publishing policy.')

  const scheduleWindow = (() => {
    if (mode !== 'scheduled_api_publish') return gate('not_applicable', 'This release mode does not require a scheduled publish time.')
    if (!scheduledPublishAt) return gate('block', 'A valid scheduled publish timestamp is required for scheduled publishing.')
    if (readiness.readiness !== 'scheduled_publish_ready') {
      return gate('block', 'Channel readiness must be scheduled_publish_ready before scheduled publishing.')
    }
    if (readiness.apiProjectStatus === 'unverified_private_only') {
      return gate('block', 'Unverified API projects must remain private and cannot schedule public publishing.')
    }
    return gate('pass', 'Scheduled publish timestamp is valid for a private-first YouTube release plan.')
  })()

  return { approvedPacket, connectedAccount, privateFirst, clientConfirmation, scheduleWindow }
}

function hasBlockingReleaseChecks(checks: ReleasePlanChecks): boolean {
  return Object.values(checks).some((check) => check.status === 'block')
}

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const channelWorkspaceId = url.searchParams.get('channelWorkspaceId')?.trim() ?? ''
  const videoProjectId = url.searchParams.get('videoProjectId')?.trim() ?? ''
  const publishingPacketId = url.searchParams.get('publishingPacketId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const docs = await listByOrg(YOUTUBE_COLLECTIONS.releasePlans, orgId)
  const releasePlans = docs
    .map((doc) => serializeYouTubeRecord<YouTubeReleasePlan>(doc.id, doc.data()))
    .filter((plan) => !channelWorkspaceId || plan.channelWorkspaceId === channelWorkspaceId)
    .filter((plan) => !videoProjectId || plan.videoProjectId === videoProjectId)
    .filter((plan) => !publishingPacketId || plan.publishingPacketId === publishingPacketId)

  return apiSuccess({ releasePlans })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const publishingPacketId = cleanString(body.publishingPacketId) ?? ''
  if (!publishingPacketId) return apiError('publishingPacketId is required', 400)

  const packetRecord = await loadScopedRecord(YOUTUBE_COLLECTIONS.packets, publishingPacketId)
  if (!packetRecord || packetRecord.data.deleted === true) return apiError('Publishing packet not found', 404)
  const packet = serializeYouTubeRecord<YouTubePublishingPacket>(packetRecord.id, packetRecord.data)
  if (packet.orgId !== orgId) return apiError('publishingPacketId does not belong to organisation', 400)
  if (packet.status !== 'approved') return apiError('Publishing packet must be approved before release planning', 409)
  if (packetHasBlockingChecks(packet)) return apiError('Publishing packet has blocking checks and cannot be released', 409)

  const channelRecord = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, packet.channelWorkspaceId)
  if (!channelRecord || channelRecord.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  const channel = serializeYouTubeRecord<YouTubeChannelWorkspace>(channelRecord.id, channelRecord.data)
  if (channel.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)

  const videoRecord = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, packet.videoProjectId)
  if (!videoRecord || videoRecord.data.deleted === true) return apiError('Video project not found', 404)
  const video = serializeYouTubeRecord<YouTubeVideoProject>(videoRecord.id, videoRecord.data)
  if (video.orgId !== orgId) return apiError('videoProjectId does not belong to organisation', 400)
  if (video.channelWorkspaceId !== packet.channelWorkspaceId) {
    return apiError('Publishing packet does not match video project channel', 400)
  }

  const mode = pick(RELEASE_MODES, body.mode, 'manual_handoff')
  const allowedModes = channelAllowedModes(channel)
  if (!allowedModes.includes(mode)) return apiError('Release mode is not allowed by channel readiness or publishing policy', 409)

  const targetVisibility = pick(RELEASE_VISIBILITIES, body.targetVisibility, 'private')
  const scheduledPublishAt = cleanScheduledAt(body.scheduledPublishAt)
  const checks = releaseChecks(mode, packet, channel, targetVisibility, scheduledPublishAt)
  if (hasBlockingReleaseChecks(checks)) {
    return apiError('Release plan has blocking checks and cannot be created', 409, { checks })
  }

  const releasePlan = stripUndefinedDeep({
    orgId,
    channelWorkspaceId: packet.channelWorkspaceId,
    videoProjectId: packet.videoProjectId,
    publishingPacketId,
    mode,
    status: releasePlanStatusForMode(mode),
    uploadPrivacyStatus: 'private',
    targetVisibility,
    scheduledPublishAt: mode === 'scheduled_api_publish' ? scheduledPublishAt : undefined,
    publicSummary: cleanString(body.publicSummary),
    internalNotes: cleanString(body.internalNotes),
    checks,
    visibility: {
      showInClientPortal: cleanBoolean(cleanObject(body.visibility).showInClientPortal) ?? true,
    },
    deleted: false,
    ...actorFields(user),
  }) as Omit<YouTubeReleasePlan, 'id'>

  const releaseRef = adminDb.collection(YOUTUBE_COLLECTIONS.releasePlans).doc()
  const batch = adminDb.batch()
  batch.set(releaseRef, releasePlan)
  batch.set(videoRecord.ref, stripUndefinedDeep({
    status: videoStatusForMode(mode),
    scheduledAt: mode === 'scheduled_api_publish' ? scheduledPublishAt : undefined,
    ...updateActorFields(user),
  }), { merge: true })
  await batch.commit()

  return apiSuccess({ id: releaseRef.id }, 201)
})
