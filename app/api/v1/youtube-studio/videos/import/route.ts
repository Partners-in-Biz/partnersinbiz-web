/**
 * POST /api/v1/youtube-studio/videos/import
 *
 * "Send to YouTube Studio": create a video project (+ rendered_video source
 * asset) from campaign or social-post video media. Campaign video
 * deliverables ARE social_posts with media[0].type === 'video'
 * (lib/campaigns/assets.ts), so both origin types carry a provenance
 * back-link into the project's `linked` map.
 *
 * Body: {
 *   channelWorkspaceId: string
 *   title: string
 *   sourceUrl?: string          // public media URL
 *   fileId?: string             // platform file-library id (alternative to sourceUrl)
 *   mediaFormat?: 'horizontal' | 'vertical' | 'square'
 *   origin: { type: 'campaign' | 'social_post', id: string }
 * }
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiError, apiSuccess } from '@/lib/api/response'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'
import { actorFields, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import {
  sanitizeYouTubeSourceAssetInput,
  sanitizeYouTubeVideoProjectInput,
} from '@/lib/youtube-studio/sanitize'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

const MEDIA_FORMATS = ['horizontal', 'vertical', 'square'] as const
type ImportMediaFormat = (typeof MEDIA_FORMATS)[number]

export const POST = withAuth('client', withTenant(async (req: NextRequest, user, orgId) => {
  const body = cleanObject(await req.json().catch(() => ({})))

  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)
  if (user.role !== 'admin' && user.role !== 'ai' && !isPortalModuleEnabled(orgDoc.data()?.settings, 'youtubeStudio')) {
    return apiError('YouTube Studio module is disabled for this client portal', 403, {
      moduleDisabled: true,
      module: 'youtubeStudio',
    })
  }

  const channelWorkspaceId = cleanString(body.channelWorkspaceId)
  const title = cleanString(body.title)
  const sourceUrl = cleanString(body.sourceUrl)
  const fileId = cleanString(body.fileId)
  const origin = cleanObject(body.origin)
  const originType = origin.type === 'campaign' || origin.type === 'social_post' ? origin.type : null
  const originId = cleanString(origin.id)
  const mediaFormat: ImportMediaFormat = (MEDIA_FORMATS as readonly string[]).includes(String(body.mediaFormat))
    ? body.mediaFormat as ImportMediaFormat
    : 'horizontal'

  if (!channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (!title) return apiError('title is required', 400)
  if (!sourceUrl && !fileId) return apiError('sourceUrl or fileId is required', 400)
  if (!originType || !originId) return apiError('origin { type: campaign | social_post, id } is required', 400)

  const channelDoc = await adminDb.collection(YOUTUBE_COLLECTIONS.channels).doc(channelWorkspaceId).get()
  if (!channelDoc.exists || channelDoc.data()?.deleted === true) {
    return apiError('YouTube channel workspace not found', 404)
  }
  if (channelDoc.data()?.orgId !== orgId) {
    return apiError('channelWorkspaceId does not belong to organisation', 400)
  }

  const videoData = sanitizeYouTubeVideoProjectInput({
    orgId,
    channelWorkspaceId,
    title,
    videoType: mediaFormat === 'vertical' ? 'short' : 'long_form',
    status: 'intake',
    objective: `Imported from ${originType === 'campaign' ? 'campaign' : 'social post'} ${originId}`,
    source: {
      intakeType: sourceUrl ? 'source_url' : 'raw_footage',
      sourceUrl,
      ...(originType === 'campaign' ? { campaignId: originId } : {}),
    },
    linked: originType === 'campaign'
      ? { campaignId: originId }
      : { socialPostIds: [originId] },
  })

  const videoRef = await adminDb.collection(YOUTUBE_COLLECTIONS.videos).add({
    ...videoData,
    deleted: false,
    ...actorFields(user),
  })

  const assetData = sanitizeYouTubeSourceAssetInput({
    orgId,
    channelWorkspaceId,
    videoProjectId: videoRef.id,
    title: `${title} — imported media`,
    description: `Imported from ${originType} ${originId}`,
    assetType: 'rendered_video',
    status: 'ready',
    mediaFormat,
    sourceUrl,
    ...(fileId ? { storage: { provider: 'firebase_storage', artifactId: fileId } } : {}),
  })

  const assetRef = await adminDb.collection(YOUTUBE_COLLECTIONS.sourceAssets).add({
    ...assetData,
    deleted: false,
    ...actorFields(user),
  })

  return apiSuccess({ videoProjectId: videoRef.id, sourceAssetId: assetRef.id }, 201)
}))
