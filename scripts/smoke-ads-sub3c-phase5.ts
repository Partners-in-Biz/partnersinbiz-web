#!/usr/bin/env tsx
// scripts/smoke-ads-sub3c-phase5.ts
//
// End-to-end smoke for Sub-3c TikTok Phase 5 — Insights (/report/integrated/get/).
// Queries at all 3 levels (campaign/adset/ad) against a live TikTok ad account
// and verifies the response shape parses cleanly.
//
// Required env vars:
//   TIKTOK_ADS_TEST_ACCESS_TOKEN
//   TIKTOK_ADS_TEST_ADVERTISER_ID
//
// At least ONE of these must be set (smoke runs whichever levels you provide):
//   TIKTOK_ADS_TEST_CAMPAIGN_ID   — numeric campaign_id
//   TIKTOK_ADS_TEST_ADGROUP_ID    — numeric adgroup_id
//   TIKTOK_ADS_TEST_AD_ID         — numeric ad_id
//
// Optional:
//   TIKTOK_ADS_TEST_CURRENCY (default 'USD')
//
// Skipped automatically if access token / advertiser id are absent OR no entity
// ids are set.

import { pullInsights } from '@/lib/ads/providers/tiktok/insights'

async function main() {
  const accessToken = process.env.TIKTOK_ADS_TEST_ACCESS_TOKEN
  const advertiserId = process.env.TIKTOK_ADS_TEST_ADVERTISER_ID
  const campaignId = process.env.TIKTOK_ADS_TEST_CAMPAIGN_ID
  const adgroupId = process.env.TIKTOK_ADS_TEST_ADGROUP_ID
  const adId = process.env.TIKTOK_ADS_TEST_AD_ID
  const currencyCode = process.env.TIKTOK_ADS_TEST_CURRENCY ?? 'USD'

  if (!accessToken || !advertiserId) {
    console.log(
      '[smoke-ads-sub3c-phase5] SKIP — TIKTOK_ADS_TEST_ACCESS_TOKEN and/or ' +
      'TIKTOK_ADS_TEST_ADVERTISER_ID not set',
    )
    return
  }

  if (!campaignId && !adgroupId && !adId) {
    console.log(
      '[smoke-ads-sub3c-phase5] SKIP — no TIKTOK_ADS_TEST_{CAMPAIGN_ID,ADGROUP_ID,AD_ID} set ' +
      '(need at least one)',
    )
    return
  }

  // Date range: last 7 days
  const today = new Date()
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
  const dateRange = {
    start: sevenDaysAgo.toISOString().slice(0, 10),
    end: today.toISOString().slice(0, 10),
  }
  console.log(`[smoke-ads-sub3c-phase5] date range: ${dateRange.start} → ${dateRange.end}`)

  try {
    if (campaignId) {
      const rows = await pullInsights({
        advertiserId,
        accessToken,
        level: 'campaign',
        ids: [campaignId],
        dateRange,
        currencyCode,
      })
      console.log(`[smoke] ✓ campaign level (AUCTION_CAMPAIGN): ${rows.length} rows`)
      if (rows.length > 0) {
        const r = rows[0]
        console.log(
          `  sample: date=${r.date} entityId=${r.entityId} impressions=${r.impressions} ` +
          `clicks=${r.clicks} spend=${r.spendMajor} ${r.currencyCode} ` +
          `ctr=${r.ctr} cpc=${r.cpc} cpm=${r.cpm} reach=${r.reach}`,
        )
      }
    }

    if (adgroupId) {
      const rows = await pullInsights({
        advertiserId,
        accessToken,
        level: 'adset',
        ids: [adgroupId],
        dateRange,
        currencyCode,
      })
      console.log(`[smoke] ✓ adset level (AUCTION_ADGROUP): ${rows.length} rows`)
      if (rows.length > 0) {
        const r = rows[0]
        console.log(
          `  sample: date=${r.date} entityId=${r.entityId} impressions=${r.impressions} spend=${r.spendMajor}`,
        )
      }
    }

    if (adId) {
      const rows = await pullInsights({
        advertiserId,
        accessToken,
        level: 'ad',
        ids: [adId],
        dateRange,
        currencyCode,
      })
      console.log(`[smoke] ✓ ad level (AUCTION_AD): ${rows.length} rows`)
      if (rows.length > 0) {
        const r = rows[0]
        console.log(
          `  sample: date=${r.date} entityId=${r.entityId} impressions=${r.impressions} spend=${r.spendMajor}`,
        )
      }
    }

    console.log('\n[smoke-ads-sub3c-phase5] ALL CHECKS PASSED ✅')
  } catch (err) {
    console.error('[smoke-ads-sub3c-phase5] FAILED ❌', err)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('[smoke-ads-sub3c-phase5] FATAL', err)
  process.exit(1)
})
