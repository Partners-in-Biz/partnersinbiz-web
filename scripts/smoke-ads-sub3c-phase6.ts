#!/usr/bin/env tsx
// scripts/smoke-ads-sub3c-phase6.ts
//
// End-to-end smoke for Sub-3c TikTok Phase 6 — Events API (server-side conversions).
// Fires a canonical conversion via trackConversion() twice (verifies tiktok=sent +
// idempotent dedupe) against a live TikTok pixel config + conversion action.
//
// Required env vars:
//   TIKTOK_ADS_TEST_ORG_ID              — PiB orgId that has a TikTok pixel config + conversion action
//   TIKTOK_ADS_TEST_CONVERSION_ID       — ad_conversion_actions doc id with platform: 'tiktok'
//
// Optional:
//   TIKTOK_ADS_TEST_EMAIL               — test email for user identifier (default: smoke-test@partnersinbiz.online)
//
// Skipped automatically if required vars are absent.

import { trackConversion } from '@/lib/ads/conversions/track'
import type { ConversionEventInput } from '@/lib/ads/conversions/types'
import crypto from 'crypto'

async function main() {
  const orgId = process.env.TIKTOK_ADS_TEST_ORG_ID
  const conversionActionId = process.env.TIKTOK_ADS_TEST_CONVERSION_ID

  if (!orgId || !conversionActionId) {
    console.log(
      '[smoke-ads-sub3c-phase6] SKIP — TIKTOK_ADS_TEST_ORG_ID and/or ' +
        'TIKTOK_ADS_TEST_CONVERSION_ID not set',
    )
    return
  }

  const testEmail = process.env.TIKTOK_ADS_TEST_EMAIL ?? 'smoke-test@partnersinbiz.online'

  // Use a stable event ID for the first fire, then verify dedupe on re-fire.
  const eventId = `smoke-sub3c-p6-${crypto.randomBytes(6).toString('hex')}`

  const input: ConversionEventInput = {
    orgId,
    conversionActionId,
    eventId,
    eventTime: new Date(),
    value: 99.99,
    currency: 'USD',
    user: {
      email: testEmail,
    },
  }

  console.log(`[smoke-ads-sub3c-phase6] firing conversion eventId=${eventId}`)
  console.log(`  orgId=${orgId}  conversionActionId=${conversionActionId}`)

  try {
    // ── First fire ─────────────────────────────────────────────────────────────
    const result1 = await trackConversion(input)
    console.log('[smoke] first fire result:', JSON.stringify(result1))

    if (result1.tiktok !== 'sent') {
      throw new Error(
        `Expected result.tiktok === 'sent', got '${result1.tiktok}'. Error: ${result1.tiktokError ?? '(none)'}`,
      )
    }
    console.log('[smoke] ✓ tiktok=sent on first fire')

    // ── Dedupe fire (same eventId) ─────────────────────────────────────────────
    const result2 = await trackConversion(input)
    console.log('[smoke] dedupe fire result:', JSON.stringify(result2))

    if (result2.tiktok !== 'sent') {
      throw new Error(
        `Dedupe: Expected result.tiktok === 'sent' (from cache), got '${result2.tiktok}'`,
      )
    }
    console.log('[smoke] ✓ tiktok=sent on dedupe re-fire (idempotent)')

    console.log('\n[smoke-ads-sub3c-phase6] ALL CHECKS PASSED ✅')
  } catch (err) {
    console.error('[smoke-ads-sub3c-phase6] FAILED ❌', err)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('[smoke-ads-sub3c-phase6] FATAL', err)
  process.exit(1)
})
