#!/usr/bin/env tsx
// scripts/smoke-ads-sub3c-phase2.ts
// E2E smoke for Sub-3c TikTok Phase 2 — Campaign → AdGroup → Ad lifecycle.
//
// Required env vars:
//   TIKTOK_ADS_TEST_ACCESS_TOKEN   — OAuth access token with ads_management scope
//   TIKTOK_ADS_TEST_ADVERTISER_ID  — TikTok advertiser id (numeric string)
// Optional:
//   TIKTOK_ADS_TEST_IDENTITY_ID    — TikTok identity id (for creative). If absent,
//                                    smoke fetches first available via listIdentities.
//   TIKTOK_ADS_TEST_IMAGE_ID       — TikTok asset image id (Phase 3 creative-sync produces these).
//                                    If absent, Ad creation step is skipped.

import {
  createCampaign,
  pauseCampaign,
  resumeCampaign,
  archiveCampaign,
} from '@/lib/ads/providers/tiktok/campaigns'
import {
  createAdGroup,
  archiveAdGroup,
} from '@/lib/ads/providers/tiktok/adgroups'
import {
  createAd,
  archiveAd,
} from '@/lib/ads/providers/tiktok/ads'
import { listIdentities } from '@/lib/ads/providers/tiktok/identities'
import type { AdCampaign, AdSet, Ad } from '@/lib/ads/types'

async function main() {
  const accessToken = process.env.TIKTOK_ADS_TEST_ACCESS_TOKEN
  const advertiserId = process.env.TIKTOK_ADS_TEST_ADVERTISER_ID
  const presetIdentityId = process.env.TIKTOK_ADS_TEST_IDENTITY_ID
  const imageId = process.env.TIKTOK_ADS_TEST_IMAGE_ID

  if (!accessToken || !advertiserId) {
    console.log('[smoke-ads-sub3c-phase2] SKIP — TIKTOK_ADS_TEST_ACCESS_TOKEN or TIKTOK_ADS_TEST_ADVERTISER_ID not set')
    return
  }

  const ts = Date.now()
  const runTag = `pib-smoke-tt-p2-${ts}`
  console.log(`[smoke-ads-sub3c-phase2] run tag: ${runTag}`)
  console.log(`[smoke-ads-sub3c-phase2] advertiser: ${advertiserId}`)

  let campaignId: string | undefined
  let adgroupId: string | undefined
  let adId: string | undefined

  try {
    // Step 1: Campaign
    const canonicalCampaign = {
      id: `${runTag}-campaign`, orgId: 'smoke-org', adAccountId: advertiserId,
      platform: 'tiktok', name: `${runTag} campaign`, objective: 'TRAFFIC',
      status: 'PAUSED',
      createdAt: { _seconds: 0, _nanoseconds: 0 } as any,
      updatedAt: { _seconds: 0, _nanoseconds: 0 } as any,
    } as unknown as AdCampaign

    const campaign = await createCampaign({
      advertiserId, accessToken,
      canonical: canonicalCampaign,
      budgetMajor: 1, // $1/day so no spend
      budgetMode: 'BUDGET_MODE_DAY',
    })
    campaignId = campaign.campaignId
    console.log(`[smoke] ✓ created campaign: ${campaign.campaignId}`)

    // Step 2: AdGroup
    const canonicalAdSet = {
      id: `${runTag}-adset`, orgId: 'smoke-org', adAccountId: advertiserId,
      campaignId: canonicalCampaign.id, platform: 'tiktok',
      name: `${runTag} adgroup`, status: 'PAUSED',
      targeting: { geo: { countries: ['US'] }, demographics: { ageMin: 18, ageMax: 34 }, customAudiences: { include: [], exclude: [] } },
      createdAt: { _seconds: 0, _nanoseconds: 0 } as any,
      updatedAt: { _seconds: 0, _nanoseconds: 0 } as any,
    } as unknown as AdSet

    const adgroup = await createAdGroup({
      advertiserId, accessToken,
      canonical: canonicalAdSet,
      campaignId: campaign.campaignId,
      objective: 'TRAFFIC',
      budgetMajor: 1,
      budgetMode: 'BUDGET_MODE_DAY',
    })
    adgroupId = adgroup.adgroupId
    console.log(`[smoke] ✓ created adgroup: ${adgroup.adgroupId}`)

    // Step 3: Ad (requires identity + creative reference)
    let identityId = presetIdentityId
    let identityType: 'AUTH_CODE' | 'CUSTOMIZED_USER' | 'TT_USER' = 'TT_USER'
    if (!identityId) {
      const identities = await listIdentities({ advertiserId, accessToken })
      if (identities.length === 0) {
        console.log('[smoke] ⏭  Ad step skipped — no identities available + TIKTOK_ADS_TEST_IDENTITY_ID not set')
      } else {
        identityId = identities[0].identityId
        identityType = identities[0].identityType
      }
    }

    if (identityId && imageId) {
      const canonicalAd = {
        id: `${runTag}-ad`, orgId: 'smoke-org', adAccountId: advertiserId,
        adSetId: canonicalAdSet.id, campaignId: canonicalCampaign.id,
        platform: 'tiktok', name: `${runTag} ad`, format: 'SINGLE_IMAGE',
        status: 'DRAFT',
        createdAt: { _seconds: 0, _nanoseconds: 0 } as any,
        updatedAt: { _seconds: 0, _nanoseconds: 0 } as any,
      } as unknown as Ad

      const ad = await createAd({
        advertiserId, accessToken,
        canonical: canonicalAd,
        adgroupId: adgroup.adgroupId,
        identityId,
        identityType,
        adText: 'Smoke test ad — please ignore',
        callToAction: 'LEARN_MORE',
        landingPageUrl: 'https://partnersinbiz.online',
        imageIds: [imageId],
      })
      adId = ad.adId
      console.log(`[smoke] ✓ created ad: ${ad.adId}`)
    } else if (!imageId) {
      console.log('[smoke] ⏭  Ad step skipped — TIKTOK_ADS_TEST_IMAGE_ID not set')
    }

    // Step 4: Pause + resume campaign for status verification
    await pauseCampaign({ advertiserId, accessToken, campaignId: campaign.campaignId })
    console.log('[smoke] ✓ pauseCampaign')
    await resumeCampaign({ advertiserId, accessToken, campaignId: campaign.campaignId })
    console.log('[smoke] ✓ resumeCampaign')

    console.log('\n[smoke-ads-sub3c-phase2] ALL CHECKS PASSED ✅')
  } catch (err) {
    console.error('[smoke-ads-sub3c-phase2] FAILED ❌', err)
    process.exitCode = 1
  } finally {
    // Cleanup
    if (adId) {
      try { await archiveAd({ advertiserId: advertiserId!, accessToken: accessToken!, adId }); console.log(`[cleanup] archived ad ${adId}`) } catch (e) { console.warn(`[cleanup] failed: ${(e as Error).message}`) }
    }
    if (adgroupId) {
      try { await archiveAdGroup({ advertiserId: advertiserId!, accessToken: accessToken!, adgroupId }); console.log(`[cleanup] archived adgroup ${adgroupId}`) } catch (e) { console.warn(`[cleanup] failed: ${(e as Error).message}`) }
    }
    if (campaignId) {
      try { await archiveCampaign({ advertiserId: advertiserId!, accessToken: accessToken!, campaignId }); console.log(`[cleanup] archived campaign ${campaignId}`) } catch (e) { console.warn(`[cleanup] failed: ${(e as Error).message}`) }
    }
  }
}

main().catch((err) => {
  console.error('[smoke-ads-sub3c-phase2] FATAL', err)
  process.exit(1)
})
