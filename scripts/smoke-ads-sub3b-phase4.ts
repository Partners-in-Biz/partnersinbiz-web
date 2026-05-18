#!/usr/bin/env tsx
// scripts/smoke-ads-sub3b-phase4.ts
//
// End-to-end smoke for Sub-3b LinkedIn Phase 4 — Insights. Queries
// /rest/adAnalytics at all 3 levels (campaign/adset/ad) against a live
// LinkedIn test ad account; verifies the response shape parses cleanly.
//
// Required env vars:
//   LINKEDIN_ADS_TEST_ACCESS_TOKEN
//
// At least ONE of these must be set (smoke runs whichever levels you provide):
//   LINKEDIN_ADS_TEST_CAMPAIGN_GROUP_URN  — urn:li:sponsoredCampaignGroup:{id}
//   LINKEDIN_ADS_TEST_CAMPAIGN_URN        — urn:li:sponsoredCampaign:{id}
//   LINKEDIN_ADS_TEST_CREATIVE_URN        — urn:li:sponsoredCreative:{id}
//
// Optional:
//   LINKEDIN_ADS_TEST_CURRENCY (default 'USD')
//
// Skipped automatically if access token is absent OR no entity URNs are set.

import { pullInsights } from '@/lib/ads/providers/linkedin/insights'

async function main() {
  const accessToken = process.env.LINKEDIN_ADS_TEST_ACCESS_TOKEN
  const campaignGroupUrn = process.env.LINKEDIN_ADS_TEST_CAMPAIGN_GROUP_URN
  const campaignUrn = process.env.LINKEDIN_ADS_TEST_CAMPAIGN_URN
  const creativeUrn = process.env.LINKEDIN_ADS_TEST_CREATIVE_URN
  const currencyCode = process.env.LINKEDIN_ADS_TEST_CURRENCY ?? 'USD'

  if (!accessToken) {
    console.log('[smoke-ads-sub3b-phase4] SKIP — LINKEDIN_ADS_TEST_ACCESS_TOKEN not set')
    return
  }
  if (!campaignGroupUrn && !campaignUrn && !creativeUrn) {
    console.log('[smoke-ads-sub3b-phase4] SKIP — no LINKEDIN_ADS_TEST_*_URN set (need at least one)')
    return
  }

  // Date range: last 7 days
  const today = new Date()
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
  const dateRange = {
    start: sevenDaysAgo.toISOString().slice(0, 10),
    end: today.toISOString().slice(0, 10),
  }
  console.log(`[smoke-ads-sub3b-phase4] date range: ${dateRange.start} → ${dateRange.end}`)

  try {
    if (campaignGroupUrn) {
      const rows = await pullInsights({
        accessToken,
        level: 'campaign',
        ids: [campaignGroupUrn],
        dateRange,
        currencyCode,
      })
      console.log(`[smoke] ✓ campaign level (CAMPAIGN_GROUP pivot): ${rows.length} rows`)
      if (rows.length > 0) {
        const r = rows[0]
        console.log(`  sample: date=${r.date} impressions=${r.impressions} clicks=${r.clicks} spend=${r.spendMajor} ${r.currencyCode}`)
      }
    }

    if (campaignUrn) {
      const rows = await pullInsights({
        accessToken,
        level: 'adset',
        ids: [campaignUrn],
        dateRange,
        currencyCode,
      })
      console.log(`[smoke] ✓ adset level (CAMPAIGN pivot): ${rows.length} rows`)
    }

    if (creativeUrn) {
      const rows = await pullInsights({
        accessToken,
        level: 'ad',
        ids: [creativeUrn],
        dateRange,
        currencyCode,
      })
      console.log(`[smoke] ✓ ad level (CREATIVE pivot): ${rows.length} rows`)
    }

    console.log('\n[smoke-ads-sub3b-phase4] ALL CHECKS PASSED ✅')
  } catch (err) {
    console.error('[smoke-ads-sub3b-phase4] FAILED ❌', err)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('[smoke-ads-sub3b-phase4] FATAL', err)
  process.exit(1)
})
