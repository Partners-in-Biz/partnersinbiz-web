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
import { sanitizeYouTubeChannelWorkspaceInput, serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeChannelWorkspace } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const docs = await listByOrg(YOUTUBE_COLLECTIONS.channels, orgId)
  const channels = docs
    .map((doc) => serializeYouTubeRecord<YouTubeChannelWorkspace>(doc.id, doc.data()))
    .sort((a, b) => a.title.localeCompare(b.title))

  return apiSuccess({ channels })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const data = sanitizeYouTubeChannelWorkspaceInput({ ...body, orgId })
  if (!data.title || data.title === 'Untitled YouTube channel') return apiError('title is required', 400)

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.channels).add({
    ...data,
    ...actorFields(user),
  })

  return apiSuccess({ id: ref.id }, 201)
})
