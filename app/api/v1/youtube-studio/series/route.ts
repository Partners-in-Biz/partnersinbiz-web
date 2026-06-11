import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  actorFields,
  ensureOrgAccess,
  listByOrg,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { sanitizeYouTubeSeriesInput, serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeSeries } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const docs = await listByOrg(YOUTUBE_COLLECTIONS.series, orgId)
  const series = docs
    .map((doc) => serializeYouTubeRecord<YouTubeSeries>(doc.id, doc.data()))
    .sort((a, b) => a.name.localeCompare(b.name))

  return apiSuccess({ series })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const data = sanitizeYouTubeSeriesInput({ ...body, orgId })
  if (!data.channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (!data.name || data.name === 'Untitled series') return apiError('name is required', 400)

  const channel = await adminDb.collection(YOUTUBE_COLLECTIONS.channels).doc(data.channelWorkspaceId).get()
  if (!channel.exists || channel.data()?.deleted === true) return apiError('YouTube channel workspace not found', 404)
  if (channel.data()?.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.series).add({
    ...data,
    deleted: false,
    ...actorFields(user),
  })

  return apiSuccess({ id: ref.id }, 201)
})
