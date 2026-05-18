// POST /api/v1/ads/tiktok/creatives/upload
// Multipart upload — client sends `file` (image or video) + `kind` ('image'|'video').
// Server resolves the org's TikTok connection + advertiserId + uploads to TikTok.
// Returns the TikTok asset id (image_id or video_id) usable in /ad/create/.

import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const form = await req.formData()
  const file = form.get('file') as File | null
  const kind = String(form.get('kind') ?? 'image')
  const imageUrl = form.get('image_url') as string | null
  const videoUrl = form.get('video_url') as string | null

  if (kind !== 'image' && kind !== 'video') {
    return apiError(`Invalid kind: ${kind} — must be image or video`, 400)
  }

  if (!file && !imageUrl && !videoUrl) {
    return apiError('Must provide either file (multipart) or image_url/video_url', 400)
  }

  const conn = await getConnection({ orgId, platform: 'tiktok' })
  if (!conn) return apiError('No TikTok ads connection for org', 400)
  const accessToken = decryptAccessToken(conn)
  const tiktokMeta = ((conn.meta ?? {}) as Record<string, unknown>).tiktok as
    | Record<string, unknown>
    | undefined
  const advertiserId =
    typeof tiktokMeta?.selectedAdvertiserId === 'string'
      ? tiktokMeta.selectedAdvertiserId
      : undefined
  if (!advertiserId) return apiError('No advertiserId set on TikTok connection', 400)

  try {
    if (kind === 'image') {
      const { uploadImageBytes, uploadImageByUrl } = await import(
        '@/lib/ads/providers/tiktok/creative-sync'
      )
      if (file) {
        const buf = Buffer.from(await file.arrayBuffer())
        const result = await uploadImageBytes({
          advertiserId,
          accessToken,
          bytes: buf,
          fileName: file.name,
        })
        return apiSuccess(result, 201)
      }
      const result = await uploadImageByUrl({
        advertiserId,
        accessToken,
        imageUrl: imageUrl!,
      })
      return apiSuccess(result, 201)
    }

    const { uploadVideoBytes, uploadVideoByUrl } = await import(
      '@/lib/ads/providers/tiktok/creative-sync'
    )
    if (file) {
      const buf = Buffer.from(await file.arrayBuffer())
      const result = await uploadVideoBytes({
        advertiserId,
        accessToken,
        bytes: buf,
        fileName: file.name,
      })
      return apiSuccess(result, 201)
    }
    const result = await uploadVideoByUrl({
      advertiserId,
      accessToken,
      videoUrl: videoUrl!,
    })
    return apiSuccess(result, 201)
  } catch (err) {
    return apiError((err as Error).message ?? 'Upload failed', 500)
  }
})
