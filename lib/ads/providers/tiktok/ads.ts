// lib/ads/providers/tiktok/ads.ts
// TikTok Ad CRUD — Sub-3c Phase 2 Batch 2C.
// Wraps /ad/create/, /ad/update/, /ad/status/update/.
// Phase 2 baseline: SINGLE_IMAGE via imageIds; video + carousel deferred to Phase 3 (Creative Sync).

import type { Ad } from '@/lib/ads/types'
import { createTiktokAdsClient } from './client'
import { tiktokStatusFromCanonical, type TiktokEntityStatus } from './mappers'

export interface TiktokAdCallArgs {
  advertiserId: string
  accessToken: string
  fetchImpl?: typeof fetch
}

export interface TiktokAdResult {
  adId: string
  identityId?: string
  identityType?: string
}

export type TiktokCallToAction =
  | 'SHOP_NOW'
  | 'LEARN_MORE'
  | 'SIGN_UP'
  | 'DOWNLOAD'
  | 'CONTACT_US'
  | 'APPLY_NOW'
  | 'BOOK_NOW'
  | 'ORDER_NOW'
  | 'INSTALL_NOW'
  | 'WATCH_NOW'
  | 'SUBSCRIBE'
  | 'GET_QUOTE'
  | 'INQUIRE_NOW'
  | 'GET_TICKETS_NOW'
  | 'GET_SHOWTIMES'
  | 'PRE_ORDER_NOW'
  | 'CALL_NOW'

/** Create a TikTok Ad. Phase 2 baseline supports SINGLE_IMAGE via imageIds. */
export async function createAd(
  args: TiktokAdCallArgs & {
    canonical: Ad
    /** Parent TikTok adgroup id (PiB AdSet.providerData.tiktok.adgroupId) */
    adgroupId: string
    /** TikTok poster identity id */
    identityId: string
    identityType: 'AUTH_CODE' | 'CUSTOMIZED_USER' | 'TT_USER'
    /** Caption / primary text */
    adText: string
    callToAction: TiktokCallToAction
    landingPageUrl: string
    displayName?: string
    /** TikTok asset IDs (Phase 3 creative-sync produces these) */
    imageIds?: string[]
    /** Single video asset id (Phase 3 creative-sync) */
    videoId?: string
  },
): Promise<TiktokAdResult> {
  if (!args.imageIds?.length && !args.videoId) {
    throw new Error('createAd: must provide imageIds or videoId (creative reference required)')
  }

  const client = createTiktokAdsClient({ accessToken: args.accessToken, fetchImpl: args.fetchImpl })

  const body: Record<string, unknown> = {
    advertiser_id: args.advertiserId,
    adgroup_id: args.adgroupId,
    ad_name: args.canonical.name,
    identity_id: args.identityId,
    identity_type: args.identityType,
    ad_text: args.adText,
    call_to_action: args.callToAction,
    landing_page_url: args.landingPageUrl,
    operation_status: tiktokStatusFromCanonical(args.canonical.status),
  }

  if (args.displayName) body.display_name = args.displayName
  if (args.imageIds && args.imageIds.length > 0) body.image_ids = args.imageIds
  if (args.videoId) body.video_id = args.videoId

  const data = await client.post<{ ad_id: string; identity_id?: string; identity_type?: string }>(
    '/ad/create/',
    body,
  )

  return {
    adId: String(data.ad_id),
    identityId: data.identity_id,
    identityType: data.identity_type,
  }
}

/** Partial-update an existing TikTok Ad. Pass only the fields you want to change. */
export async function updateAd(
  args: TiktokAdCallArgs & {
    adId: string
    patch: {
      adName?: string
      adText?: string
      callToAction?: TiktokCallToAction
      landingPageUrl?: string
    }
  },
): Promise<void> {
  const client = createTiktokAdsClient({ accessToken: args.accessToken, fetchImpl: args.fetchImpl })

  const body: Record<string, unknown> = {
    advertiser_id: args.advertiserId,
    ad_id: args.adId,
  }

  if (args.patch.adName !== undefined) body.ad_name = args.patch.adName
  if (args.patch.adText !== undefined) body.ad_text = args.patch.adText
  if (args.patch.callToAction !== undefined) body.call_to_action = args.patch.callToAction
  if (args.patch.landingPageUrl !== undefined) body.landing_page_url = args.patch.landingPageUrl

  await client.post('/ad/update/', body)
}

async function setStatus(
  args: TiktokAdCallArgs & { adId: string; status: TiktokEntityStatus },
): Promise<void> {
  const client = createTiktokAdsClient({ accessToken: args.accessToken, fetchImpl: args.fetchImpl })
  await client.post('/ad/status/update/', {
    advertiser_id: args.advertiserId,
    ad_ids: [args.adId],
    operation_status: args.status,
  })
}

/** Convenience: flip ad status to DISABLE (paused). */
export async function pauseAd(args: TiktokAdCallArgs & { adId: string }): Promise<void> {
  return setStatus({ ...args, status: 'DISABLE' })
}

/** Convenience: flip ad status to ENABLE (active). */
export async function resumeAd(args: TiktokAdCallArgs & { adId: string }): Promise<void> {
  return setStatus({ ...args, status: 'ENABLE' })
}

/** Convenience: flip ad status to DELETE (archived). */
export async function archiveAd(args: TiktokAdCallArgs & { adId: string }): Promise<void> {
  return setStatus({ ...args, status: 'DELETE' })
}
