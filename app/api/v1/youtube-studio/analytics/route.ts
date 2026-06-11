import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
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
import { sanitizeYouTubeAnalyticsSnapshotInput, serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeAnalyticsSnapshot } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const channelWorkspaceId = url.searchParams.get('channelWorkspaceId')?.trim() ?? ''
  const videoProjectId = url.searchParams.get('videoProjectId')?.trim() ?? ''
  const seriesId = url.searchParams.get('seriesId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const docs = await listByOrg(YOUTUBE_COLLECTIONS.analytics, orgId)
  const snapshots = docs
    .map((doc) => serializeYouTubeRecord<YouTubeAnalyticsSnapshot>(doc.id, doc.data()))
    .filter((snapshot) => !channelWorkspaceId || snapshot.channelWorkspaceId === channelWorkspaceId)
    .filter((snapshot) => !videoProjectId || snapshot.videoProjectId === videoProjectId)
    .filter((snapshot) => !seriesId || snapshot.seriesId === seriesId)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))

  return apiSuccess({ snapshots })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const data = sanitizeYouTubeAnalyticsSnapshotInput({ ...body, orgId })
  if (!data.channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (!data.periodStart || !isIsoDate(data.periodStart)) return apiError('periodStart must be YYYY-MM-DD', 400)
  if (!data.periodEnd || !isIsoDate(data.periodEnd)) return apiError('periodEnd must be YYYY-MM-DD', 400)
  if (data.periodStart > data.periodEnd) return apiError('periodStart cannot be after periodEnd', 400)

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
    if (video.data.seriesId && data.seriesId && video.data.seriesId !== data.seriesId) {
      return apiError('seriesId does not match video project', 400)
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

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.analytics).add({
    ...data,
    deleted: false,
    importedAt: FieldValue.serverTimestamp(),
    importedBy: user.uid,
    importedByType: user.role === 'ai' ? 'agent' : 'user',
    ...actorFields(user),
  })

  return apiSuccess({ id: ref.id }, 201)
})
