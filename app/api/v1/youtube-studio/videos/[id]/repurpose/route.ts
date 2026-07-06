/**
 * POST /api/v1/youtube-studio/videos/[id]/repurpose
 *
 * "Repurpose to social": create draft social_posts (one per selected
 * platform) from a LIVE YouTube video project, pre-filled with the video
 * title, a description excerpt (linked publishing packet when present,
 * otherwise the project objective), and the YouTube watch URL. Drafts only -
 * the normal social approval flow applies before anything publishes.
 *
 * Body: { platforms: string[], message?: string }
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiError, apiSuccess } from '@/lib/api/response'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'
import { emptyApprovalState } from '@/lib/social/approval'
import { logAudit } from '@/lib/social/audit'
import { YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'

export const dynamic = 'force-dynamic'

const REPURPOSE_PLATFORMS = [
  'twitter', 'linkedin', 'facebook', 'instagram', 'threads', 'bluesky', 'reddit', 'tiktok', 'pinterest',
] as const
type RepurposePlatform = (typeof REPURPOSE_PLATFORMS)[number]

const EXCERPT_LENGTH = 220

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizePlatform(value: unknown): RepurposePlatform | null {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const mapped = raw === 'x' ? 'twitter' : raw
  return (REPURPOSE_PLATFORMS as readonly string[]).includes(mapped) ? mapped as RepurposePlatform : null
}

export const POST = withAuth('client', withTenant(async (req: NextRequest, user, orgId) => {
  // Path: /api/v1/youtube-studio/videos/{id}/repurpose - same pathname
  // parsing technique as the social OAuth routes.
  const videoId = new URL(req.url).pathname.split('/').slice(-2)[0]?.trim() ?? ''
  if (!videoId) return apiError('Video project id is required', 400)

  const body = await req.json().catch(() => ({}))
  const rawPlatforms: unknown[] = Array.isArray(body.platforms) ? body.platforms : []
  if (rawPlatforms.length === 0) return apiError('platforms[] is required', 400)
  const platforms: RepurposePlatform[] = []
  for (const raw of rawPlatforms) {
    const platform = normalizePlatform(raw)
    if (!platform) return apiError(`Unsupported platform: ${String(raw)}. Supported: ${REPURPOSE_PLATFORMS.join(', ')}`, 400)
    platforms.push(platform)
  }
  const message = cleanString(body.message)

  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)
  if (user.role !== 'admin' && user.role !== 'ai' && !isPortalModuleEnabled(orgDoc.data()?.settings, 'youtubeStudio')) {
    return apiError('YouTube Studio module is disabled for this client portal', 403, {
      moduleDisabled: true,
      module: 'youtubeStudio',
    })
  }

  const videoDoc = await adminDb.collection(YOUTUBE_COLLECTIONS.videos).doc(videoId).get()
  const video = videoDoc.data()
  if (!videoDoc.exists || video?.deleted === true || video?.orgId !== orgId) {
    return apiError('Video project not found', 404)
  }
  if (video.status !== 'live') return apiError('Only live videos can be repurposed to social', 409)
  const youtubeVideoId = cleanString(video.youtubeVideoId)
  if (!youtubeVideoId) return apiError('This video has no linked YouTube video id yet', 409)

  const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`
  const title = cleanString(video.title) ?? 'New video'

  let excerpt = cleanString(video.objective) ?? ''
  const publishPacketId = cleanString(video.publishPacketId)
  if (publishPacketId) {
    const packetDoc = await adminDb.collection(YOUTUBE_COLLECTIONS.packets).doc(publishPacketId).get()
    const packet = packetDoc.data()
    if (packetDoc.exists && packet?.deleted !== true && packet?.orgId === orgId) {
      excerpt = cleanString(packet.description) ?? excerpt
    }
  }
  if (excerpt.length > EXCERPT_LENGTH) {
    excerpt = `${excerpt.slice(0, EXCERPT_LENGTH).trimEnd()}...`
  }

  const text = [message ?? `New video: ${title}`, excerpt, youtubeUrl].filter(Boolean).join('\n\n')

  const postIds: string[] = []
  for (const platform of platforms) {
    const docRef = await adminDb.collection('social_posts').add({
      // Mirrors the doc shape of app/api/v1/social/posts/route.ts POST.
      platform: platform === 'twitter' ? 'x' : platform,
      orgId,
      content: { text, platformOverrides: {} },
      media: [],
      platforms: [platform],
      accountIds: [],
      status: 'draft',
      scheduledAt: null,
      scheduledFor: null,
      publishedAt: null,
      platformResults: {},
      hashtags: [],
      labels: ['youtube-repurpose'],
      campaign: null,
      campaignId: null,
      pillarId: null,
      audience: null,
      createdBy: user.uid,
      assignedTo: null,
      approval: emptyApprovalState(),
      approvedBy: null,
      approvedAt: null,
      comments: [],
      source: 'youtube_studio_repurpose',
      threadParts: [],
      firstComment: null,
      firstCommentStatus: null,
      linkedinShareType: null,
      category: 'other',
      tags: ['youtube'],
      youtubeVideoProjectId: videoId,
      externalId: null,
      error: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    postIds.push(docRef.id)
  }

  await adminDb.collection(YOUTUBE_COLLECTIONS.videos).doc(videoId).update({
    'linked.socialPostIds': FieldValue.arrayUnion(...postIds),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
    updatedByType: user.role === 'ai' ? 'agent' : 'user',
  })

  logAudit({
    orgId,
    action: 'post.created',
    entityType: 'post',
    entityId: postIds[0],
    performedBy: user.uid,
    performedByRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    details: { source: 'youtube_studio_repurpose', videoProjectId: videoId, platforms, count: postIds.length },
  })

  return apiSuccess({ postIds }, 201)
}))
