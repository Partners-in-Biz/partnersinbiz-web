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
import { sanitizeYouTubeRenderJobInput, serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type {
  YouTubeClipCandidate,
  YouTubeProductionDraft,
  YouTubeRenderJob,
  YouTubeSourceAsset,
} from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function uniqueIds(...groups: Array<Array<string | undefined>>): string[] {
  return Array.from(new Set(groups.flat().filter((id): id is string => Boolean(id))))
}

async function validateSourceAssets(
  sourceAssetIds: string[],
  orgId: string,
  channelWorkspaceId: string,
  videoProjectId: string,
) {
  for (const sourceAssetId of sourceAssetIds) {
    const sourceRecord = await loadScopedRecord(YOUTUBE_COLLECTIONS.sourceAssets, sourceAssetId)
    if (!sourceRecord || sourceRecord.data.deleted === true) return apiError('sourceAssetIds includes an unknown source asset', 404)
    const sourceAsset = serializeYouTubeRecord<YouTubeSourceAsset>(sourceRecord.id, sourceRecord.data)
    if (sourceAsset.orgId !== orgId) return apiError('sourceAssetIds includes an asset from another organisation', 400)
    if (sourceAsset.channelWorkspaceId !== channelWorkspaceId) {
      return apiError('sourceAssetIds includes an asset from another channel workspace', 400)
    }
    if (sourceAsset.videoProjectId && sourceAsset.videoProjectId !== videoProjectId) {
      return apiError('sourceAssetIds includes an asset from another video project', 400)
    }
  }

  return null
}

async function validateClipCandidates(
  clipCandidateIds: string[],
  orgId: string,
  channelWorkspaceId: string,
  videoProjectId: string,
) {
  for (const clipCandidateId of clipCandidateIds) {
    const clipRecord = await loadScopedRecord(YOUTUBE_COLLECTIONS.clipCandidates, clipCandidateId)
    if (!clipRecord || clipRecord.data.deleted === true) return apiError('clipCandidateIds includes an unknown clip candidate', 404)
    const clip = serializeYouTubeRecord<YouTubeClipCandidate>(clipRecord.id, clipRecord.data)
    if (clip.orgId !== orgId) return apiError('clipCandidateIds includes a clip from another organisation', 400)
    if (clip.channelWorkspaceId !== channelWorkspaceId) {
      return apiError('clipCandidateIds includes a clip from another channel workspace', 400)
    }
    if (clip.videoProjectId && clip.videoProjectId !== videoProjectId) {
      return apiError('clipCandidateIds includes a clip from another video project', 400)
    }
  }

  return null
}

async function validateProductionDraft(
  productionDraftId: string | undefined,
  orgId: string,
  channelWorkspaceId: string,
  videoProjectId: string,
) {
  if (!productionDraftId) return null

  const draftRecord = await loadScopedRecord(YOUTUBE_COLLECTIONS.productionDrafts, productionDraftId)
  if (!draftRecord || draftRecord.data.deleted === true) return apiError('Production draft not found', 404)
  const draft = serializeYouTubeRecord<YouTubeProductionDraft>(draftRecord.id, draftRecord.data)
  if (draft.orgId !== orgId) return apiError('productionDraftId does not belong to organisation', 400)
  if (draft.channelWorkspaceId !== channelWorkspaceId) {
    return apiError('productionDraftId does not belong to channel workspace', 400)
  }
  if (draft.videoProjectId !== videoProjectId) return apiError('productionDraftId does not belong to video project', 400)
  if (draft.status !== 'approved') return apiError('Production draft must be approved before creating a render job', 409)

  return null
}

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const channelWorkspaceId = url.searchParams.get('channelWorkspaceId')?.trim() ?? ''
  const videoProjectId = url.searchParams.get('videoProjectId')?.trim() ?? ''
  const status = url.searchParams.get('status')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const docs = await listByOrg(YOUTUBE_COLLECTIONS.renderJobs, orgId)
  const renderJobs = docs
    .map((doc) => serializeYouTubeRecord<YouTubeRenderJob>(doc.id, doc.data()))
    .filter((job) => !channelWorkspaceId || job.channelWorkspaceId === channelWorkspaceId)
    .filter((job) => !videoProjectId || job.videoProjectId === videoProjectId)
    .filter((job) => !status || job.status === status)
    .sort((a, b) => a.title.localeCompare(b.title) || b.versionNumber - a.versionNumber)

  return apiSuccess({ renderJobs })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const data = sanitizeYouTubeRenderJobInput({ ...body, orgId })
  if (!data.channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (!data.videoProjectId) return apiError('videoProjectId is required', 400)
  if (!data.title) return apiError('title is required', 400)

  const channel = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, data.channelWorkspaceId)
  if (!channel || channel.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  if (channel.data.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)

  const video = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, data.videoProjectId)
  if (!video || video.data.deleted === true) return apiError('Video project not found', 404)
  if (video.data.orgId !== orgId) return apiError('videoProjectId does not belong to organisation', 400)
  if (video.data.channelWorkspaceId !== data.channelWorkspaceId) {
    return apiError('videoProjectId does not belong to channel workspace', 400)
  }

  const draftError = await validateProductionDraft(
    data.productionDraftId,
    orgId,
    data.channelWorkspaceId,
    data.videoProjectId,
  )
  if (draftError) return draftError

  const timelineSourceAssetIds = data.timeline.map((scene) => scene.sourceAssetId)
  const sourceError = await validateSourceAssets(
    uniqueIds(data.sourceAssetIds, timelineSourceAssetIds),
    orgId,
    data.channelWorkspaceId,
    data.videoProjectId,
  )
  if (sourceError) return sourceError

  const timelineClipCandidateIds = data.timeline.map((scene) => scene.clipCandidateId)
  const clipError = await validateClipCandidates(
    uniqueIds(data.clipCandidateIds, timelineClipCandidateIds),
    orgId,
    data.channelWorkspaceId,
    data.videoProjectId,
  )
  if (clipError) return clipError

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.renderJobs).add({
    ...data,
    status: 'planning',
    versionNumber: data.versionNumber || 1,
    deleted: false,
    ...actorFields(user),
  })

  return apiSuccess({ id: ref.id }, 201)
})
