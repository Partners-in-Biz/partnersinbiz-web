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
      campaignType?: 'SEARCH' | 'DISPLAY' | 'SHOPPING'
      shopping?: { merchantId?: string; feedLabel?: string }
    }
    /** LinkedIn Campaign Group options (only used when platform === 'linkedin') */
    linkedinAds?: {
      /** Total budget cap in major currency units (e.g. 100.50). Optional. */
      totalBudgetMajor?: number
      /** ISO 4217 currency code. Default 'USD'. */
      currencyCode?: string
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

    const campaignType = body.googleAds?.campaignType  // 'SEARCH' | 'DISPLAY' | 'SHOPPING' (default 'SEARCH')
    let result
    if (campaignType === 'SHOPPING') {
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
        google: { ...((campaign.providerData as Record<string, unknown>)?.google as Record<string, unknown> | undefined ?? {}), campaignResourceName: result.resourceName, googleCampaignId: result.id },
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

  // Meta: no provider push on POST — campaigns are pushed to Meta on /launch

  return apiSuccess(campaign, 201)
})
