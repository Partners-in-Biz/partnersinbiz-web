#!/usr/bin/env tsx
// scripts/smoke-ads-sub3c-phase1.ts
// End-to-end smoke for Sub-3c TikTok Phase 1 — list advertiser accounts.
// Skipped automatically if TIKTOK_ADS_TEST_ACCESS_TOKEN not set.

import { listAdvertisers } from '@/lib/ads/providers/tiktok/accounts'

async function main() {
  const accessToken = process.env.TIKTOK_ADS_TEST_ACCESS_TOKEN
  if (!accessToken) {
    console.log('[smoke-ads-sub3c-phase1] SKIP — TIKTOK_ADS_TEST_ACCESS_TOKEN not set')
    return
  }
  const advertisers = await listAdvertisers({ accessToken })
  console.log(`[smoke] ✓ found ${advertisers.length} advertisers`)
  for (const a of advertisers.slice(0, 5)) {
    console.log(`  - ${a.advertiserId} (${a.advertiserName ?? '<no name>'})`)
  }
  console.log('\n[smoke-ads-sub3c-phase1] PASS ✅')
}

main().catch((err) => {
  console.error('[smoke-ads-sub3c-phase1] FATAL', err)
  process.exit(1)
})
