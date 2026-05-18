// app/api/v1/ads/google/asset-groups/route.ts
// POST /api/v1/ads/google/asset-groups
//
// Creates a Performance Max asset group for an existing Pmax campaign.
// Text assets (headlines, long headlines, descriptions, business name, CTA) are created
// server-side via assets:mutate then linked to the group in a single assetGroupAssets:mutate.
//
// Request body: {
//   campaignId: string,            — PiB canonical campaign id
//   name: string,
//   finalUrls: string[],
//   texts: {
//     headlines: string[],         — 3–15 items, max 30 chars each
//     longHeadlines: string[],     — 1–5 items, max 90 chars each
//     descriptions: string[],      — 2–5 items, max 90 chars each
//   },
//   imageAssetResourceNames?: string[],        — pre-uploaded MARKETING_IMAGE assets
//   squareImageAssetResourceNames?: string[],  — pre-uploaded SQUARE_MARKETING_IMAGE assets
//   logoAssetResourceNames?: string[],         — pre-uploaded LOGO assets
//   youtubeVideoAssetResourceNames?: string[], — pre-uploaded YOUTUBE_VIDEO assets
//   businessName: string,
//   callToAction?: 'LEARN_MORE' | 'SHOP_NOW' | 'SIGN_UP' | 'DOWNLOAD' | ...
// }
//
// Response: { resourceName: string; id: string }
//
// Sub-3a-ext Performance Max.

import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getCampaign } from '@/lib/ads/campaigns/store'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { readDeveloperToken } from '@/lib/integrations/google_ads/oauth'
import { createAssetGroup, createTextAssets } from '@/lib/ads/providers/google/asset-groups'
import type { AssetFieldType, AssetGroupAssetLink } from '@/lib/ads/providers/google/asset-groups'

export const POST = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const body = (await req.json()) as {
    campaignId?: string
    name?: string
    finalUrls?: string[]
    texts?: {
      headlines?: string[]
      longHeadlines?: string[]
      descriptions?: string[]
    }
    imageAssetResourceNames?: string[]
    squareImageAssetResourceNames?: string[]
    logoAssetResourceNames?: string[]
    youtubeVideoAssetResourceNames?: string[]
    businessName?: string
    callToAction?: string
  }

  if (!body.campaignId || typeof body.campaignId !== 'string') {
    return apiError('Missing required field: campaignId', 400)
  }
  if (!body.name || typeof body.name !== 'string') {
    return apiError('Missing required field: name', 400)
  }
  if (!body.finalUrls || !Array.isArray(body.finalUrls) || body.finalUrls.length === 0) {
    return apiError('Missing required field: finalUrls (must be a non-empty array)', 400)
  }
  if (!body.businessName || typeof body.businessName !== 'string') {
    return apiError('Missing required field: businessName', 400)
  }

  // Resolve the PiB campaign and extract Google providerData
  const campaign = await getCampaign(body.campaignId)
  if (!campaign) return apiError('Campaign not found', 404)
  if (campaign.orgId !== orgId) return apiError('Campaign does not belong to this org', 403)

  const googleProviderData = (campaign.providerData as Record<string, unknown>)?.google as Record<string, unknown> | undefined
  const campaignResourceName = typeof googleProviderData?.campaignResourceName === 'string'
    ? googleProviderData.campaignResourceName
    : undefined
  if (!campaignResourceName) {
    return apiError('Campaign has no Google campaignResourceName — was it created with platform=google?', 400)
  }

  // Resolve Google Ads credentials
  const conn = await getConnection({ orgId, platform: 'google' })
  if (!conn) return apiError('No Google Ads connection for org', 400)
  const accessToken = decryptAccessToken(conn)
  const developerToken = readDeveloperToken()
  if (!developerToken) return apiError('Google Ads developer token not configured', 500)
  const googleMeta = ((conn.meta ?? {}) as Record<string, unknown>).google as Record<string, unknown> | undefined
  const loginCustomerId = typeof googleMeta?.loginCustomerId === 'string' ? googleMeta.loginCustomerId : undefined
  if (!loginCustomerId) return apiError('No Customer ID set on Google connection', 400)

  const callArgs = { customerId: loginCustomerId, accessToken, developerToken, loginCustomerId }

  // Build text asset lists: headline, longHeadline, description, businessName, CTA
  const headlines = body.texts?.headlines ?? []
  const longHeadlines = body.texts?.longHeadlines ?? []
  const descriptions = body.texts?.descriptions ?? []

  // Create each text category in parallel for efficiency
  const [
    headlineAssets,
    longHeadlineAssets,
    descriptionAssets,
    businessNameAssets,
    ctaAssets,
  ] = await Promise.all([
    createTextAssets({ ...callArgs, texts: headlines }),
    createTextAssets({ ...callArgs, texts: longHeadlines }),
    createTextAssets({ ...callArgs, texts: descriptions }),
    createTextAssets({ ...callArgs, texts: [body.businessName] }),
    body.callToAction
      ? createTextAssets({ ...callArgs, texts: [body.callToAction] })
      : Promise.resolve([]),
  ])

  // Compose asset links array
  const assetLinks: AssetGroupAssetLink[] = [
    ...headlineAssets.map((a) => ({ assetResourceName: a.resourceName, fieldType: 'HEADLINE' as AssetFieldType })),
    ...longHeadlineAssets.map((a) => ({ assetResourceName: a.resourceName, fieldType: 'LONG_HEADLINE' as AssetFieldType })),
    ...descriptionAssets.map((a) => ({ assetResourceName: a.resourceName, fieldType: 'DESCRIPTION' as AssetFieldType })),
    ...businessNameAssets.map((a) => ({ assetResourceName: a.resourceName, fieldType: 'BUSINESS_NAME' as AssetFieldType })),
    ...ctaAssets.map((a) => ({ assetResourceName: a.resourceName, fieldType: 'CALL_TO_ACTION_SELECTION' as AssetFieldType })),
    ...(body.imageAssetResourceNames ?? []).map((rn) => ({ assetResourceName: rn, fieldType: 'MARKETING_IMAGE' as AssetFieldType })),
    ...(body.squareImageAssetResourceNames ?? []).map((rn) => ({ assetResourceName: rn, fieldType: 'SQUARE_MARKETING_IMAGE' as AssetFieldType })),
    ...(body.logoAssetResourceNames ?? []).map((rn) => ({ assetResourceName: rn, fieldType: 'LOGO' as AssetFieldType })),
    ...(body.youtubeVideoAssetResourceNames ?? []).map((rn) => ({ assetResourceName: rn, fieldType: 'YOUTUBE_VIDEO' as AssetFieldType })),
  ]

  const result = await createAssetGroup({
    ...callArgs,
    campaignResourceName,
    name: body.name,
    finalUrls: body.finalUrls,
    status: 'PAUSED',
    assetLinks,
  })

  return apiSuccess(result, 201)
})
