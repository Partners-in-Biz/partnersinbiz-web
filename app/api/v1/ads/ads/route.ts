// app/api/v1/ads/ads/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listAds, createAd, updateAd } from '@/lib/ads/ads/store'
import { getAdSet } from '@/lib/ads/adsets/store'
import { requireMetaContext } from '@/lib/ads/api-helpers'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { readDeveloperToken } from '@/lib/integrations/google_ads/oauth'
import { createResponsiveSearchAd } from '@/lib/ads/providers/google/ads'
import type { CreateAdInput, AdEntityStatus, AdPlatform } from '@/lib/ads/types'
import type { RsaAssets } from '@/lib/ads/providers/google/ads'
import type { RdaAssets } from '@/lib/ads/providers/google/display-types'

export const GET = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const url = new URL(req.url)
  const status = url.searchParams.get('status') as AdEntityStatus | null
  const adSetId = url.searchParams.get('adSetId')
  const campaignId = url.searchParams.get('campaignId')

  const ads = await listAds({
    orgId,
    status: status ?? undefined,
    adSetId: adSetId ?? undefined,
    campaignId: campaignId ?? undefined,
  })

  return apiSuccess(ads)
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const ctx = await requireMetaContext(req)
  if (ctx instanceof Response) return ctx

  const body = (await req.json()) as {
    input?: Omit<CreateAdInput, 'adAccountId'>
    platform?: AdPlatform
    rsaAssets?: RsaAssets
    rdaAssets?: RdaAssets
    productAd?: boolean
    linkedinAds?: {
      referenceUrn: string
    }
  }

  if (!body.input?.name || !body.input?.adSetId) {
    return apiError('Missing required fields: name, adSetId', 400)
  }

  // Validate parent ad set exists and belongs to the same org
  const adSet = await getAdSet(body.input.adSetId)
  if (!adSet || adSet.orgId !== ctx.orgId) {
    return apiError('Ad set not found', 404)
  }

  const platform: AdPlatform = body.platform ?? adSet.platform ?? 'meta'

  const ad = await createAd({
    orgId: ctx.orgId,
    input: body.input as CreateAdInput,
    platform,
  })

  if (platform === 'google') {
    if (!body.rdaAssets && !body.rsaAssets && !body.productAd) {
      return apiError('Google ads require rsaAssets (Search), rdaAssets (Display), or productAd: true (Shopping)', 400)
    }
    const conn = await getConnection({ orgId: ctx.orgId, platform: 'google' })
    if (!conn) return apiError('No Google Ads connection for org', 400)
    const accessToken = decryptAccessToken(conn)
    const developerToken = readDeveloperToken()
    if (!developerToken) return apiError('Google Ads developer token not configured', 500)
    const googleMeta = ((conn.meta ?? {}) as Record<string, unknown>).google as Record<string, unknown> | undefined
    const loginCustomerId = typeof googleMeta?.loginCustomerId === 'string' ? googleMeta.loginCustomerId : undefined
    if (!loginCustomerId) return apiError('No Customer ID set on Google connection', 400)

    const googleAdSetData = (adSet.providerData as Record<string, unknown>)?.google as Record<string, unknown> | undefined
    const adGroupResourceName = typeof googleAdSetData?.adGroupResourceName === 'string' ? googleAdSetData.adGroupResourceName : undefined
    if (!adGroupResourceName) return apiError('Parent ad set has no Google ad group resource name', 400)

    let result
    if (body.productAd === true) {
      const { createProductAd } = await import('@/lib/ads/providers/google/shopping-ads')
      result = await createProductAd({
        customerId: loginCustomerId,
        accessToken,
        developerToken,
        loginCustomerId,
        adGroupResourceName,
        canonical: ad,
      })
    } else if (body.rdaAssets) {
      const { createResponsiveDisplayAd } = await import('@/lib/ads/providers/google/display-ads')
      result = await createResponsiveDisplayAd({
        customerId: loginCustomerId,
        accessToken,
        developerToken,
        loginCustomerId,
        adGroupResourceName,
        canonical: ad,
        rdaAssets: body.rdaAssets,
      })
    } else {
      result = await createResponsiveSearchAd({
        customerId: loginCustomerId,
        accessToken,
        developerToken,
        loginCustomerId,
        adGroupResourceName,
        canonical: ad,
        rsaAssets: body.rsaAssets!,
      })
    }

    await updateAd(ad.id, {
      providerData: {
        ...(ad.providerData ?? {}),
        google: { ...((ad.providerData as Record<string, unknown>)?.google as Record<string, unknown> | undefined ?? {}), adGroupAdResourceName: result.resourceName, googleAdId: result.id },
      },
    } as any)
  } else if (platform === 'linkedin') {
    const referenceUrn = body.linkedinAds?.referenceUrn
    if (typeof referenceUrn !== 'string' || referenceUrn.length === 0) {
      return apiError('LinkedIn ads require linkedinAds.referenceUrn (Share URN or asset URN backing the creative)', 400)
    }

    const conn = await getConnection({ orgId: ctx.orgId, platform: 'linkedin' })
    if (!conn) return apiError('No LinkedIn ads connection for org', 400)
    const accessToken = decryptAccessToken(conn)
    const linkedinMeta = ((conn.meta ?? {}) as Record<string, unknown>).linkedin as Record<string, unknown> | undefined
    const accountUrn = typeof linkedinMeta?.selectedAdAccountUrn === 'string' ? linkedinMeta.selectedAdAccountUrn : undefined
    if (!accountUrn) return apiError('No Ad Account URN set on LinkedIn connection', 400)

    const linkedinAdSetData = (adSet.providerData as Record<string, unknown>)?.linkedin as Record<string, unknown> | undefined
    const campaignUrn = typeof linkedinAdSetData?.campaignUrn === 'string' ? linkedinAdSetData.campaignUrn : undefined
    if (!campaignUrn) return apiError('Parent ad-set has no LinkedIn Campaign URN', 400)

    const { createCreative } = await import('@/lib/ads/providers/linkedin/ads')
    const result = await createCreative({
      accountUrn,
      accessToken,
      canonical: ad,
      campaignUrn,
      referenceUrn,
    })

    await updateAd(ad.id, {
      providerData: {
        ...(ad.providerData ?? {}),
        linkedin: {
          ...((ad.providerData as Record<string, unknown>)?.linkedin as Record<string, unknown> | undefined ?? {}),
          creativeUrn: result.urn,
          contentReferenceUrn: referenceUrn,
        },
      },
    } as any)
  }
  // Meta: no provider push on POST — ads are pushed to Meta on /launch

  return apiSuccess(ad, 201)
})
