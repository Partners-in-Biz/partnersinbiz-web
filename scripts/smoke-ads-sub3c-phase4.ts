#!/usr/bin/env tsx
// scripts/smoke-ads-sub3c-phase4.ts
// E2E smoke for Sub-3c TikTok Phase 4 — Custom Audience create + upload + delete.
// Skips gracefully when env vars are not set (safe for CI).
//
// Usage:
//   TIKTOK_ADS_TEST_ACCESS_TOKEN=xxx TIKTOK_ADS_TEST_ADVERTISER_ID=yyy \
//     npx tsx scripts/smoke-ads-sub3c-phase4.ts

import {
  createAudience,
  uploadAudienceFile,
  applyAudienceFile,
  getAudienceStatus,
  deleteAudience,
} from '@/lib/ads/providers/tiktok/audiences'
import { rowsToTiktokPayload } from '@/lib/ads/providers/tiktok/audiences-hash'

async function main() {
  const accessToken = process.env.TIKTOK_ADS_TEST_ACCESS_TOKEN
  const advertiserId = process.env.TIKTOK_ADS_TEST_ADVERTISER_ID

  if (!accessToken || !advertiserId) {
    console.log(
      '[smoke-ads-sub3c-phase4] SKIP — TIKTOK_ADS_TEST_{ACCESS_TOKEN,ADVERTISER_ID} not set',
    )
    return
  }

  const ts = Date.now()
  const audience = await createAudience({
    advertiserId,
    accessToken,
    name: `pib-smoke-tt-p4-${ts}`,
    audienceType: 'CUSTOMER_FILE',
  })
  console.log(`[smoke] created audience: ${audience.customAudienceId}`)

  try {
    const payload = rowsToTiktokPayload([
      { email: 'smoke@example.com' },
      { phone: '+15555550199' },
    ])
    const upload = await uploadAudienceFile({
      advertiserId,
      accessToken,
      customAudienceId: audience.customAudienceId,
      payload,
    })
    console.log(`[smoke] uploaded file: ${upload.filePath}`)

    await applyAudienceFile({
      advertiserId,
      accessToken,
      customAudienceId: audience.customAudienceId,
      filePaths: [upload.filePath],
    })
    console.log('[smoke] applied file')

    const status = await getAudienceStatus({
      advertiserId,
      accessToken,
      customAudienceId: audience.customAudienceId,
    })
    console.log(
      `[smoke] status: ${status.status} (users: ${status.approximateUserNum ?? 'n/a'})`,
    )

    console.log('\n[smoke-ads-sub3c-phase4] PASS')
  } finally {
    try {
      await deleteAudience({
        advertiserId,
        accessToken,
        customAudienceId: audience.customAudienceId,
      })
      console.log(`[cleanup] deleted ${audience.customAudienceId}`)
    } catch (e) {
      console.warn(`[cleanup] failed: ${(e as Error).message}`)
    }
  }
}

main().catch((err) => {
  console.error('[smoke-ads-sub3c-phase4] FATAL', err)
  process.exit(1)
})
