// lib/ads/providers/google/video-assets.ts
// Helper to create a YouTube video asset in Google Ads by YouTube video ID.
// Wraps `customers/{cid}/assets:mutate` with type=YOUTUBE_VIDEO.
// Sub-3a-ext YouTube.

import { GOOGLE_ADS_API_BASE_URL } from './constants'

/**
 * Create a YouTube video asset in Google Ads from an existing YouTube video.
 * The video must already be uploaded to YouTube (public or unlisted).
 *
 * Returns the Google Ads asset resourceName and numeric id.
 */
export async function createYoutubeVideoAsset(
  args: {
    customerId: string
    accessToken: string
    developerToken: string
    loginCustomerId?: string
    /** 11-character YouTube video id (e.g. 'dQw4w9WgXcQ'). */
    youtubeVideoId: string
    name?: string
  },
): Promise<{ resourceName: string; id: string }> {
  const url = `${GOOGLE_ADS_API_BASE_URL}/customers/${args.customerId}/assets:mutate`
  const body = {
    operations: [{
      create: {
        type: 'YOUTUBE_VIDEO',
        name: args.name ?? `YouTube video ${args.youtubeVideoId}`,
        youtubeVideoAsset: { youtubeVideoId: args.youtubeVideoId },
      },
    }],
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.accessToken}`,
    'developer-token': args.developerToken,
    'Content-Type': 'application/json',
  }
  if (args.loginCustomerId) headers['login-customer-id'] = args.loginCustomerId
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google YouTube video asset create failed: HTTP ${res.status} — ${text}`)
  }
  const data = await res.json() as { results: Array<{ resourceName: string }> }
  const resourceName = data.results[0]?.resourceName
  if (!resourceName) throw new Error('Asset creation returned no resourceName')
  const id = resourceName.split('/').pop() ?? ''
  return { resourceName, id }
}
