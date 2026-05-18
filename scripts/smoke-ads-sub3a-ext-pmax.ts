/**
 * Sub-3a-ext Performance Max acceptance smoke test.
 *
 * Creates a Pmax campaign → text assets → asset group, all PAUSED.
 * Cleans up by removing the campaign at the end.
 *
 * Requires:
 *   SMOKE_GOOGLE_ACCESS_TOKEN     — valid OAuth access token with adwords scope
 *   SMOKE_GOOGLE_DEVELOPER_TOKEN  — developer token
 *   SMOKE_GOOGLE_CUSTOMER_ID      — 10-digit customer ID (no dashes)
 *   SMOKE_GOOGLE_LOGIN_CUSTOMER_ID (optional) — MCC customer ID
 *
 * Run (live):
 *   SMOKE_GOOGLE_ACCESS_TOKEN=ya29.xxx \
 *   SMOKE_GOOGLE_DEVELOPER_TOKEN=xxx \
 *   SMOKE_GOOGLE_CUSTOMER_ID=1234567890 \
 *   npx tsx scripts/smoke-ads-sub3a-ext-pmax.ts
 *
 * Skip-mode (no env vars set): exits 0 and prints instructions.
 */

import { createPmaxCampaign, removePmaxCampaign } from '@/lib/ads/providers/google/campaigns-pmax'
import { createTextAssets, createAssetGroup } from '@/lib/ads/providers/google/asset-groups'
import type { AssetGroupAssetLink, AssetFieldType } from '@/lib/ads/providers/google/asset-groups'
import { Timestamp } from 'firebase-admin/firestore'

async function main() {
  const accessToken = process.env.SMOKE_GOOGLE_ACCESS_TOKEN
  const developerToken = process.env.SMOKE_GOOGLE_DEVELOPER_TOKEN
  const customerId = process.env.SMOKE_GOOGLE_CUSTOMER_ID
  const loginCustomerId = process.env.SMOKE_GOOGLE_LOGIN_CUSTOMER_ID

  if (!accessToken || !developerToken || !customerId) {
    console.log(
      'Skip mode — set SMOKE_GOOGLE_ACCESS_TOKEN + SMOKE_GOOGLE_DEVELOPER_TOKEN + SMOKE_GOOGLE_CUSTOMER_ID to run',
    )
    process.exit(0)
  }

  const callArgs = { customerId, accessToken, developerToken, loginCustomerId }
  const ts = new Date().toISOString()
  const now = Timestamp.now()

  let campaignResourceName: string | null = null

  try {
    // ─── 1. Create Pmax campaign (PAUSED, MAXIMIZE_CONVERSIONS) ──────────────────
    console.log(`\n1. Creating Performance Max campaign "[SMOKE Pmax] ${ts}"…`)
    const campaign = await createPmaxCampaign({
      ...callArgs,
      canonical: {
        id: 'smoke-pmax',
        orgId: 'smoke-org',
        platform: 'google',
        adAccountId: customerId,
        name: `[SMOKE Pmax] ${ts}`,
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
      biddingStrategy: 'MAXIMIZE_CONVERSIONS',
    })
    campaignResourceName = campaign.resourceName
    console.log(`   ✓ Campaign: ${campaignResourceName}`)

    // ─── 2. Create text assets ────────────────────────────────────────────────────
    console.log('\n2. Creating text assets (headlines, long headlines, descriptions)…')
    const headlines = ['Best service around', 'Try us today', 'Quality you can trust']
    const longHeadlines = ['Experience the difference with our team']
    const descriptions = ['We deliver results fast.', 'Trusted by thousands of clients.']
    const businessNameText = 'Partners in Biz'

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

    // ─── 3. Create asset group ────────────────────────────────────────────────────
    console.log('\n3. Creating asset group "Primary Creative"…')
    const assetLinks: AssetGroupAssetLink[] = [
      ...headlineAssets.map((a) => ({ assetResourceName: a.resourceName, fieldType: 'HEADLINE' as AssetFieldType })),
      ...longHeadlineAssets.map((a) => ({ assetResourceName: a.resourceName, fieldType: 'LONG_HEADLINE' as AssetFieldType })),
      ...descriptionAssets.map((a) => ({ assetResourceName: a.resourceName, fieldType: 'DESCRIPTION' as AssetFieldType })),
      ...businessNameAssets.map((a) => ({ assetResourceName: a.resourceName, fieldType: 'BUSINESS_NAME' as AssetFieldType })),
    ]

    const assetGroup = await createAssetGroup({
      ...callArgs,
      campaignResourceName,
      name: `Primary Creative — ${ts}`,
      finalUrls: ['https://partnersinbiz.online'],
      status: 'PAUSED',
      assetLinks,
    })
    console.log(`   ✓ Asset group: ${assetGroup.resourceName}`)

    // ─── 4. Cleanup: remove campaign ──────────────────────────────────────────────
    console.log('\n4. Removing Pmax campaign (cleanup)…')
    await removePmaxCampaign({ ...callArgs, resourceName: campaignResourceName })
    campaignResourceName = null
    console.log('   ✓ Campaign removed')

    console.log('\n✅ All smoke steps passed — Performance Max sub-3a-ext is green.\n')
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
