import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess } from '@/lib/api/response'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'
import { stripUndefinedDeep, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import {
  clientSafeYouTubeChannelWorkspace,
  clientSafeYouTubePublishingPacket,
  clientSafeYouTubeVideoProject,
  sanitizeYouTubeVideoProjectInput,
  serializeYouTubeRecord,
} from '@/lib/youtube-studio/sanitize'
import type {
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

function decisionStatus(decision: ClientDecision): YouTubeVideoStatus {
  if (decision === 'approved') return 'internal_review'
  if (decision === 'changes_requested') return 'changes_requested'
  return 'blocked'
}

function parseDecision(value: unknown): ClientDecision | null {
  if (value === 'approved' || value === 'changes_requested' || value === 'rejected') return value
  return null
}

function isClientDecisionOpen(video: YouTubeVideoProject): boolean {
  return (
    video.status === 'client_review' ||
    video.status === 'changes_requested' ||
    video.clientReview?.status === 'requested'
  )
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

  const [channelsRaw, seriesRaw, videosRaw, packetsRaw] = await Promise.all([
    listOrg<YouTubeChannelWorkspace>(YOUTUBE_COLLECTIONS.channels, orgId),
    listOrg<YouTubeSeries>(YOUTUBE_COLLECTIONS.series, orgId),
    listOrg<YouTubeVideoProject>(YOUTUBE_COLLECTIONS.videos, orgId),
    listOrg<YouTubePublishingPacket>(YOUTUBE_COLLECTIONS.packets, orgId),
  ])

  const visibleChannelIds = new Set(
    channelsRaw
      .filter(isPortalVisible)
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

  return apiSuccess({ channels, series, videos, packets })
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

export const PUT = withPortalAuthAndRole('member', async (req: NextRequest, uid, orgId) => {
  const disabled = await youtubeStudioModuleGuard(orgId)
  if (disabled) return disabled

  const body = cleanBody(await req.json().catch(() => ({})))
  const id = cleanString(body.id) ?? ''
  if (!id) return apiError('id is required', 400)

  const decision = parseDecision(body.decision)
  if (!decision) return apiError('decision must be approved, changes_requested, or rejected', 400)

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
