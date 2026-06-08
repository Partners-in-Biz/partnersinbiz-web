import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  actorFields,
  ensureOrgAccess,
  listByOrg,
  loadScopedRecord,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { sanitizeYouTubeClipCandidateInput, serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeClipCandidate, YouTubeSourceAsset } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const channelWorkspaceId = url.searchParams.get('channelWorkspaceId')?.trim() ?? ''
  const videoProjectId = url.searchParams.get('videoProjectId')?.trim() ?? ''
  const sourceAssetId = url.searchParams.get('sourceAssetId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const docs = await listByOrg(YOUTUBE_COLLECTIONS.clipCandidates, orgId)
  const clipCandidates = docs
    .map((doc) => serializeYouTubeRecord<YouTubeClipCandidate>(doc.id, doc.data()))
    .filter((clip) => !channelWorkspaceId || clip.channelWorkspaceId === channelWorkspaceId)
    .filter((clip) => !videoProjectId || clip.videoProjectId === videoProjectId)
    .filter((clip) => !sourceAssetId || clip.sourceAssetId === sourceAssetId)
    .sort((a, b) => a.startSeconds - b.startSeconds || a.title.localeCompare(b.title))

  return apiSuccess({ clipCandidates })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const data = sanitizeYouTubeClipCandidateInput({ ...body, orgId })
  if (!data.sourceAssetId) return apiError('sourceAssetId is required', 400)
  if (!data.title) return apiError('title is required', 400)
  if (data.endSeconds <= data.startSeconds) return apiError('endSeconds must be after startSeconds', 400)

  const sourceRecord = await loadScopedRecord(YOUTUBE_COLLECTIONS.sourceAssets, data.sourceAssetId)
  if (!sourceRecord || sourceRecord.data.deleted === true) return apiError('Source asset not found', 404)
  const sourceAsset = serializeYouTubeRecord<YouTubeSourceAsset>(sourceRecord.id, sourceRecord.data)
  if (sourceAsset.orgId !== orgId) return apiError('sourceAssetId does not belong to organisation', 400)
  if (!sourceAsset.channelWorkspaceId) return apiError('sourceAssetId is missing channel workspace context', 400)

  data.channelWorkspaceId = sourceAsset.channelWorkspaceId
  if (!data.videoProjectId && sourceAsset.videoProjectId) data.videoProjectId = sourceAsset.videoProjectId
  if (sourceAsset.videoProjectId && data.videoProjectId && sourceAsset.videoProjectId !== data.videoProjectId) {
    return apiError('videoProjectId does not match source asset', 400)
  }
  if (typeof sourceAsset.durationSeconds === 'number' && data.endSeconds > sourceAsset.durationSeconds) {
    return apiError('Clip range cannot exceed source asset duration', 400)
  }

  if (data.videoProjectId) {
    const video = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, data.videoProjectId)
    if (!video || video.data.deleted === true) return apiError('Video project not found', 404)
    if (video.data.orgId !== orgId) return apiError('videoProjectId does not belong to organisation', 400)
    if (video.data.channelWorkspaceId !== data.channelWorkspaceId) {
      return apiError('videoProjectId does not belong to source asset channel workspace', 400)
    }
  }

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.clipCandidates).add({
    ...data,
    status: 'suggested',
    deleted: false,
    ...actorFields(user),
  })

  return apiSuccess({ id: ref.id }, 201)
})
