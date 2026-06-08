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
import { sanitizeYouTubeSourceAssetInput, serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeSourceAsset } from '@/lib/youtube-studio/types'

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
  const seriesId = url.searchParams.get('seriesId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const docs = await listByOrg(YOUTUBE_COLLECTIONS.sourceAssets, orgId)
  const sourceAssets = docs
    .map((doc) => serializeYouTubeRecord<YouTubeSourceAsset>(doc.id, doc.data()))
    .filter((asset) => !channelWorkspaceId || asset.channelWorkspaceId === channelWorkspaceId)
    .filter((asset) => !videoProjectId || asset.videoProjectId === videoProjectId)
    .filter((asset) => !seriesId || asset.seriesId === seriesId)
    .sort((a, b) => a.title.localeCompare(b.title))

  return apiSuccess({ sourceAssets })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const data = sanitizeYouTubeSourceAssetInput({ ...body, orgId })
  if (!data.channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (!data.title) return apiError('title is required', 400)

  const channel = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, data.channelWorkspaceId)
  if (!channel || channel.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  if (channel.data.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)

  if (data.videoProjectId) {
    const video = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, data.videoProjectId)
    if (!video || video.data.deleted === true) return apiError('Video project not found', 404)
    if (video.data.orgId !== orgId) return apiError('videoProjectId does not belong to organisation', 400)
    if (video.data.channelWorkspaceId !== data.channelWorkspaceId) {
      return apiError('videoProjectId does not belong to channel workspace', 400)
    }
    if (typeof video.data.seriesId === 'string' && video.data.seriesId.trim() && !data.seriesId) {
      data.seriesId = video.data.seriesId.trim()
    }
  }

  if (data.seriesId) {
    const series = await loadScopedRecord(YOUTUBE_COLLECTIONS.series, data.seriesId)
    if (!series || series.data.deleted === true) return apiError('YouTube series not found', 404)
    if (series.data.orgId !== orgId) return apiError('seriesId does not belong to organisation', 400)
    if (series.data.channelWorkspaceId !== data.channelWorkspaceId) {
      return apiError('seriesId does not belong to channel workspace', 400)
    }
  }

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.sourceAssets).add({
    ...data,
    deleted: false,
    ...actorFields(user),
  })

  return apiSuccess({ id: ref.id }, 201)
})
