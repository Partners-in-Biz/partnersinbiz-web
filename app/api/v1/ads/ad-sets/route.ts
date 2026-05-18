// app/api/v1/ads/ad-sets/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listAdSets, createAdSet } from '@/lib/ads/adsets/store'
import { getCampaign } from '@/lib/ads/campaigns/store'
import { requireMetaContext, resolveGoogleAdsCustomerContext } from '@/lib/ads/api-helpers'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { readDeveloperToken } from '@/lib/integrations/google_ads/oauth'
import { createAdGroup } from '@/lib/ads/providers/google/adgroups'
import { updateAdSet } from '@/lib/ads/adsets/store'
import type { CreateAdSetInput, AdEntityStatus, AdPlatform } from '@/lib/ads/types'
import type { LinkedinAdSetExtension } from '@/lib/ads/providers/linkedin/types'
import type { TiktokOptimizationGoal } from '@/lib/ads/providers/tiktok/types'

export const GET = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const url = new URL(req.url)
  const status = url.searchParams.get('status') as AdEntityStatus | null
  const campaignId = url.searchParams.get('campaignId')

  const adSets = await listAdSets({
    orgId,
    status: status ?? undefined,
    campaignId: campaignId ?? undefined,
  })

  return apiSuccess(adSets)
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const ctx = await requireMetaContext(req)
  if (ctx instanceof Response) return ctx

  const body = (await req.json()) as {
    input?: Omit<CreateAdSetInput, 'adAccountId'>
    platform?: AdPlatform
    googleAds?: { defaultCpcBidMajor?: number; type?: 'SEARCH_STANDARD' | 'DISPLAY_STANDARD' }
    linkedinAds?: {
      campaignType?: LinkedinAdSetExtension['liCampaignType']
      costType?: LinkedinAdSetExtension['liCostType']
      dailyBudgetMajor?: number
      currencyCode?: string
    }
    /** TikTok AdGroup options (only used when platform === 'tiktok') */
    tiktokAds?: {
      optimizationGoal?: TiktokOptimizationGoal
      billingEvent?: 'CPC' | 'CPM' | 'OCPM' | 'CPV'
      bidType?: 'BID_TYPE_NO_BID' | 'BID_TYPE_CUSTOM'
      bidPriceMajor?: number
      budgetMajor?: number
      budgetMode?: 'BUDGET_MODE_DAY' | 'BUDGET_MODE_TOTAL' | 'BUDGET_MODE_INFINITE'
      pacing?: 'PACING_MODE_SMOOTH' | 'PACING_MODE_FAST'
      placements?: ('PLACEMENT_TIKTOK' | 'PLACEMENT_PANGLE' | 'PLACEMENT_TOPBUZZ')[]
      scheduleStartTime?: string
      scheduleEndTime?: string
    }
  }

  if (!body.input?.name || !body.input?.campaignId) {
    return apiError('Missing required fields: name, campaignId', 400)
  }

  // Validate parent campaign exists and belongs to the same org
  const campaign = await getCampaign(body.input.campaignId)
  if (!campaign || campaign.orgId !== ctx.orgId) {
    return apiError('Campaign not found', 404)
  }

  const platform: AdPlatform = body.platform ?? campaign.platform ?? 'meta'

  const adSet = await createAdSet({
    orgId: ctx.orgId,
    input: body.input as CreateAdSetInput,
    platform,
  })

  if (platform === 'google') {
    const conn = await getConnection({ orgId: ctx.orgId, platform: 'google' })
    if (!conn) return apiError('No Google Ads connection for org', 400)
    const accessToken = decryptAccessToken(conn)
    const developerToken = readDeveloperToken()
    if (!developerToken) return apiError('Google Ads developer token not configured', 500)
    const customerCtx = resolveGoogleAdsCustomerContext(conn)
    if (customerCtx instanceof Response) return customerCtx
    const { customerId, loginCustomerId } = customerCtx

    const googleCampaignData = (campaign.providerData as Record<string, unknown>)?.google as Record<string, unknown> | undefined
    const campaignResourceName = typeof googleCampaignData?.campaignResourceName === 'string' ? googleCampaignData.campaignResourceName : undefined
    if (!campaignResourceName) return apiError('Parent campaign has no Google resource name', 400)

    const result = await createAdGroup({
      customerId,
      accessToken,
      developerToken,
      loginCustomerId,
      campaignResourceName,
      canonical: adSet,
      defaultCpcBidMajor: body.googleAds?.defaultCpcBidMajor,
      type: body.googleAds?.type,
    })

    await updateAdSet(adSet.id, {
      providerData: {
        ...(adSet.providerData ?? {}),
        google: { ...((adSet.providerData as Record<string, unknown>)?.google as Record<string, unknown> | undefined ?? {}), adGroupResourceName: result.resourceName, googleAdGroupId: result.id },
      },
    } as any)
  } else if (platform === 'linkedin') {
    const conn = await getConnection({ orgId: ctx.orgId, platform: 'linkedin' })
    if (!conn) return apiError('No LinkedIn ads connection for org', 400)
    const accessToken = decryptAccessToken(conn)
    const linkedinMeta = ((conn.meta ?? {}) as Record<string, unknown>).linkedin as Record<string, unknown> | undefined
    const accountUrn = typeof linkedinMeta?.selectedAdAccountUrn === 'string' ? linkedinMeta.selectedAdAccountUrn : undefined
    if (!accountUrn) return apiError('No Ad Account URN set on LinkedIn connection', 400)

    const linkedinCampaignData = (campaign.providerData as Record<string, unknown>)?.linkedin as Record<string, unknown> | undefined
    const campaignGroupUrn = typeof linkedinCampaignData?.campaignGroupUrn === 'string' ? linkedinCampaignData.campaignGroupUrn : undefined
    if (!campaignGroupUrn) return apiError('Parent campaign has no LinkedIn Campaign Group URN', 400)

    const { linkedinObjectiveFromCanonical } = await import('@/lib/ads/providers/linkedin/mappers')
    const objectiveType = linkedinObjectiveFromCanonical(campaign.objective)

    const { createCampaign: linkedinCreateCampaign } = await import('@/lib/ads/providers/linkedin/adsets')
    const result = await linkedinCreateCampaign({
      accountUrn,
      accessToken,
      canonical: adSet,
      campaignGroupUrn,
      objectiveType,
      campaignType: body.linkedinAds?.campaignType,
      costType: body.linkedinAds?.costType,
      dailyBudgetMajor: body.linkedinAds?.dailyBudgetMajor,
      currencyCode: body.linkedinAds?.currencyCode,
    })

    await updateAdSet(adSet.id, {
      providerData: {
        ...(adSet.providerData ?? {}),
        linkedin: {
          ...((adSet.providerData as Record<string, unknown>)?.linkedin as Record<string, unknown> | undefined ?? {}),
          campaignUrn: result.urn,
          liObjectiveType: objectiveType,
          liCampaignType: body.linkedinAds?.campaignType ?? 'SPONSORED_UPDATES',
        },
      },
    } as any)
  }
  if (platform === 'tiktok') {
    const conn = await getConnection({ orgId: ctx.orgId, platform: 'tiktok' })
    if (!conn) return apiError('No TikTok ads connection for org', 400)
    const accessToken = decryptAccessToken(conn)
    const tiktokMeta = ((conn.meta ?? {}) as Record<string, unknown>).tiktok as Record<string, unknown> | undefined
    const advertiserId = typeof tiktokMeta?.selectedAdvertiserId === 'string' ? tiktokMeta.selectedAdvertiserId : undefined
    if (!advertiserId) return apiError('No advertiserId set on TikTok connection', 400)

    const tiktokCampaignData = (campaign.providerData as Record<string, unknown>)?.tiktok as Record<string, unknown> | undefined
    const campaignId = typeof tiktokCampaignData?.campaignId === 'string' ? tiktokCampaignData.campaignId : undefined
    if (!campaignId) return apiError('Parent campaign has no TikTok campaign id', 400)

    const { tiktokObjectiveFromCanonical } = await import('@/lib/ads/providers/tiktok/mappers')
    const objective = tiktokObjectiveFromCanonical(campaign.objective)

    const { createAdGroup: tiktokCreateAdGroup } = await import('@/lib/ads/providers/tiktok/adgroups')
    const result = await tiktokCreateAdGroup({
      advertiserId,
      accessToken,
      canonical: adSet,
      campaignId,
      objective,
      optimizationGoal: body.tiktokAds?.optimizationGoal,
      billingEvent: body.tiktokAds?.billingEvent,
      bidType: body.tiktokAds?.bidType,
      bidPriceMajor: body.tiktokAds?.bidPriceMajor,
      budgetMajor: body.tiktokAds?.budgetMajor,
      budgetMode: body.tiktokAds?.budgetMode,
      pacing: body.tiktokAds?.pacing,
      placements: body.tiktokAds?.placements,
      scheduleStartTime: body.tiktokAds?.scheduleStartTime,
      scheduleEndTime: body.tiktokAds?.scheduleEndTime,
    })

    await updateAdSet(adSet.id, {
      providerData: {
        ...(adSet.providerData ?? {}),
        tiktok: {
          ...((adSet.providerData as Record<string, unknown>)?.tiktok as Record<string, unknown> | undefined ?? {}),
          adgroupId: result.adgroupId,
          campaignId,
          tkStatus: 'DISABLE',
        },
      },
    } as any)
  }

  // Meta: no provider push on POST — ad sets are pushed to Meta on /launch

  return apiSuccess(adSet, 201)
})
