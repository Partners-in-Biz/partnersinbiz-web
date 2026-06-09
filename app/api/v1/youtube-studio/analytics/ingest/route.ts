import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, listByOrg, loadScopedRecord, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { sanitizeYouTubeAnalyticsSnapshotInput } from '@/lib/youtube-studio/sanitize'
import { fetchYouTubeAnalyticsApiSnapshot } from '@/lib/youtube-studio/analytics-ingestion'
import { decryptTokenBlock } from '@/lib/social/encryption'
import type { YouTubeVideoProject } from '@/lib/youtube-studio/types'

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
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

async function loadConnectedYouTubeTokens(orgId: string, accountId?: string) {
  if (!accountId) return null
  const accountDoc = await adminDb.collection('social_accounts').doc(accountId).get()
  if (!accountDoc.exists) return null
  const account = accountDoc.data() ?? {}
  if (account.orgId !== orgId || account.platform !== 'youtube' || account.status !== 'active') return null
  const encryptedTokens = cleanObject(account.encryptedTokens)
  const accessToken = cleanString(encryptedTokens.accessToken)
  const iv = cleanString(encryptedTokens.iv)
  const tag = cleanString(encryptedTokens.tag)
  if (!accessToken || !iv || !tag) return null
  return decryptTokenBlock({ accessToken, iv, tag }, orgId)
}

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const channelWorkspaceId = cleanString(body.channelWorkspaceId) ?? ''
  const videoProjectId = cleanString(body.videoProjectId)
  const periodStart = cleanString(body.periodStart) ?? ''
  const periodEnd = cleanString(body.periodEnd) ?? ''
  const showInClientPortal = body.showInClientPortal === true
  if (!channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (!periodStart || !isIsoDate(periodStart)) return apiError('periodStart must be YYYY-MM-DD', 400)
  if (!periodEnd || !isIsoDate(periodEnd)) return apiError('periodEnd must be YYYY-MM-DD', 400)
  if (periodStart > periodEnd) return apiError('periodStart cannot be after periodEnd', 400)

  const channel = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, channelWorkspaceId)
  if (!channel || channel.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  if (channel.data.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)

  let selectedVideo: (YouTubeVideoProject & { id: string }) | undefined
  if (videoProjectId) {
    const video = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, videoProjectId)
    if (!video || video.data.deleted === true) return apiError('Video project not found', 404)
    if (video.data.orgId !== orgId) return apiError('videoProjectId does not belong to organisation', 400)
    if (video.data.channelWorkspaceId !== channelWorkspaceId) return apiError('videoProjectId does not belong to channel workspace', 400)
    selectedVideo = { id: video.id, ...(video.data as unknown as YouTubeVideoProject) }
  }

  const tokens = await loadConnectedYouTubeTokens(orgId, cleanString(channel.data.connectedAccountId))
  if (!tokens) return apiError('Connected active YouTube account with encrypted OAuth tokens is required', 400)

  const videos = (await listByOrg(YOUTUBE_COLLECTIONS.videos, orgId))
    .map((doc) => ({ id: doc.id, ...(doc.data() as unknown as YouTubeVideoProject) }))
    .filter((video) => video.channelWorkspaceId === channelWorkspaceId && video.deleted !== true && typeof video.youtubeVideoId === 'string' && video.youtubeVideoId.trim())

  try {
    const imported = await fetchYouTubeAnalyticsApiSnapshot({
      orgId,
      channelWorkspaceId,
      youtubeChannelId: cleanString(channel.data.youtubeChannelId),
      videoProjectId,
      youtubeVideoId: cleanString(body.youtubeVideoId) ?? cleanString(selectedVideo?.youtubeVideoId),
      seriesId: cleanString(selectedVideo?.seriesId) ?? cleanString(body.seriesId),
      periodStart,
      periodEnd,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      videos: selectedVideo ? [selectedVideo] : videos,
    })
    const data = sanitizeYouTubeAnalyticsSnapshotInput({
      ...imported,
      visibility: { showInClientPortal },
    })

    const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.analytics).add({
      ...data,
      deleted: false,
      importedAt: FieldValue.serverTimestamp(),
      importedBy: user.uid,
      importedByType: user.role === 'ai' ? 'agent' : 'user',
      ...actorFields(user),
    })

    return apiSuccess({
      id: ref.id,
      source: data.source,
      sourceFreshness: data.sourceFreshness,
      metrics: data.metrics,
      recommendations: data.recommendations.map((recommendation) => ({
        type: recommendation.type,
        summary: recommendation.summary,
        confidence: recommendation.confidence,
        status: recommendation.status,
        actionType: recommendation.actionType,
      })),
    }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'YouTube Analytics API ingestion failed'
    return apiError(message.replace(/(access_token|refresh_token|client_secret)=[^\s&]+/gi, '$1=[REDACTED]'), 502)
  }
})
