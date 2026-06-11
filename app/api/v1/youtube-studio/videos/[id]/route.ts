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

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key)
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

  const rawBody = await req.json().catch(() => ({}))
  const body = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
    ? rawBody as Record<string, unknown>
    : {}
  const currentChannelWorkspaceId = cleanString(loaded.data.channelWorkspaceId) ?? ''
  const currentSeriesId = cleanString(loaded.data.seriesId)
  const hasChannelWorkspacePatch = hasOwn(body, 'channelWorkspaceId')
  const hasSeriesPatch = hasOwn(body, 'seriesId')
  const nextChannelWorkspaceId = hasChannelWorkspacePatch
    ? cleanString(body.channelWorkspaceId)
    : currentChannelWorkspaceId
  const nextSeriesId = hasSeriesPatch ? cleanString(body.seriesId) : currentSeriesId

  if (hasChannelWorkspacePatch && !nextChannelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (hasSeriesPatch && !nextSeriesId) return apiError('seriesId cannot be empty', 400)

  const channelChanged = nextChannelWorkspaceId !== currentChannelWorkspaceId
  const seriesChanged = (nextSeriesId ?? '') !== (currentSeriesId ?? '')

  if (channelChanged) {
    const channel = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, nextChannelWorkspaceId ?? '')
    if (!channel || channel.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
    if (channel.data.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)
  }

  if ((channelChanged || seriesChanged) && nextSeriesId) {
    const series = await loadScopedRecord(YOUTUBE_COLLECTIONS.series, nextSeriesId)
    if (!series || series.data.deleted === true) return apiError('YouTube series not found', 404)
    if (series.data.orgId !== orgId) return apiError('seriesId does not belong to organisation', 400)
    if (series.data.channelWorkspaceId !== nextChannelWorkspaceId) {
      return apiError('seriesId does not belong to channel workspace', 400)
    }
  }

  const merged = mergePatchForSanitizer(loaded.data, body, {
    orgId,
    channelWorkspaceId: nextChannelWorkspaceId,
    seriesId: nextSeriesId,
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
