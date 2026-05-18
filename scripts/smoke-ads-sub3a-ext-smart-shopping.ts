/**
 * Sub-3a-ext Smart Shopping acceptance smoke test.
 *
 * Creates a Smart Shopping campaign (Pmax + Merchant Center) →
 * text asset group → default listing group (root subdivision + unit child),
 * all PAUSED. Cleans up by removing the campaign at the end.
 *
 * Requires:
 *   SMOKE_GOOGLE_ACCESS_TOKEN      — valid OAuth access token with adwords scope
 *   SMOKE_GOOGLE_DEVELOPER_TOKEN   — developer token
 *   SMOKE_GOOGLE_CUSTOMER_ID       — 10-digit customer ID (no dashes)
 *   SMOKE_GOOGLE_LOGIN_CUSTOMER_ID (optional) — MCC customer ID
 *   GOOGLE_ADS_TEST_MERCHANT_ID    — Merchant Center numeric account ID
 *   GOOGLE_ADS_TEST_FEED_LABEL     — Feed label (e.g. 'US')
 *
 * Run (live):
 *   SMOKE_GOOGLE_ACCESS_TOKEN=ya29.xxx \
 *   SMOKE_GOOGLE_DEVELOPER_TOKEN=xxx \
 *   SMOKE_GOOGLE_CUSTOMER_ID=1234567890 \
 *   GOOGLE_ADS_TEST_MERCHANT_ID=987654321 \
 *   GOOGLE_ADS_TEST_FEED_LABEL=US \
 *   npx tsx scripts/smoke-ads-sub3a-ext-smart-shopping.ts
 *
 * Skip-mode (no env vars set): exits 0 and prints instructions.
 */

import { createSmartShoppingCampaign, removePmaxCampaign } from '@/lib/ads/providers/google/campaigns-pmax'
import { createTextAssets, createAssetGroup } from '@/lib/ads/providers/google/asset-groups'
import { createDefaultListingGroup } from '@/lib/ads/providers/google/listing-groups'
import type { AssetGroupAssetLink, AssetFieldType } from '@/lib/ads/providers/google/asset-groups'
import { Timestamp } from 'firebase-admin/firestore'

async function main() {
  const accessToken = process.env.SMOKE_GOOGLE_ACCESS_TOKEN
  const developerToken = process.env.SMOKE_GOOGLE_DEVELOPER_TOKEN
  const customerId = process.env.SMOKE_GOOGLE_CUSTOMER_ID
  const loginCustomerId = process.env.SMOKE_GOOGLE_LOGIN_CUSTOMER_ID
  const merchantId = process.env.GOOGLE_ADS_TEST_MERCHANT_ID
  const feedLabel = process.env.GOOGLE_ADS_TEST_FEED_LABEL

  if (!accessToken || !developerToken || !customerId || !merchantId || !feedLabel) {
    console.log(
      'Skip mode — set SMOKE_GOOGLE_ACCESS_TOKEN + SMOKE_GOOGLE_DEVELOPER_TOKEN + ' +
      'SMOKE_GOOGLE_CUSTOMER_ID + GOOGLE_ADS_TEST_MERCHANT_ID + GOOGLE_ADS_TEST_FEED_LABEL to run',
    )
    process.exit(0)
  }

  const callArgs = { customerId, accessToken, developerToken, loginCustomerId }
  const ts = new Date().toISOString()
  const now = Timestamp.now()

  let campaignResourceName: string | null = null

  try {
    // ─── 1. Create Smart Shopping campaign (PAUSED) ───────────────────────────
    console.log(`\n1. Creating Smart Shopping campaign "[SMOKE SS] ${ts}"…`)
    const campaign = await createSmartShoppingCampaign({
      ...callArgs,
      canonical: {
        id: 'smoke-smart-shopping',
        orgId: 'smoke-org',
        platform: 'google',
        adAccountId: customerId,
        name: `[SMOKE SS] ${ts}`,
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
      merchantId,
      feedLabel,
      // Default: MAXIMIZE_CONVERSION_VALUE with targetRoas=4.0
    })
    campaignResourceName = campaign.resourceName
    console.log(`   ✓ Campaign: ${campaignResourceName}`)

    // ─── 2. Create text assets ────────────────────────────────────────────────
    console.log('\n2. Creating text assets…')
    const headlines = ['Shop our bestsellers', 'Free shipping on all orders', 'Trusted quality brands']
    const longHeadlines = ['Discover top products at unbeatable prices']
    const descriptions = ['Shop thousands of products online.', 'Easy returns and fast delivery.']
    const businessNameText = 'Partners in Biz Store'

    const [headlineAssets, longHeadlineAssets, descriptionAssets, businessNameAssets] = await Promise.all([
      createTextAssets({ ...callArgs, texts: headlines }),
      createTextAssets({ ...callArgs, texts: longHeadlines }),
      createTextAssets({ ...callArgs, texts: descriptions }),
      createTextAssets({ ...callArgs, texts: [businessNameText] }),
    ])

    console.log(`   ✓ Headlines: ${headlineAssets.map((a) => a.id).join(', ')}`)
    console.log(`   ✓ Long headlines: ${longHeadlineAssets.map((a) => a.id).join(', ')}`)
    console.log(`   ✓ Descriptions: ${descriptionAssets.map((a) => a.id).join(', ')}`)
    console.log(`   ✓ Business name: ${businessNameAssets[0]?.id}`)

    // ─── 3. Create asset group ────────────────────────────────────────────────
    console.log('\n3. Creating asset group…')
    const assetLinks: AssetGroupAssetLink[] = [
      ...headlineAssets.map((a) => ({ assetResourceName: a.resourceName, fieldType: 'HEADLINE' as AssetFieldType })),
      ...longHeadlineAssets.map((a) => ({ assetResourceName: a.resourceName, fieldType: 'LONG_HEADLINE' as AssetFieldType })),
      ...descriptionAssets.map((a) => ({ assetResourceName: a.resourceName, fieldType: 'DESCRIPTION' as AssetFieldType })),
      ...businessNameAssets.map((a) => ({ assetResourceName: a.resourceName, fieldType: 'BUSINESS_NAME' as AssetFieldType })),
    ]

    const assetGroup = await createAssetGroup({
      ...callArgs,
      campaignResourceName,
      name: `Smart Shopping Creative — ${ts}`,
      finalUrls: ['https://partnersinbiz.online'],
      status: 'PAUSED',
      assetLinks,
    })
    console.log(`   ✓ Asset group: ${assetGroup.resourceName}`)

    // ─── 4. Create default listing group (root subdivision + all-products unit) ─
    console.log('\n4. Creating default listing group (root subdivision + all-products unit)…')
    const listingGroups = await createDefaultListingGroup({
      ...callArgs,
      assetGroupResourceName: assetGroup.resourceName,
    })
    console.log(`   ✓ Root subdivision: ${listingGroups.rootResourceName}`)
    console.log(`   ✓ Unit (all products): ${listingGroups.unitResourceName}`)

    // ─── 5. Cleanup: remove campaign ──────────────────────────────────────────
    console.log('\n5. Removing Smart Shopping campaign (cleanup)…')
    await removePmaxCampaign({ ...callArgs, resourceName: campaignResourceName })
    campaignResourceName = null
    console.log('   ✓ Campaign removed')

    console.log('\n✅ All smoke steps passed — Smart Shopping sub-3a-ext is green.\n')
  } catch (err) {
    console.error('\n❌ Smoke test failed:', err)
    // Best-effort cleanup
    if (campaignResourceName) {
      try {
        console.log('   Cleaning up campaign…')
        await removePmaxCampaign({ ...callArgs, resourceName: campaignResourceName })
        console.log('   Campaign cleaned up.')
      } catch (cleanupErr) {
        console.warn('   Cleanup failed:', cleanupErr)
      }
    }
    process.exit(1)
  }
}

main()
