// lib/ads/providers/google/video-ads.ts
// Responsive Video Ad helper — wraps `customers/{cid}/adGroupAds:mutate`.
// Sub-3a-ext YouTube.

import type { Ad } from '@/lib/ads/types'
import { GOOGLE_ADS_API_BASE_URL } from './constants'

/** Assets required to build a Responsive Video Ad (VIDEO_RESPONSIVE_AD). */
export interface VideoAdAssets {
  /** Google Ads asset resourceName for the YouTube video (from video-assets.ts). */
  videoAssetResourceName: string
  /** Headlines — max 30 chars each, up to 5. */
  headlines: string[]
  /** Long headlines — max 90 chars each, up to 5. Optional. */
  longHeadlines?: string[]
  /** Descriptions — max 90 chars each, up to 5. */
  descriptions: string[]
  /** Display URL (path-only, e.g. 'example.com/sale'). Optional. */
  displayUrl?: string
  /** Final URL — full landing page URL. */
  finalUrl: string
  /** CTA texts — max 10 chars each, up to 5. Optional. */
  callToActionTexts?: string[]
  /** Companion banner asset resourceName. Optional. */
  companionBannerResourceName?: string
}

interface CallArgs {
  customerId: string
  accessToken: string
  developerToken: string
  loginCustomerId?: string
}

function buildHeaders(args: CallArgs): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${args.accessToken}`,
    'developer-token': args.developerToken,
    'Content-Type': 'application/json',
  }
  if (args.loginCustomerId) h['login-customer-id'] = args.loginCustomerId
  return h
}

/**
 * Create a Responsive Video Ad (VIDEO_RESPONSIVE_AD) inside an existing ad group.
 * Ships in PAUSED status so it doesn't spend immediately.
 */
export async function createResponsiveVideoAd(
  args: CallArgs & {
    adGroupResourceName: string
    canonical: Ad
    videoAssets: VideoAdAssets
  },
): Promise<{ resourceName: string; id: string }> {
  const url = `${GOOGLE_ADS_API_BASE_URL}/customers/${args.customerId}/adGroupAds:mutate`

  const { videoAssets } = args

  const body = {
    operations: [{
      create: {
        adGroup: args.adGroupResourceName,
        status: 'PAUSED',
        ad: {
          finalUrls: [videoAssets.finalUrl],
          responsiveVideoAd: {
            videos: [{ asset: videoAssets.videoAssetResourceName }],
            headlines: videoAssets.headlines.map((text) => ({ text })),
            longHeadlines: (videoAssets.longHeadlines ?? []).map((text) => ({ text })),
            descriptions: videoAssets.descriptions.map((text) => ({ text })),
            ...(videoAssets.callToActionTexts
              ? { callToActionTexts: videoAssets.callToActionTexts.map((text) => ({ text })) }
              : {}),
            ...(videoAssets.displayUrl ? { displayUrl: videoAssets.displayUrl } : {}),
            ...(videoAssets.companionBannerResourceName
              ? { companionBanners: [{ asset: videoAssets.companionBannerResourceName }] }
              : {}),
          },
        },
      },
    }],
  }

  const res = await fetch(url, { method: 'POST', headers: buildHeaders(args), body: JSON.stringify(body) })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google video ad create failed: HTTP ${res.status} — ${text}`)
  }
  const data = await res.json() as { results: Array<{ resourceName: string }> }
  const resourceName = data.results[0]?.resourceName
  if (!resourceName) throw new Error('Video ad creation returned no resourceName')
  const id = resourceName.split('/').pop() ?? ''
  return { resourceName, id }
}
