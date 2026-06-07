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
import { sanitizeYouTubeVideoProjectInput, serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeVideoProject } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const docs = await listByOrg(YOUTUBE_COLLECTIONS.videos, orgId)
  const videos = docs
    .map((doc) => serializeYouTubeRecord<YouTubeVideoProject>(doc.id, doc.data()))
    .sort((a, b) => a.title.localeCompare(b.title))

  return apiSuccess({ videos })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const data = sanitizeYouTubeVideoProjectInput({ ...body, orgId })
  if (!data.channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (!data.title || data.title === 'Untitled video') return apiError('title is required', 400)

  const channel = await adminDb.collection(YOUTUBE_COLLECTIONS.channels).doc(data.channelWorkspaceId).get()
  if (!channel.exists || channel.data()?.deleted === true) return apiError('YouTube channel workspace not found', 404)
  if (channel.data()?.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)

  if (data.seriesId) {
    const series = await loadScopedRecord(YOUTUBE_COLLECTIONS.series, data.seriesId)
    if (!series || series.data.deleted === true) return apiError('YouTube series not found', 404)
    if (series.data.orgId !== orgId) return apiError('seriesId does not belong to organisation', 400)
    if (series.data.channelWorkspaceId !== data.channelWorkspaceId) {
      return apiError('seriesId does not belong to channel workspace', 400)
    }
  }

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.videos).add({
    ...data,
    ...actorFields(user),
  })

  return apiSuccess({ id: ref.id }, 201)
})
