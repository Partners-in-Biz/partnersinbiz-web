// app/api/v1/ads/campaigns/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listCampaigns, createCampaign, updateCampaign } from '@/lib/ads/campaigns/store'
import { requireMetaContext } from '@/lib/ads/api-helpers'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { readDeveloperToken } from '@/lib/integrations/google_ads/oauth'
import { createSearchCampaign } from '@/lib/ads/providers/google/campaigns'
import type { CreateAdCampaignInput, AdEntityStatus, AdPlatform } from '@/lib/ads/types'

export const GET = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const url = new URL(req.url)
  const status = url.searchParams.get('status') as AdEntityStatus | null
  const platform = url.searchParams.get('platform') as 'meta' | null

  const campaigns = await listCampaigns({
    orgId,
    status: status ?? undefined,
    platform: platform ?? undefined,
  })

  return apiSuccess(campaigns)
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const ctx = await requireMetaContext(req)
  if (ctx instanceof Response) return ctx

  const body = (await req.json()) as {
    input?: Omit<CreateAdCampaignInput, 'adAccountId'>
    platform?: AdPlatform
    googleAds?: {
      dailyBudgetMajor?: number
      campaignType?: 'SEARCH' | 'DISPLAY' | 'SHOPPING' | 'VIDEO' | 'PERFORMANCE_MAX' | 'SMART_SHOPPING'
      shopping?: { merchantId?: string; feedLabel?: string }
      smartShopping?: {
        biddingStrategy?: 'MAXIMIZE_CONVERSIONS' | 'MAXIMIZE_CONVERSION_VALUE' | 'TARGET_CPA' | 'TARGET_ROAS'
        targetCpaMajor?: number
        targetRoas?: number
        salesCountry?: string
      }
      video?: {
        /** Optional Target CPA in major currency units (e.g. 5.00). When set, maximizeConversions.targetCpaMicros is populated. */
        targetCpaMajor?: number
      }
      pmax?: {
        biddingStrategy?: 'MAXIMIZE_CONVERSIONS' | 'MAXIMIZE_CONVERSION_VALUE' | 'TARGET_CPA' | 'TARGET_ROAS'
        /** Target CPA in major currency units — applies to MAXIMIZE_CONVERSIONS or TARGET_CPA. */
        targetCpaMajor?: number
        /** Fractional ROAS goal (e.g. 4.0 = 400%) — applies to MAXIMIZE_CONVERSION_VALUE or TARGET_ROAS. */
        targetRoas?: number
      }
    }
    /** LinkedIn Campaign Group options (only used when platform === 'linkedin') */
    linkedinAds?: {
      /** Total budget cap in major currency units (e.g. 100.50). Optional. */
      totalBudgetMajor?: number
      /** ISO 4217 currency code. Default 'USD'. */
      currencyCode?: string
    }
    /** TikTok Campaign options (only used when platform === 'tiktok') */
    tiktokAds?: {
      /** Campaign-level budget in major currency units. Optional — omit for INFINITE. */
      budgetMajor?: number
      budgetMode?: 'BUDGET_MODE_INFINITE' | 'BUDGET_MODE_DAY' | 'BUDGET_MODE_TOTAL'
    }
  }

  if (!body.input?.name || !body.input?.objective) {
    return apiError('Missing required fields: name, objective', 400)
  }

  const platform: AdPlatform = body.platform ?? 'meta'

  const campaign = await createCampaign({
    orgId: ctx.orgId,
    createdBy: (user as { uid?: string }).uid ?? 'unknown',
    input: {
      ...body.input,
      adAccountId: ctx.adAccountId,
    } as CreateAdCampaignInput,
    platform,
  })

  if (platform === 'google') {
    const conn = await getConnection({ orgId: ctx.orgId, platform: 'google' })
    if (!conn) return apiError('No Google Ads connection for org', 400)
    const accessToken = decryptAccessToken(conn)
    const developerToken = readDeveloperToken()
    if (!developerToken) return apiError('Google Ads developer token not configured', 500)
    const googleMeta = ((conn.meta ?? {}) as Record<string, unknown>).google as Record<string, unknown> | undefined
    const loginCustomerId = typeof googleMeta?.loginCustomerId === 'string' ? googleMeta.loginCustomerId : undefined
    const customerId = loginCustomerId
    if (!customerId) return apiError('No Customer ID set on Google connection', 400)

    const campaignType = body.googleAds?.campaignType  // 'SEARCH' | 'DISPLAY' | 'SHOPPING' | 'VIDEO' | 'PERFORMANCE_MAX' | 'SMART_SHOPPING' (default 'SEARCH')
    let result
    if (campaignType === 'SMART_SHOPPING') {
      const merchantId = body.googleAds?.shopping?.merchantId
      const feedLabel = body.googleAds?.shopping?.feedLabel
      if (!merchantId || !feedLabel) {
        return apiError('SMART_SHOPPING requires googleAds.shopping.{merchantId, feedLabel}', 400)
      }
      const { createSmartShoppingCampaign } = await import('@/lib/ads/providers/google/campaigns-pmax')
      result = await createSmartShoppingCampaign({
        customerId,
        accessToken,
        developerToken,
        loginCustomerId,
        canonical: campaign,
        dailyBudgetMajor: body.googleAds?.dailyBudgetMajor,
        biddingStrategy: body.googleAds?.smartShopping?.biddingStrategy,
        targetCpaMajor: body.googleAds?.smartShopping?.targetCpaMajor,
        targetRoas: body.googleAds?.smartShopping?.targetRoas,
        merchantId,
        feedLabel,
        salesCountry: body.googleAds?.smartShopping?.salesCountry,
      })
    } else if (campaignType === 'PERFORMANCE_MAX') {
      const { createPmaxCampaign } = await import('@/lib/ads/providers/google/campaigns-pmax')
      result = await createPmaxCampaign({
        customerId,
        accessToken,
        developerToken,
        loginCustomerId,
        canonical: campaign,
        dailyBudgetMajor: body.googleAds?.dailyBudgetMajor,
        biddingStrategy: body.googleAds?.pmax?.biddingStrategy,
        targetCpaMajor: body.googleAds?.pmax?.targetCpaMajor,
        targetRoas: body.googleAds?.pmax?.targetRoas,
      })
    } else if (campaignType === 'SHOPPING') {
      const merchantId = body.googleAds?.shopping?.merchantId
      const feedLabel = body.googleAds?.shopping?.feedLabel
      if (!merchantId || !feedLabel) {
        return apiError('Shopping campaigns require googleAds.shopping.{merchantId, feedLabel}', 400)
      }
      const { createShoppingCampaign } = await import('@/lib/ads/providers/google/campaigns-shopping')
      result = await createShoppingCampaign({
        customerId,
        accessToken,
        developerToken,
        loginCustomerId,
        canonical: campaign,
        dailyBudgetMajor: body.googleAds?.dailyBudgetMajor,
        merchantId,
        feedLabel,
      })
    } else if (campaignType === 'DISPLAY') {
      const { createDisplayCampaign } = await import('@/lib/ads/providers/google/campaigns-display')
      result = await createDisplayCampaign({
        customerId,
        accessToken,
        developerToken,
        loginCustomerId,
        canonical: campaign,
        dailyBudgetMajor: body.googleAds?.dailyBudgetMajor,
      })
    } else if (campaignType === 'VIDEO') {
      const { createVideoCampaign } = await import('@/lib/ads/providers/google/campaigns-youtube')
      result = await createVideoCampaign({
        customerId,
        accessToken,
        developerToken,
        loginCustomerId,
        canonical: campaign,
        dailyBudgetMajor: body.googleAds?.dailyBudgetMajor,
        targetCpaMajor: body.googleAds?.video?.targetCpaMajor,
      })
    } else {
      result = await createSearchCampaign({
        customerId,
        accessToken,
        developerToken,
        loginCustomerId,
        canonical: campaign,
        dailyBudgetMajor: body.googleAds?.dailyBudgetMajor,
      })
    }

    await updateCampaign(campaign.id, {
      providerData: {
        ...(campaign.providerData ?? {}),
        google: {
          ...((campaign.providerData as Record<string, unknown>)?.google as Record<string, unknown> | undefined ?? {}),
          campaignResourceName: result.resourceName,
          googleCampaignId: result.id,
          ...(campaignType ? { campaignSubType: campaignType } : {}),
        },
      },
    } as any)
  }
  if (platform === 'linkedin') {
    const conn = await getConnection({ orgId: ctx.orgId, platform: 'linkedin' })
    if (!conn) return apiError('No LinkedIn ads connection for org', 400)
    const accessToken = decryptAccessToken(conn)
    const linkedinMeta = ((conn.meta ?? {}) as Record<string, unknown>).linkedin as Record<string, unknown> | undefined
    const accountUrn = typeof linkedinMeta?.selectedAdAccountUrn === 'string' ? linkedinMeta.selectedAdAccountUrn : undefined
    if (!accountUrn) return apiError('No Ad Account URN set on LinkedIn connection', 400)

    const { createCampaignGroup } = await import('@/lib/ads/providers/linkedin/campaigns')
    const result = await createCampaignGroup({
      accountUrn,
      accessToken,
      canonical: campaign,
      totalBudgetMajor: body.linkedinAds?.totalBudgetMajor,
      currencyCode: body.linkedinAds?.currencyCode,
    })

    await updateCampaign(campaign.id, {
      providerData: {
        ...(campaign.providerData ?? {}),
        linkedin: {
          ...((campaign.providerData as Record<string, unknown>)?.linkedin as Record<string, unknown> | undefined ?? {}),
          campaignGroupUrn: result.urn,
          liStatus: 'DRAFT',
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

    const { createCampaign: tiktokCreateCampaign } = await import('@/lib/ads/providers/tiktok/campaigns')
    const result = await tiktokCreateCampaign({
      advertiserId,
      accessToken,
      canonical: campaign,
      budgetMajor: body.tiktokAds?.budgetMajor,
      budgetMode: body.tiktokAds?.budgetMode,
    })

    await updateCampaign(campaign.id, {
      providerData: {
        ...(campaign.providerData ?? {}),
        tiktok: {
          ...((campaign.providerData as Record<string, unknown>)?.tiktok as Record<string, unknown> | undefined ?? {}),
          campaignId: result.campaignId,
          tkStatus: 'DISABLE',
        },
      },
    } as any)
  }

  // Meta: no provider push on POST — campaigns are pushed to Meta on /launch

  return apiSuccess(campaign, 201)
})
