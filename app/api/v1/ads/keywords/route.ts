// app/api/v1/ads/keywords/route.ts
// List + Create canonical ad keywords — admin only.
// Sub-3a Phase 2 Batch 2.

import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { createKeyword, listKeywords, updateKeyword } from '@/lib/ads/keywords/store'
import type { AdKeywordMatchType } from '@/lib/ads/providers/google/mappers'
import { getAdSet } from '@/lib/ads/adsets/store'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { readDeveloperToken } from '@/lib/integrations/google_ads/oauth'
import { resolveGoogleAdsCustomerContext } from '@/lib/ads/api-helpers'
import { addKeyword, addAdGroupNegativeKeyword } from '@/lib/ads/providers/google/keywords'

export const dynamic = 'force-dynamic'

const VALID_MATCH: AdKeywordMatchType[] = ['EXACT', 'PHRASE', 'BROAD']

export const GET = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const url = new URL(req.url)
  const adSetId = url.searchParams.get('adSetId') ?? undefined
  const campaignId = url.searchParams.get('campaignId') ?? undefined
  const negParam = url.searchParams.get('negative')
  const negativeKeyword =
    negParam === 'true' ? true : negParam === 'false' ? false : undefined

  try {
    const keywords = await listKeywords({ orgId, adSetId, campaignId, negativeKeyword })
    return apiSuccess({ keywords })
  } catch (err) {
    return apiError((err as Error).message ?? 'List keywords failed', 500)
  }
})

interface CreateBody {
  campaignId?: unknown
  adSetId?: unknown
  text?: unknown
  matchType?: unknown
  negativeKeyword?: unknown
  cpcBidMicros?: unknown
}

export const POST = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  let body: CreateBody
  try { body = await req.json() } catch { return apiError('Invalid JSON', 400) }

  if (typeof body.campaignId !== 'string' || !body.campaignId.trim()) {
    return apiError('campaignId is required', 400)
  }
  if (typeof body.adSetId !== 'string' || !body.adSetId.trim()) {
    return apiError('adSetId is required', 400)
  }
  if (typeof body.text !== 'string' || !body.text.trim()) {
    return apiError('text is required', 400)
  }
  if (body.text.length > 80) {
    return apiError('Keyword text exceeds 80 chars (Google limit)', 400)
  }
  if (!VALID_MATCH.includes(body.matchType as AdKeywordMatchType)) {
    return apiError(`matchType must be one of: ${VALID_MATCH.join(', ')}`, 400)
  }
  const negativeKeyword = body.negativeKeyword === true
  const cpcBidMicros = typeof body.cpcBidMicros === 'string' ? body.cpcBidMicros : undefined

  try {
    const kw = await createKeyword({
      orgId,
      campaignId: body.campaignId,
      adSetId: body.adSetId,
      text: body.text,
      matchType: body.matchType as AdKeywordMatchType,
      negativeKeyword,
      cpcBidMicros,
    })

    // Push to Google Ads when the parent ad set is a Google ad group. Without
    // this the canonical record exists but the keyword never serves. Mirrors
    // the Google dispatch in the ads/ad-sets routes.
    const adSet = await getAdSet(body.adSetId)
    if (adSet?.platform === 'google') {
      const conn = await getConnection({ orgId, platform: 'google' })
      if (!conn) return apiError('No Google Ads connection for org', 400)
      const accessToken = decryptAccessToken(conn)
      const developerToken = readDeveloperToken()
      if (!developerToken) return apiError('Google Ads developer token not configured', 500)
      const customerCtx = resolveGoogleAdsCustomerContext(conn)
      if (customerCtx instanceof Response) return customerCtx
      const { customerId, loginCustomerId } = customerCtx

      const googleAdSetData = (adSet.providerData as Record<string, unknown>)?.google as
        | Record<string, unknown>
        | undefined
      const adGroupResourceName =
        typeof googleAdSetData?.adGroupResourceName === 'string'
          ? googleAdSetData.adGroupResourceName
          : undefined
      if (!adGroupResourceName) {
        return apiError('Parent ad set has no Google ad group resource name', 400)
      }

      const matchType = body.matchType as AdKeywordMatchType
      const result = negativeKeyword
        ? await addAdGroupNegativeKeyword({
            customerId,
            accessToken,
            developerToken,
            loginCustomerId,
            adGroupResourceName,
            text: body.text,
            matchType,
          })
        : await addKeyword({
            customerId,
            accessToken,
            developerToken,
            loginCustomerId,
            adGroupResourceName,
            text: body.text,
            matchType,
          })

      const updated = await updateKeyword(kw.id, {
        providerData: {
          ...(kw.providerData ?? {}),
          google: {
            ...((kw.providerData as Record<string, unknown>)?.google as
              | Record<string, unknown>
              | undefined ?? {}),
            criterionResourceName: result.resourceName,
            googleCriterionId: result.id,
          },
        },
      } as Parameters<typeof updateKeyword>[1])
      return apiSuccess({ keyword: updated })
    }

    return apiSuccess({ keyword: kw })
  } catch (err) {
    return apiError((err as Error).message ?? 'Create keyword failed', 500)
  }
})
