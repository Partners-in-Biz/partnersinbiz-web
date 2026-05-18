#!/usr/bin/env tsx
// E2E smoke for Sub-3c TikTok Phase 3 — image upload.
// Requires: TIKTOK_ADS_TEST_ACCESS_TOKEN + TIKTOK_ADS_TEST_ADVERTISER_ID +
//           TIKTOK_ADS_TEST_IMAGE_URL (publicly-reachable image URL)

import { uploadImageByUrl } from '@/lib/ads/providers/tiktok/creative-sync'

async function main() {
  const accessToken = process.env.TIKTOK_ADS_TEST_ACCESS_TOKEN
  const advertiserId = process.env.TIKTOK_ADS_TEST_ADVERTISER_ID
  const imageUrl = process.env.TIKTOK_ADS_TEST_IMAGE_URL
  if (!accessToken || !advertiserId || !imageUrl) {
    console.log('[smoke-ads-sub3c-phase3] SKIP — TIKTOK_ADS_TEST_{ACCESS_TOKEN,ADVERTISER_ID,IMAGE_URL} not all set')
    return
  }

  console.log(`[smoke] uploading image from: ${imageUrl}`)
  const result = await uploadImageByUrl({ advertiserId, accessToken, imageUrl })
  console.log(`[smoke] ✓ uploaded → image_id: ${result.imageId}`)
  console.log(`  url: ${result.imageUrl} (${result.width}x${result.height}, ${result.size} bytes)`)
  console.log('\n[smoke-ads-sub3c-phase3] PASS ✅')
}

main().catch((err) => {
  console.error('[smoke-ads-sub3c-phase3] FATAL', err)
  process.exit(1)
})
