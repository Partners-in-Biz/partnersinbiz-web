import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess } from '@/lib/api/response'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'
import { stripUndefinedDeep, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import {
  clientSafeYouTubeAnalyticsSnapshot,
  clientSafeYouTubeChannelWorkspace,
  clientSafeYouTubePublishingPacket,
  clientSafeYouTubeSeries,
  clientSafeYouTubeVideoProject,
  sanitizeYouTubeVideoProjectInput,
  serializeYouTubeRecord,
} from '@/lib/youtube-studio/sanitize'
import type {
  YouTubeAnalyticsSnapshot,
  YouTubeChannelWorkspace,
  YouTubePublishingPacket,
  YouTubeSeries,
  YouTubeVideoProject,
  YouTubeVideoStatus,
} from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

type PlainRecord = Record<string, unknown>
type ClientDecision = 'approved' | 'changes_requested' | 'rejected'
type PortalChannelResult =
  | { channel: YouTubeChannelWorkspace & { id: string } }
  | { error: Response }

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanBody(value: unknown): PlainRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as PlainRecord : {}
}

async function youtubeStudioModuleGuard(orgId: string) {
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)
  if (!isPortalModuleEnabled(orgDoc.data()?.settings, 'youtubeStudio')) {
    return apiError('YouTube Studio module is disabled for this client portal', 403, {
      moduleDisabled: true,
      module: 'youtubeStudio',
    })
  }
  return null
}

async function listOrg<T extends object>(collectionName: string, orgId: string) {
  const snap = await adminDb.collection(collectionName).where('orgId', '==', orgId).get()
  return snap.docs
    .map((doc) => serializeYouTubeRecord<T>(doc.id, doc.data()))
    .filter((record) => (record as { deleted?: boolean }).deleted !== true)
}

function isPortalVisible(record: { visibility?: { showInClientPortal?: boolean } }): boolean {
  return record.visibility?.showInClientPortal !== false
}

function isAnalyticsVisible(record: { visibility?: { showAnalytics?: boolean } }): boolean {
  return record.visibility?.showAnalytics !== false
}

function decisionStatus(decision: ClientDecision): YouTubeVideoStatus {
  if (decision === 'approved') return 'internal_review'
  if (decision === 'changes_requested') return 'changes_requested'
  return 'blocked'
}

function parseDecision(value: unknown): ClientDecision | null {
  if (value === 'approved' || value === 'changes_requested' || value === 'rejected') return value
  return null
}

function packetDecisionStatus(decision: ClientDecision): YouTubePublishingPacket['status'] {
  if (decision === 'approved') return 'approved'
  if (decision === 'changes_requested') return 'draft'
  return 'blocked'
}

function packetDecisionApprovalStatus(decision: ClientDecision) {
  if (decision === 'approved') return 'pass'
  if (decision === 'changes_requested') return 'warning'
  return 'block'
}

function packetDecisionMessage(decision: ClientDecision, notes?: string) {
  const base = decision === 'approved'
    ? 'Client approved publishing packet.'
    : decision === 'changes_requested'
      ? 'Client requested publishing packet changes.'
      : 'Client rejected publishing packet.'
  return notes ? `${base} ${notes}` : base
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as PlainRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function packetApprovalSnapshotHash(packet: YouTubePublishingPacket, status: YouTubePublishingPacket['status'], approvalCheck: PlainRecord) {
  const snapshot = {
    channelWorkspaceId: packet.channelWorkspaceId,
    videoProjectId: packet.videoProjectId,
    versionNumber: packet.versionNumber,
    status,
    titleOptions: packet.titleOptions,
    description: packet.description,
    tags: packet.tags,
    chapters: packet.chapters,
    visibility: packet.visibility,
    selfDeclaredMadeForKids: packet.selfDeclaredMadeForKids,
    containsSyntheticMedia: packet.containsSyntheticMedia,
    aiDisclosureNotes: packet.aiDisclosureNotes,
    checks: {
      ...cleanBody(packet.checks),
      approval: {
        status: approvalCheck.status,
        message: approvalCheck.message,
      },
    },
  }

  return createHash('sha256').update(stableStringify(stripUndefinedDeep(snapshot))).digest('hex')
}

function isClientDecisionOpen(video: YouTubeVideoProject): boolean {
  return (
    video.status === 'client_review' ||
    video.status === 'changes_requested' ||
    video.clientReview?.status === 'requested'
  )
}

function isPacketDecisionOpen(packet: YouTubePublishingPacket): boolean {
  return packet.status === 'client_review'
}

async function loadPortalVisibleChannel(channelWorkspaceId: string, orgId: string): Promise<PortalChannelResult> {
  const channelDoc = await adminDb.collection(YOUTUBE_COLLECTIONS.channels).doc(channelWorkspaceId).get()
  if (!channelDoc.exists) return { error: apiError('YouTube channel workspace not found', 404) }

  const channel = serializeYouTubeRecord<YouTubeChannelWorkspace>(channelDoc.id, channelDoc.data()!)
  if (channel.deleted === true) return { error: apiError('YouTube channel workspace not found', 404) }
  if (channel.orgId !== orgId) return { error: apiError('channelWorkspaceId does not belong to organisation', 403) }
  if (!isPortalVisible(channel)) return { error: apiError('YouTube channel workspace is not visible in the client portal', 403) }

  return { channel }
}

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid, orgId) => {
  const disabled = await youtubeStudioModuleGuard(orgId)
  if (disabled) return disabled

  const [channelsRaw, seriesRaw, videosRaw, packetsRaw, analyticsRaw] = await Promise.all([
    listOrg<YouTubeChannelWorkspace>(YOUTUBE_COLLECTIONS.channels, orgId),
    listOrg<YouTubeSeries>(YOUTUBE_COLLECTIONS.series, orgId),
    listOrg<YouTubeVideoProject>(YOUTUBE_COLLECTIONS.videos, orgId),
    listOrg<YouTubePublishingPacket>(YOUTUBE_COLLECTIONS.packets, orgId),
    listOrg<YouTubeAnalyticsSnapshot>(YOUTUBE_COLLECTIONS.analytics, orgId),
  ])

  const visibleChannelIds = new Set(
    channelsRaw
      .filter(isPortalVisible)
      .map((channel) => channel.id)
      .filter((id): id is string => Boolean(id))
  )
  const analyticsVisibleChannelIds = new Set(
    channelsRaw
      .filter((channel) => isPortalVisible(channel) && isAnalyticsVisible(channel))
      .map((channel) => channel.id)
      .filter((id): id is string => Boolean(id))
  )
  const visibleSeriesIds = new Set(
    seriesRaw
      .filter((series) => visibleChannelIds.has(series.channelWorkspaceId))
      .map((series) => series.id)
      .filter((id): id is string => Boolean(id))
  )
  const visibleVideosRaw = videosRaw.filter((video) =>
    visibleChannelIds.has(video.channelWorkspaceId) &&
    (!video.seriesId || visibleSeriesIds.has(video.seriesId)) &&
    isPortalVisible(video)
  )
  const visibleVideoIds = new Set(visibleVideosRaw.map((video) => video.id).filter((id): id is string => Boolean(id)))

  const channels = channelsRaw
    .filter((channel) => channel.id && visibleChannelIds.has(channel.id))
    .map(clientSafeYouTubeChannelWorkspace)
    .sort((a, b) => a.title.localeCompare(b.title))
  const series = seriesRaw
    .filter((item) => item.id && visibleSeriesIds.has(item.id))
    .map(clientSafeYouTubeSeries)
    .sort((a, b) => a.name.localeCompare(b.name))
  const videos = visibleVideosRaw
    .map(clientSafeYouTubeVideoProject)
    .sort((a, b) => a.title.localeCompare(b.title))
  const packets = packetsRaw
    .filter((packet) =>
      visibleVideoIds.has(packet.videoProjectId) &&
      visibleVideosRaw.some((video) => video.id === packet.videoProjectId && video.visibility?.showPublishingPacket === true)
    )
    .map(clientSafeYouTubePublishingPacket)
  const analytics = analyticsRaw
    .filter((snapshot) =>
      snapshot.visibility?.showInClientPortal === true &&
      analyticsVisibleChannelIds.has(snapshot.channelWorkspaceId) &&
      (!snapshot.videoProjectId || visibleVideoIds.has(snapshot.videoProjectId)) &&
      (!snapshot.seriesId || visibleSeriesIds.has(snapshot.seriesId))
    )
    .map(clientSafeYouTubeAnalyticsSnapshot)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))

  return apiSuccess({ channels, series, videos, packets, analytics })
})

async function handlePortalYouTubeStudioPost(req: NextRequest, uid: string, orgId: string): Promise<Response> {
  const disabled = await youtubeStudioModuleGuard(orgId)
  if (disabled) return disabled

  const body = cleanBody(await req.json().catch(() => ({})))
  const channelWorkspaceId = cleanString(body.channelWorkspaceId) ?? ''
  const title = cleanString(body.title)
  if (!channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (!title) return apiError('title is required', 400)

  const channelResult = await loadPortalVisibleChannel(channelWorkspaceId, orgId)
  if ('error' in channelResult) return channelResult.error

  const data = sanitizeYouTubeVideoProjectInput({
    orgId,
    channelWorkspaceId,
    title,
    objective: cleanString(body.objective) ?? '',
    videoType: body.videoType,
    targetAudience: body.targetAudience,
    source: {
      intakeType: 'client_request',
      sourceUrl: cleanString(body.sourceUrl),
    },
    status: 'intake',
    visibility: { showInClientPortal: true },
    clientReview: { status: 'not_requested' },
    clientNotes: body.clientNotes,
  })

  const write = stripUndefinedDeep({
    ...data,
    createdBy: uid,
    createdByType: 'user',
    updatedBy: uid,
    updatedByType: 'user',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.videos).add(write)
  if (!ref?.id) return apiError('Could not create video request', 500)

  return apiSuccess({ id: ref.id }, 201)
}

export const POST = withPortalAuthAndRole('member', handlePortalYouTubeStudioPost)

async function handlePortalPacketDecision(
  body: PlainRecord,
  uid: string,
  orgId: string,
  decision: ClientDecision,
): Promise<Response> {
  const packetId = cleanString(body.packetId) ?? ''
  if (!packetId) return apiError('packetId is required', 400)

  const packetRef = adminDb.collection(YOUTUBE_COLLECTIONS.packets).doc(packetId)
  const packetDoc = await packetRef.get()
  if (!packetDoc.exists) return apiError('Publishing packet not found', 404)

  const packet = serializeYouTubeRecord<YouTubePublishingPacket>(packetDoc.id, packetDoc.data()!)
  if (packet.deleted === true) return apiError('Publishing packet not found', 404)
  if (packet.orgId !== orgId) return apiError('Forbidden', 403)
  if (!isPacketDecisionOpen(packet)) return apiError('Publishing packet is not awaiting client review', 409)

  const videoRef = adminDb.collection(YOUTUBE_COLLECTIONS.videos).doc(packet.videoProjectId)
  const videoDoc = await videoRef.get()
  if (!videoDoc.exists) return apiError('Video project not found', 404)
  const video = serializeYouTubeRecord<YouTubeVideoProject>(videoDoc.id, videoDoc.data()!)
  if (video.deleted === true) return apiError('Video project not found', 404)
  if (video.orgId !== orgId) return apiError('Forbidden', 403)
  if (!isPortalVisible(video) || video.visibility?.showPublishingPacket !== true) {
    return apiError('Publishing packet is not visible in the client portal', 403)
  }
  if (video.channelWorkspaceId !== packet.channelWorkspaceId) {
    return apiError('Publishing packet does not match the video project channel', 400)
  }

  const channelResult = await loadPortalVisibleChannel(packet.channelWorkspaceId, orgId)
  if ('error' in channelResult) return channelResult.error

  const notes = cleanString(body.notes)
  const approval = stripUndefinedDeep({
    status: packetDecisionApprovalStatus(decision),
    message: packetDecisionMessage(decision, notes),
    checkedBy: uid,
    checkedByType: 'user',
    checkedAt: FieldValue.serverTimestamp(),
  })
  const status = packetDecisionStatus(decision)
  const write = stripUndefinedDeep({
    status,
    checks: {
      ...cleanBody(packet.checks),
      approval,
    },
    approvedBy: decision === 'approved' ? uid : undefined,
    approvedAt: decision === 'approved' ? FieldValue.serverTimestamp() : undefined,
    approvedSnapshotHash: decision === 'approved'
      ? packetApprovalSnapshotHash(packet, status, approval)
      : undefined,
    updatedBy: uid,
    updatedByType: 'user',
    updatedAt: FieldValue.serverTimestamp(),
  })

  await packetRef.set(write, { merge: true })

  return apiSuccess({ id: packetId, updated: true })
}

export const PUT = withPortalAuthAndRole('member', async (req: NextRequest, uid, orgId) => {
  const disabled = await youtubeStudioModuleGuard(orgId)
  if (disabled) return disabled

  const body = cleanBody(await req.json().catch(() => ({})))
  const decision = parseDecision(body.decision)
  if (!decision) return apiError('decision must be approved, changes_requested, or rejected', 400)
  if (cleanString(body.packetId)) {
    return handlePortalPacketDecision(body, uid, orgId, decision)
  }

  const id = cleanString(body.id) ?? ''
  if (!id) return apiError('id is required', 400)

  const ref = adminDb.collection(YOUTUBE_COLLECTIONS.videos).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Video project not found', 404)

  const video = serializeYouTubeRecord<YouTubeVideoProject>(doc.id, doc.data()!)
  if (video.deleted === true) return apiError('Video project not found', 404)
  if (video.orgId !== orgId) return apiError('Forbidden', 403)
  if (!isPortalVisible(video)) return apiError('Video project is not visible in the client portal', 403)
  const channelResult = await loadPortalVisibleChannel(video.channelWorkspaceId, orgId)
  if ('error' in channelResult) return channelResult.error
  if (!isClientDecisionOpen(video)) return apiError('Video project is not awaiting client review', 409)

  const write = stripUndefinedDeep({
    status: decisionStatus(decision),
    clientReview: {
      status: decision,
      notes: cleanString(body.notes) ?? '',
      decidedBy: uid,
      decidedAt: FieldValue.serverTimestamp(),
    },
    updatedBy: uid,
    updatedByType: 'user',
    updatedAt: FieldValue.serverTimestamp(),
  })

  await ref.set(write, { merge: true })

  return apiSuccess({ id, updated: true })
})
