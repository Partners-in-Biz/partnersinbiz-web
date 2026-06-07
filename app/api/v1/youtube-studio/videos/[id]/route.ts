import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  ensureOrgAccess,
  loadScopedRecord,
  mergePatchForSanitizer,
  updateActorFields,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { sanitizeYouTubeVideoProjectInput, serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeVideoProject } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params?: Promise<{ id?: string }> | { id?: string } }

async function routeId(ctx?: RouteContext) {
  const params = await ctx?.params
  return typeof params?.id === 'string' ? params.id.trim() : ''
}

export const GET = withAuth('admin', async (_req, user, ctx?: RouteContext) => {
  const id = await routeId(ctx)
  const loaded = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Video project not found', 404)

  const denied = await ensureOrgAccess(user, String(loaded.data.orgId ?? ''))
  if (denied) return denied

  return apiSuccess({
    video: serializeYouTubeRecord<YouTubeVideoProject>(loaded.id, loaded.data),
  })
})

export const PUT = withAuth('admin', async (req, user, ctx?: RouteContext) => {
  const id = await routeId(ctx)
  const loaded = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Video project not found', 404)

  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const merged = mergePatchForSanitizer(loaded.data, body, {
    orgId,
    deleted: loaded.data.deleted === true,
  })
  const updates = sanitizeYouTubeVideoProjectInput(merged)

  await loaded.ref.set({
    ...updates,
    orgId,
    ...updateActorFields(user),
  }, { merge: true })

  return apiSuccess({ id, updated: true })
})

export const DELETE = withAuth('admin', async (_req, user, ctx?: RouteContext) => {
  const id = await routeId(ctx)
  const loaded = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Video project not found', 404)

  const denied = await ensureOrgAccess(user, String(loaded.data.orgId ?? ''))
  if (denied) return denied

  await loaded.ref.set({
    status: 'archived',
    archived: true,
    deleted: true,
    ...updateActorFields(user),
  }, { merge: true })

  return apiSuccess({ id, deleted: true })
})
