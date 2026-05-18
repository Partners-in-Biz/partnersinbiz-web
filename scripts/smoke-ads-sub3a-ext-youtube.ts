/**
 * Sub-3a-ext YouTube acceptance smoke — Video Asset + TrueView for Action campaign.
 *
 * Creates a YouTube video asset → VIDEO_ACTION campaign → ad group → responsive video ad.
 * All resources ship PAUSED so no spend occurs.
 *
 * Env vars required:
 *   SMOKE_GOOGLE_ACCESS_TOKEN       — valid OAuth access token (adwords scope)
 *   SMOKE_GOOGLE_DEVELOPER_TOKEN    — developer token
 *   SMOKE_GOOGLE_CUSTOMER_ID        — 10-digit customer ID (no dashes)
 *   SMOKE_GOOGLE_LOGIN_CUSTOMER_ID  — (optional) MCC manager customer ID
 *   SMOKE_GOOGLE_YOUTUBE_VIDEO_ID   — 11-character YouTube video ID (must be on your channel)
 *
 * Run (live):
 *   SMOKE_GOOGLE_ACCESS_TOKEN=ya29.xxx SMOKE_GOOGLE_DEVELOPER_TOKEN=xxx \
 *   SMOKE_GOOGLE_CUSTOMER_ID=1234567890 SMOKE_GOOGLE_YOUTUBE_VIDEO_ID=dQw4w9WgXcQ \
 *   npx tsx scripts/smoke-ads-sub3a-ext-youtube.ts
 *
 * Skip mode (no creds): the script exits 0 with a SKIPPED message when the required
 * env vars are absent — CI can run this unconditionally.
 */

import { createYoutubeVideoAsset } from '@/lib/ads/providers/google/video-assets'
import { createVideoCampaign, removeVideoCampaign } from '@/lib/ads/providers/google/campaigns-youtube'
import { createResponsiveVideoAd } from '@/lib/ads/providers/google/video-ads'
import { Timestamp } from 'firebase-admin/firestore'

// ─── Helper ──────────────────────────────────────────────────────────────────

async function createAdGroup(args: {
  customerId: string
  accessToken: string
  developerToken: string
  loginCustomerId?: string
  campaignResourceName: string
  name: string
}): Promise<{ resourceName: string; id: string }> {
  const { GOOGLE_ADS_API_BASE_URL } = await import('@/lib/ads/providers/google/constants')
  const url = `${GOOGLE_ADS_API_BASE_URL}/customers/${args.customerId}/adGroups:mutate`
  const body = {
    operations: [{
      create: {
        name: args.name,
        campaign: args.campaignResourceName,
        type: 'VIDEO_RESPONSIVE_VIDEO',
        status: 'PAUSED',
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
    throw new Error(`Ad group create failed: HTTP ${res.status} — ${text}`)
  }
  const data = await res.json() as { results: Array<{ resourceName: string }> }
  const resourceName = data.results[0]?.resourceName
  if (!resourceName) throw new Error('Ad group creation returned no resourceName')
  const id = resourceName.split('/').pop() ?? ''
  return { resourceName, id }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const accessToken = process.env.SMOKE_GOOGLE_ACCESS_TOKEN
  const developerToken = process.env.SMOKE_GOOGLE_DEVELOPER_TOKEN
  const customerId = process.env.SMOKE_GOOGLE_CUSTOMER_ID
  const loginCustomerId = process.env.SMOKE_GOOGLE_LOGIN_CUSTOMER_ID
  const youtubeVideoId = process.env.SMOKE_GOOGLE_YOUTUBE_VIDEO_ID

  if (!accessToken || !developerToken || !customerId || !youtubeVideoId) {
    console.log(
      'SKIPPED — set SMOKE_GOOGLE_ACCESS_TOKEN + SMOKE_GOOGLE_DEVELOPER_TOKEN + ' +
      'SMOKE_GOOGLE_CUSTOMER_ID + SMOKE_GOOGLE_YOUTUBE_VIDEO_ID to run live',
    )
    process.exit(0)
  }

  const callArgs = { customerId, accessToken, developerToken, loginCustomerId }
  const ts = new Date().toISOString()
  const now = Timestamp.now()

  let campaign: { resourceName: string; id: string } | null = null

  try {
    // 1. Create YouTube video asset
    console.log(`\n1. Creating YouTube video asset for videoId "${youtubeVideoId}"…`)
    const asset = await createYoutubeVideoAsset({
      ...callArgs,
      youtubeVideoId,
      name: `[SMOKE EXT-YT] video ${ts}`,
    })
    console.log(`   ✓ Video asset: ${asset.resourceName}`)

    // 2. Create VIDEO_ACTION campaign
    console.log('\n2. Creating VIDEO_ACTION campaign (PAUSED)…')
    campaign = await createVideoCampaign({
      ...callArgs,
      canonical: {
        id: 'smoke-yt-camp',
        orgId: 'smoke-org',
        platform: 'google',
        adAccountId: customerId,
        name: `[SMOKE EXT-YT] TrueView ${ts}`,
        status: 'PAUSED',
        objective: 'SALES',
        cboEnabled: false,
        specialAdCategories: [],
        providerData: {},
        createdBy: 'smoke',
        createdAt: now,
        updatedAt: now,
      },
      dailyBudgetMajor: 10,
    })
    console.log(`   ✓ Campaign: ${campaign.resourceName}`)

    // 3. Create ad group
    console.log('\n3. Creating VIDEO_RESPONSIVE_VIDEO ad group (PAUSED)…')
    const adGroup = await createAdGroup({
      ...callArgs,
      campaignResourceName: campaign.resourceName,
      name: `[SMOKE EXT-YT] AdGroup ${ts}`,
    })
    console.log(`   ✓ Ad group: ${adGroup.resourceName}`)

    // 4. Create responsive video ad
    console.log('\n4. Creating Responsive Video Ad (PAUSED)…')
    const ad = await createResponsiveVideoAd({
      ...callArgs,
      adGroupResourceName: adGroup.resourceName,
      canonical: {
        id: 'smoke-yt-ad',
        orgId: 'smoke-org',
        adSetId: 'smoke-adset',
        campaignId: 'smoke-camp',
        platform: 'google',
        name: `[SMOKE EXT-YT] Ad ${ts}`,
        status: 'PAUSED',
        format: 'SINGLE_VIDEO',
        creativeIds: [],
        copy: { primaryText: 'Smoke test ad', headline: 'Smoke Test' },
        providerData: {},
        createdAt: now,
        updatedAt: now,
      },
      videoAssets: {
        videoAssetResourceName: asset.resourceName,
        headlines: ['Smoke Test', 'Try Now'],
        longHeadlines: ['The best smoke test you will ever watch'],
        descriptions: ['This is an automated smoke test. Do not approve or publish.'],
        finalUrl: 'https://partnersinbiz.online',
        callToActionTexts: ['Learn More'],
      },
    })
    console.log(`   ✓ Video ad: ${ad.resourceName}`)

    console.log('\n✅ Sub-3a-ext YouTube acceptance: PASSED')
  } finally {
    console.log('\n5. Cleanup…')
    if (campaign) {
      try {
        await removeVideoCampaign({ ...callArgs, resourceName: campaign.resourceName })
        console.log('   ✓ Removed campaign (cascades to ad group + ad)')
      } catch (e) {
        console.warn('   ! cleanup error:', (e as Error).message)
      }
    }
  }
}

main().catch((err) => {
  console.error('\n❌ FAILED', err)
  process.exit(1)
})
