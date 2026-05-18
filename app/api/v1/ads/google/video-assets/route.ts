// app/api/v1/ads/google/video-assets/route.ts
// POST /api/v1/ads/google/video-assets
//
// Creates a YouTube video asset in Google Ads from an already-uploaded YouTube video ID.
// The video must be public or unlisted on YouTube.
//
// Request body: { youtubeVideoId: string; name?: string }
// Response: { resourceName: string; id: string }
//
// Sub-3a-ext YouTube.

import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { readDeveloperToken } from '@/lib/integrations/google_ads/oauth'
import { createYoutubeVideoAsset } from '@/lib/ads/providers/google/video-assets'

export const POST = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const body = (await req.json()) as { youtubeVideoId?: string; name?: string }

  if (!body.youtubeVideoId || typeof body.youtubeVideoId !== 'string') {
    return apiError('Missing required field: youtubeVideoId', 400)
  }

  const conn = await getConnection({ orgId, platform: 'google' })
  if (!conn) return apiError('No Google Ads connection for org', 400)

  const accessToken = decryptAccessToken(conn)
  const developerToken = readDeveloperToken()
  if (!developerToken) return apiError('Google Ads developer token not configured', 500)

  const googleMeta = ((conn.meta ?? {}) as Record<string, unknown>).google as Record<string, unknown> | undefined
  const loginCustomerId = typeof googleMeta?.loginCustomerId === 'string' ? googleMeta.loginCustomerId : undefined
  if (!loginCustomerId) return apiError('No Customer ID set on Google connection', 400)

  const result = await createYoutubeVideoAsset({
    customerId: loginCustomerId,
    accessToken,
    developerToken,
    loginCustomerId,
    youtubeVideoId: body.youtubeVideoId,
    name: body.name,
  })

  return apiSuccess(result, 201)
})
